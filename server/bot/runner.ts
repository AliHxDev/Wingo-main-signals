import { winGoClient, type WinGoIssue, getCurrentWinGoPeriod } from '../wingo/client.js';
import { predictionEngine, type PredictionResult } from '../prediction/engine.js';
import { whatsAppManager } from '../whatsapp/client.js';
import { getActiveWhatsAppDestination } from '../services/destination.js';
import { sessionScheduler } from '../services/sessionScheduler.js';
import { botModeManager, type BotMode } from '../services/botModeManager.js';
import { query } from '../db/index.js';
import { logger, LogEvent, logLifecycle } from '../services/logger.js';
import {
  renderDynamicSignal,
  renderDynamicWin,
  renderDynamicLoss,
} from '../utils/formatters.js';
import {
  periodLifecycleManager,
  getPeriodStartTimeFromIssue,
  type WinGoPeriodState,
} from './periodLifecycle.js';

export interface BotStatus {
  mode: BotMode;
  running: boolean;
  predictionEngineStatus: 'RUNNING' | 'IDLE' | 'PAUSED' | 'STOPPED';
  lastCycleAt: string | null;
  lastIssue: string | null;
  nextCheckAt: string | null;
  currentPeriod?: {
    periodNumber: string;
    state: string;
    elapsedSeconds: number;
    targetSeconds: number;
    signalSent: boolean;
    signalResult: string | null;
  } | null;
  latestSignal: {
    issueNumber: string;
    prediction: string;
    predictedColor: string;
    confidence: number;
    status: string;
    sentTo: string;
    sentAt: string | null;
    actualNumber?: number | null;
    actualSize?: string | null;
  } | null;
  lastError: string | null;
  pollingIntervalSeconds: number;
  confidenceThreshold: number;
}

/**
 * Calculates milliseconds remaining until the EXACT 15-second elapsed point
 * of the relevant WinGo 1M period.
 *
 * Period-based: The period number is the primary identity.
 * Period start is derived from the period number, and target is exactly
 * 15 seconds into THAT specific period.
 */
export function calculateNext15SecondPoint(now = Date.now()): {
  delayMs: number;
  targetPeriodIssue: string;
  target15PointMs: number;
  target40PointMs: number;
  targetOffset: number;
} {
  const currentPeriod = getCurrentWinGoPeriod(0, now);
  const currentPeriodStart = getPeriodStartTimeFromIssue(currentPeriod.issueNumber, now);
  const currentPeriod15Point = currentPeriodStart + 15000;

  // If we are before second 15 of this period (allowing at least 300ms execution window),
  // target THIS period at its 15-second point.
  if (now < currentPeriod15Point - 300) {
    return {
      delayMs: Math.max(0, currentPeriod15Point - now),
      targetPeriodIssue: currentPeriod.issueNumber,
      target15PointMs: currentPeriod15Point,
      target40PointMs: currentPeriod15Point,
      targetOffset: 0,
    };
  } else {
    // If we are at or past second 15, target the NEXT period at its own 15-second mark
    const nextPeriod = getCurrentWinGoPeriod(1, now);
    const nextPeriodStart = getPeriodStartTimeFromIssue(nextPeriod.issueNumber, now + 60000);
    const nextPeriod15Point = nextPeriodStart + 15000;
    return {
      delayMs: Math.max(0, nextPeriod15Point - now),
      targetPeriodIssue: nextPeriod.issueNumber,
      target15PointMs: nextPeriod15Point,
      target40PointMs: nextPeriod15Point,
      targetOffset: 1,
    };
  }
}

/**
 * Backward-compatible alias for 40-second calculator, mapped to 15-second timing.
 */
export function calculateNext40SecondPoint(now = Date.now()): {
  delayMs: number;
  targetPeriodIssue: string;
  target40PointMs: number;
  targetOffset: number;
} {
  const result = calculateNext15SecondPoint(now);
  return {
    delayMs: result.delayMs,
    targetPeriodIssue: result.targetPeriodIssue,
    target40PointMs: result.target15PointMs,
    targetOffset: result.targetOffset,
  };
}

export class BotRunner {
  private running = false;
  private signalTimer: NodeJS.Timeout | null = null;
  private watcherTimer: NodeJS.Timeout | null = null;
  private isWatcherRunning = false;
  private isSignalExecuting = false;
  private lastCycleAt: Date | null = null;
  private lastIssue: string | null = null;
  private nextCheckAt: Date | null = null;
  private lastError: string | null = null;
  private pollingIntervalSeconds = 60;
  private confidenceThreshold = 65;

  /**
   * Starts the bot in NORMAL BOT MODE.
   * - Fixed 15-second signal timing synchronized with WinGo 1M periods
   * - Session scheduler does NOT control it
   * - Session targets do NOT stop it
   */
  async startNormal(): Promise<BotStatus> {
    if (this.running && botModeManager.getMode() === 'NORMAL') {
      return this.getStatus();
    }

    const waStatus = whatsAppManager.getStatus();
    const destination = await getActiveWhatsAppDestination();

    if (waStatus.status !== 'connected') {
      this.lastError =
        'WhatsApp is not connected. Signals will be analyzed and saved to the Dashboard.';
      logger.warn('Normal bot started without connected WhatsApp. Running in Analysis & Dashboard mode.');
    } else if (!destination) {
      this.lastError = 'WhatsApp Channel is not configured in Settings. Signals will appear in the Dashboard.';
      logger.warn('Normal bot started without configured WhatsApp channel destination.');
    } else {
      this.lastError = null;
    }

    await this.refreshSettings();

    this.running = true;

    logLifecycle(LogEvent.BOT_STARTED, {
      mode: 'NORMAL',
      destination: destination || 'dashboard',
      interval: 60,
      threshold: this.confidenceThreshold,
      waStatus: waStatus.status,
    });

    // Start result watcher & period lifecycle tracking
    this.startResultWatcher();

    // Immediately detect and track current period
    this.detectAndTrackCurrentPeriod().catch(() => {});

    return this.getStatus();
  }

  /**
   * Backward-compatible start alias.
   */
  async start(): Promise<BotStatus> {
    return this.startNormal();
  }

  /**
   * Stops the bot in NORMAL BOT MODE.
   */
  stopNormal(): BotStatus {
    this.running = false;

    // If session mode is not running, cancel period timer and reset state
    if (botModeManager.getMode() !== 'SESSION') {
      periodLifecycleManager.cancelPeriodTimer();
      periodLifecycleManager.reset();
    }

    logLifecycle(LogEvent.BOT_STOPPED, { mode: 'NORMAL' });
    logger.info('WinGo bot stopped in NORMAL mode.');
    return this.getStatus();
  }

  /**
   * Backward-compatible stop alias.
   */
  stop(): BotStatus {
    return this.stopNormal();
  }

  /**
   * Detects current active WinGo 1M period and registers it with the
   * period lifecycle manager for dedicated 15-second elapsed tracking.
   */
  async detectAndTrackCurrentPeriod(): Promise<void> {
    const mode = botModeManager.getMode();
    if (mode === 'STOPPED') return;

    try {
      const currentPeriod = getCurrentWinGoPeriod(0);
      this.lastIssue = currentPeriod.issueNumber;

      // Track this specific period in the period lifecycle manager
      const state = await periodLifecycleManager.onPeriodDetected(currentPeriod.issueNumber);
      if (state.state === 'WAITING_15_SECONDS' || state.state === 'WAITING_40_SECONDS') {
        this.nextCheckAt = new Date(state.target15PointMs || state.target40PointMs);
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to track active WinGo period');
    }
  }

  /**
   * Trigger for scheduling 15-second signal.
   * Delegates authoritatively to detectAndTrackCurrentPeriod.
   */
  public scheduleNext15SecondSignal(): void {
    const mode = botModeManager.getMode();
    if (mode === 'STOPPED') {
      this.nextCheckAt = null;
      periodLifecycleManager.cancelPeriodTimer();
      return;
    }
    this.detectAndTrackCurrentPeriod().catch(() => {});
  }

  /**
   * Backward-compatible trigger for scheduling 40-second signal.
   * Delegates to scheduleNext15SecondSignal.
   */
  public scheduleNext40SecondSignal(): void {
    this.scheduleNext15SecondSignal();
  }

  /**
   * Wrapper for execute15SecondSignal.
   */
  async execute15SecondSignal(expectedPeriodIssue: string, _scheduledPointMs?: number): Promise<void> {
    const state = periodLifecycleManager.getPeriodState(expectedPeriodIssue) || {
      periodNumber: expectedPeriodIssue,
      periodStart: getPeriodStartTimeFromIssue(expectedPeriodIssue),
      periodEnd: getPeriodStartTimeFromIssue(expectedPeriodIssue) + 60000,
      detectedAt: Date.now(),
      target15PointMs: getPeriodStartTimeFromIssue(expectedPeriodIssue) + 15000,
      target40PointMs: getPeriodStartTimeFromIssue(expectedPeriodIssue) + 15000,
      targetSeconds: 15,
      elapsedSeconds: 15,
      state: 'SIGNAL_SENT' as const,
      signalScheduled: false,
      signalSent: true,
      signalSentAt: Date.now(),
      signalResult: null,
      completedAt: null,
    };
    await this.executePeriodSignal(state);
  }

  /**
   * Backward-compatible wrapper for execute40SecondSignal.
   */
  async execute40SecondSignal(expectedPeriodIssue: string, _scheduledPointMs?: number): Promise<void> {
    return this.execute15SecondSignal(expectedPeriodIssue, _scheduledPointMs);
  }

  /**
   * Executes signal generation and delivery at EXACTLY 15 seconds of THIS period's lifecycle.
   *
   * The period number is the primary identifier and remains attached throughout.
   * Adheres strictly to the 8-step delivery contract:
   * 1. Confirm WhatsApp is connected
   * 2. Confirm authentication is valid
   * 3. Confirm newsletter/channel destination exists
   * 4. Confirm the period has not already received a signal (PostgreSQL duplicate check)
   * 5. Generate prediction using deterministic 10-indicator engine
   * 6. Save signal in PostgreSQL (atomic ON CONFLICT protection)
   * 7. Send WhatsApp message
   * 8. Record delivery status
   */
  async executePeriodSignal(periodState: WinGoPeriodState): Promise<void> {
    const targetIssue = periodState.periodNumber;

    if (this.isSignalExecuting) {
      logger.warn({ period: targetIssue }, 'Previous signal execution still in progress; skipping overlap.');
      return;
    }

    this.isSignalExecuting = true;

    try {
      this.lastCycleAt = new Date();
      await this.refreshSettings();

      // DUPLICATE PROTECTION: Verify PostgreSQL if signal already exists for this period
      const existing = await query<any>(
        `SELECT id, status, sent_to, sent_at FROM signals WHERE issue_number = $1`,
        [targetIssue]
      );
      if (existing.rowCount > 0) {
        logger.info(
          { issue: targetIssue },
          `[SIGNAL] Period ${targetIssue} already has a signal in PostgreSQL. Skipping duplicate generation.`
        );
        return;
      }

      // Check Bot Mode Gatekeeper (NORMAL vs SESSION vs STOPPED)
      const gate = await botModeManager.canGeneratePrediction();
      if (!gate.allowed) {
        console.log(`[PREDICTION] Prediction engine remains IDLE (${gate.reason})`);
        return;
      }

      const currentMode = gate.mode;
      const session = gate.session;
      const sessionId = currentMode === 'SESSION' ? (session?.id || null) : null;

      // 1-3. Check WhatsApp connection readiness & destination
      const waStatus = whatsAppManager.getStatus();
      const isWaConnected = waStatus.status === 'connected';
      const destination = await getActiveWhatsAppDestination();

      // Fetch WinGo history for prediction analysis
      const history = await winGoClient.fetchHistory();
      if (!history || history.length === 0) {
        logger.warn('No WinGo history available for prediction analysis.');
        return;
      }

      this.lastIssue = history[0]?.issueNumber || targetIssue;

      // 5. Generate prediction using 10-indicator deterministic engine
      const prediction: PredictionResult = predictionEngine.predict(
        history,
        this.confidenceThreshold
      );

      // Verify stability & minimum history (Requirement 16)
      if (!prediction.sufficientData) {
        logger.info('Insufficient valid history to generate stable prediction. Signal skipped.');
        return;
      }

      // Overwrite target issue to match this exact period
      prediction.targetIssueNumber = targetIssue;

      // Check confidence threshold (Requirement 17)
      if (!prediction.meetsThreshold) {
        logger.info(
          { issue: targetIssue, confidence: prediction.confidence, threshold: this.confidenceThreshold },
          'Confidence below threshold; signal skipped.'
        );
        return;
      }

      logLifecycle(LogEvent.PREDICTION_GENERATED, {
        mode: currentMode,
        targetIssue,
        prediction: prediction.prediction,
        confidence: prediction.confidence,
        meetsThreshold: prediction.meetsThreshold,
      });

      console.log(
        `[SIGNAL] [Mode: ${currentMode}] 15s Signal generated for period ${targetIssue}: ${prediction.prediction} (${prediction.predictedColor}, ${prediction.confidence}%)`
      );

      // Determine initial delivery state
      const targetDestination = destination || 'dashboard';
      let sentAtVal: Date | null = null;
      let deliveryState: string = 'PENDING';

      // 6. Save signal with database-level uniqueness
      const insertRes = await query<any>(
        `INSERT INTO signals (
          issue_number, prediction, predicted_color, confidence, status,
          sent_to, session_id, sent_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (issue_number) DO NOTHING
        RETURNING id`,
        [
          targetIssue,
          prediction.prediction,
          prediction.predictedColor,
          prediction.confidence,
          deliveryState,
          targetDestination,
          sessionId,
          sentAtVal,
        ]
      );

      if (insertRes.rowCount === 0) {
        logger.warn({ issue: targetIssue }, 'Concurrent duplicate signal insert prevented by DB constraint');
        return;
      }

      const signalId = insertRes.rows[0].id;

      // 7. Deliver to WhatsApp if connected
      if (isWaConnected && destination && destination !== 'dashboard') {
        try {
          const signalMessage = await renderDynamicSignal({
            issueNumber: targetIssue,
            prediction: prediction.prediction,
            color: prediction.predictedColor,
            confidence: prediction.confidence,
          });

          await whatsAppManager.sendMessage(signalMessage, destination, 'SIGNAL');

          // 8. Record delivery status
          await query(
            `UPDATE signals SET sent_at = NOW() WHERE id = $1`,
            [signalId]
          );

          this.lastError = null;
          console.log(`[SIGNAL] 15s Signal delivered immediately to WhatsApp (${destination}) for period ${targetIssue}`);
        } catch (err: any) {
          this.lastError = `Failed to deliver to WhatsApp: ${err.message}`;
          logger.error({ err: err.message, destination, issue: targetIssue }, 'Failed to deliver signal to WhatsApp');
        }
      } else {
        // WhatsApp is disconnected at 15s
        console.log(
          `[SIGNAL] WhatsApp disconnected at 15s mark for period ${targetIssue}. Prediction recorded in Dashboard (sent_at: NULL).`
        );
      }
    } finally {
      this.isSignalExecuting = false;
    }
  }

  /**
   * Starts high-frequency Result Watcher & Period Polling loop (checks every 2 seconds).
   * - Detects and tracks current WinGo period lifecycle
   * - As soon as a period's actual result is published:
   *   - Evaluates WIN or LOSS immediately
   *   - Sends settlement message immediately (non-blocking)
   *   - Updates session stats and checks targets
   */
  startResultWatcher(): void {
    if (this.isWatcherRunning) return;
    this.isWatcherRunning = true;

    if (this.watcherTimer) {
      clearInterval(this.watcherTimer);
      this.watcherTimer = null;
    }

    this.watcherTimer = setInterval(async () => {
      try {
        await this.detectAndTrackCurrentPeriod();
        await this.settlePendingSignals();
        await this.deliverPendingUnsentSignalsOnReconnect();
      } catch (err: any) {
        logger.error({ err: err.message }, 'Error in result watcher loop');
      }
    }, 2000);

    // Initial immediate check
    this.detectAndTrackCurrentPeriod().catch(() => {});

    logger.info('WinGo 1M Result Watcher & Period Polling loop started (2s interval).');
  }

  stopResultWatcher(): void {
    if (this.watcherTimer) {
      clearInterval(this.watcherTimer);
      this.watcherTimer = null;
    }
    this.isWatcherRunning = false;
  }

  /**
   * Settle pending signals whose results are now available in WinGo history.
   * Immediate and idempotent: evaluates WIN/LOSS as soon as drawn.
   */
  async settlePendingSignals(historyOverride?: WinGoIssue[]): Promise<boolean> {
    const pendingRes = await query<any>(
      `SELECT * FROM signals WHERE status = 'PENDING' ORDER BY id ASC`
    );

    if (pendingRes.rowCount === 0) return false;

    const history = historyOverride || (await winGoClient.fetchHistory());
    if (!history || history.length === 0) return false;

    let settledAny = false;

    for (const pending of pendingRes.rows) {
      const matched = history.find((h) => h.issueNumber === pending.issue_number);
      if (!matched) {
        // Result not yet published in history
        continue;
      }

      const actualColorsDisplay = matched.colors.join('+');
      const isWin = pending.prediction === matched.size;
      const status: 'WIN' | 'LOSS' = isWin ? 'WIN' : 'LOSS';

      // Atomic idempotent update in database
      const updateRes = await query(
        `UPDATE signals
         SET status = $1,
             actual_number = $2,
             actual_size = $3,
             actual_color = $4,
             settled_at = NOW()
         WHERE id = $5 AND status = 'PENDING'`,
        [status, matched.number, matched.size, actualColorsDisplay, pending.id]
      );

      if (updateRes.rowCount === 0) {
        continue;
      }

      settledAny = true;
      console.log(
        `[RESULT] Period ${matched.issueNumber} settled as ${status} (Actual: ${matched.number} ${matched.size}, Predicted: ${pending.prediction})`
      );

      // Notify period lifecycle manager
      periodLifecycleManager.onPeriodSettled(
        matched.issueNumber,
        status,
        matched.number,
        matched.size
      );

      logLifecycle(isWin ? LogEvent.WIN : LogEvent.LOSS, {
        issueNumber: matched.issueNumber,
        actualNumber: matched.number,
      });

      // Update session statistics if associated with a session
      if (pending.session_id) {
        try {
          await sessionScheduler.syncSessionStats(pending.session_id);
          const mode = botModeManager.getMode();
          if (mode === 'SESSION') {
            const sess = await sessionScheduler.getSessionById(pending.session_id);
            if (sess && sess.status === 'RUNNING' && sess.wins >= sess.target_wins) {
              console.log(
                `[SESSION] Session #${sess.id} reached target of ${sess.target_wins} WINs! Triggering completion.`
              );
              await sessionScheduler.completeSessionTarget(sess.id);
            }
          }
        } catch (err: any) {
          logger.error({ err: err.message }, 'Error updating session stats on settlement');
        }
      }

      // Render & dispatch WIN or LOSS message immediately (non-blocking)
      const destination = pending.sent_to || (await getActiveWhatsAppDestination()) || 'dashboard';

      const renderPromise = isWin
        ? renderDynamicWin({
            issueNumber: matched.issueNumber,
            actualNumber: matched.number,
            actualSize: matched.size,
            actualColor: actualColorsDisplay,
            predictedSize: pending.prediction,
            predictedColor: pending.predicted_color,
            confidence: pending.confidence,
          })
        : renderDynamicLoss({
            issueNumber: matched.issueNumber,
            actualNumber: matched.number,
            actualSize: matched.size,
            actualColor: actualColorsDisplay,
            predictedSize: pending.prediction,
            predictedColor: pending.predicted_color,
            confidence: pending.confidence,
          });

      renderPromise
        .then((renderedMessage) => {
          this.dispatchSettlementMessageAsync(
            renderedMessage,
            destination,
            status,
            matched.issueNumber
          );
        })
        .catch((renderErr) => {
          logger.error({ err: renderErr.message }, 'Failed to render settlement message');
        });
    }

    return settledAny;
  }

  /**
   * If WhatsApp was disconnected at the 15s mark and now reconnected,
   * safely deliver pending signal ONLY IF the period is still active.
   * If the period already ended, never deliver stale predictions.
   */
  private async deliverPendingUnsentSignalsOnReconnect(): Promise<void> {
    const waStatus = whatsAppManager.getStatus();
    if (waStatus.status !== 'connected') return;

    const destination = await getActiveWhatsAppDestination();
    if (!destination || destination === 'dashboard') return;

    const pendingUnsent = await query<any>(
      `SELECT * FROM signals WHERE status = 'PENDING' AND sent_at IS NULL AND actual_number IS NULL`
    );

    if (pendingUnsent.rowCount === 0) return;

    for (const sig of pendingUnsent.rows) {
      // Check if period is still currently active
      const currentPeriod = getCurrentWinGoPeriod(0);
      if (sig.issue_number === currentPeriod.issueNumber) {
        try {
          const signalMessage = await renderDynamicSignal({
            issueNumber: sig.issue_number,
            prediction: sig.prediction,
            color: sig.predicted_color,
            confidence: sig.confidence,
          });

          await whatsAppManager.sendMessage(signalMessage, destination, 'SIGNAL');
          await query(
            `UPDATE signals SET sent_at = NOW(), sent_to = $2 WHERE id = $1 AND sent_at IS NULL`,
            [sig.id, destination]
          );
          console.log(`[SIGNAL] Reconnected WhatsApp delivered queued signal for period ${sig.issue_number}`);
        } catch (err: any) {
          logger.warn({ err: err.message }, 'Failed to deliver signal on reconnect');
        }
      }
    }
  }

  /**
   * Dispatches the WIN/LOSS settlement message without blocking or delaying.
   */
  private dispatchSettlementMessageAsync(
    messageText: string,
    destination: string,
    status: 'WIN' | 'LOSS',
    issueNumber: string
  ): void {
    if (!destination || destination === 'dashboard') {
      return;
    }

    const isConnected = whatsAppManager.getStatus().status === 'connected';
    if (!isConnected) {
      return;
    }

    (async () => {
      try {
        await whatsAppManager.sendMessage(messageText, destination, status);
        console.log(`[RESULT] Result message sent for issue ${issueNumber} to ${destination}`);
      } catch (err: any) {
        logger.error(
          { err: err.message, issueNumber, status, destination },
          `[RESULT] Failed to deliver ${status} message to WhatsApp`
        );
      }
    })();
  }

  /**
   * Legacy cycle runner for manual triggers / tests.
   */
  async runCycle(): Promise<void> {
    this.lastCycleAt = new Date();
    try {
      const history = await winGoClient.fetchHistory();
      if (history && history.length > 0) {
        this.lastIssue = history[0].issueNumber;
        await this.settlePendingSignals(history);
      }
    } catch (err: any) {
      this.lastError = err.message || 'Error in bot cycle';
    }
  }

  /**
   * Cancels in-flight scheduled signals.
   */
  cancelPendingScheduledSignals(sessionId?: number | null): void {
    if (this.signalTimer) {
      clearTimeout(this.signalTimer);
      this.signalTimer = null;
    }
    if (sessionId === null) {
      query(`UPDATE signals SET status = 'CANCELLED' WHERE session_id IS NULL AND status = 'SCHEDULED'`).catch(() => {});
    } else if (sessionId !== undefined) {
      query(`UPDATE signals SET status = 'CANCELLED' WHERE session_id = $1 AND status = 'SCHEDULED'`, [sessionId]).catch(() => {});
    } else {
      query(`UPDATE signals SET status = 'CANCELLED' WHERE status = 'SCHEDULED'`).catch(() => {});
    }
    console.log(`[SIGNAL] Cancelled scheduled signal timers${sessionId !== undefined ? ` (sessionId: ${sessionId})` : ''}`);
  }

  /**
   * Immediately dispatches a signal on demand.
   */
  async dispatchInstantSignal(): Promise<{
    success: boolean;
    signal: any;
    destination: string;
    deliveredToWhatsApp: boolean;
    message: string;
    error?: string;
  }> {
    const history = await winGoClient.fetchHistory();
    if (!history || history.length === 0) {
      throw new Error('Unable to retrieve WinGo history.');
    }

    await this.refreshSettings();
    const prediction = predictionEngine.predict(history, this.confidenceThreshold);
    const destination = (await getActiveWhatsAppDestination()) || 'dashboard';

    const currentPeriod = getCurrentWinGoPeriod(0);
    prediction.targetIssueNumber = currentPeriod.issueNumber;

    const signalMessage = await renderDynamicSignal({
      issueNumber: prediction.targetIssueNumber,
      prediction: prediction.prediction,
      color: prediction.predictedColor,
      confidence: prediction.confidence,
    });

    const isConnected = whatsAppManager.getStatus().status === 'connected';

    await query(
      `INSERT INTO signals (
        issue_number, prediction, predicted_color, confidence, status, sent_to, sent_at
      ) VALUES ($1, $2, $3, $4, 'PENDING', $5, $6)
      ON CONFLICT (issue_number) DO UPDATE
      SET prediction = EXCLUDED.prediction,
          predicted_color = EXCLUDED.predicted_color,
          confidence = EXCLUDED.confidence,
          sent_to = EXCLUDED.sent_to,
          sent_at = EXCLUDED.sent_at`,
      [
        prediction.targetIssueNumber,
        prediction.prediction,
        prediction.predictedColor,
        prediction.confidence,
        destination,
        isConnected ? new Date() : null,
      ]
    );

    let deliveredToWhatsApp = false;
    let deliveryError: string | undefined;

    if (destination && destination !== 'dashboard') {
      if (isConnected) {
        try {
          await whatsAppManager.sendMessage(signalMessage, destination, 'SIGNAL');
          deliveredToWhatsApp = true;
          console.log(`[SIGNAL] Signal sent to ${destination} for issue ${prediction.targetIssueNumber}`);
        } catch (err: any) {
          deliveryError = err.message;
          logger.warn({ err: err.message }, 'Failed to send instant signal to WhatsApp');
        }
      } else {
        deliveryError = 'WhatsApp is not connected yet (pair in the WhatsApp Pairing tab to broadcast).';
      }
    }

    return {
      success: true,
      signal: {
        issueNumber: prediction.targetIssueNumber,
        prediction: prediction.prediction,
        predictedColor: prediction.predictedColor,
        confidence: prediction.confidence,
        status: 'PENDING',
        sentTo: destination,
        sentAt: deliveredToWhatsApp ? new Date().toISOString() : null,
      },
      destination,
      deliveredToWhatsApp,
      message: deliveredToWhatsApp
        ? `Signal for issue ${prediction.targetIssueNumber} delivered to WhatsApp (${destination})!`
        : `Signal generated & saved to Dashboard.${deliveryError ? ' Note: ' + deliveryError : ' Connect WhatsApp to broadcast.'}`,
      error: deliveryError,
    };
  }

  private async refreshSettings(): Promise<void> {
    try {
      const res = await query<any>(
        `SELECT key, value FROM settings WHERE key IN ('polling_interval', 'confidence_threshold')`
      );
      for (const row of res.rows) {
        if (row.key === 'polling_interval') {
          const val = parseInt(row.value, 10);
          if (!isNaN(val) && val >= 10) this.pollingIntervalSeconds = val;
        }
        if (row.key === 'confidence_threshold') {
          const val = parseInt(row.value, 10);
          if (!isNaN(val) && val >= 50 && val <= 99) this.confidenceThreshold = val;
        }
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to refresh bot settings from DB');
    }
  }

  async getLatestSignal(): Promise<BotStatus['latestSignal']> {
    try {
      const res = await query<any>(
        `SELECT issue_number, prediction, predicted_color, confidence, status, sent_to, sent_at, actual_number, actual_size
         FROM signals
         ORDER BY id DESC
         LIMIT 1`
      );
      if (res.rowCount > 0 && res.rows[0]) {
        const r = res.rows[0];
        return {
          issueNumber: r.issue_number,
          prediction: r.prediction,
          predictedColor: r.predicted_color,
          confidence: r.confidence,
          status: r.status,
          sentTo: r.sent_to,
          sentAt: r.sent_at ? new Date(r.sent_at).toISOString() : null,
          actualNumber: r.actual_number,
          actualSize: r.actual_size,
        };
      }
      return null;
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to query latest signal');
      return null;
    }
  }

  getStatus(): BotStatus {
    const mode = botModeManager.getMode();
    const waConnected = whatsAppManager.getStatus().status === 'connected';
    let predictionEngineStatus: 'RUNNING' | 'IDLE' | 'PAUSED' | 'STOPPED' = 'STOPPED';

    if (mode === 'NORMAL') {
      if (this.running) {
        predictionEngineStatus = waConnected ? 'RUNNING' : 'PAUSED';
      } else {
        predictionEngineStatus = 'STOPPED';
      }
    } else if (mode === 'SESSION') {
      predictionEngineStatus = 'IDLE';
    } else {
      predictionEngineStatus = 'STOPPED';
    }

    const currentPeriodState = periodLifecycleManager.getCurrentPeriod();
    const currentPeriodFormatted = currentPeriodState
      ? {
          periodNumber: currentPeriodState.periodNumber,
          state: currentPeriodState.state,
          elapsedSeconds: currentPeriodState.elapsedSeconds,
          targetSeconds: 15,
          signalSent: currentPeriodState.signalSent,
          signalResult: currentPeriodState.signalResult,
        }
      : null;

    let nextCheckAtVal: string | null = null;
    if (currentPeriodState && (currentPeriodState.state === 'WAITING_15_SECONDS' || currentPeriodState.state === 'WAITING_40_SECONDS')) {
      nextCheckAtVal = new Date(currentPeriodState.target15PointMs || currentPeriodState.target40PointMs).toISOString();
    } else if (this.nextCheckAt) {
      nextCheckAtVal = this.nextCheckAt.toISOString();
    }

    return {
      mode,
      running: mode === 'NORMAL' && this.running,
      predictionEngineStatus,
      lastCycleAt: this.lastCycleAt ? this.lastCycleAt.toISOString() : null,
      lastIssue: this.lastIssue,
      nextCheckAt: nextCheckAtVal,
      currentPeriod: currentPeriodFormatted,
      latestSignal: null,
      lastError: this.lastError,
      pollingIntervalSeconds: this.pollingIntervalSeconds,
      confidenceThreshold: this.confidenceThreshold,
    };
  }
}

export const botRunner = new BotRunner();

// Wire period lifecycle manager trigger directly to BotRunner
periodLifecycleManager.registerSignalTriggerCallback(async (periodState) => {
  await botRunner.executePeriodSignal(periodState);
});
