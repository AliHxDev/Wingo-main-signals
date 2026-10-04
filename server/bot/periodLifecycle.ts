import { query } from '../db/index.js';
import { logger } from '../services/logger.js';

export type PeriodStateEnum =
  | 'DETECTED'
  | 'WAITING_15_SECONDS'
  | 'WAITING_40_SECONDS'
  | 'SIGNAL_SENT'
  | 'WAITING_RESULT'
  | 'WIN'
  | 'LOSS'
  | 'COMPLETED'
  | 'SKIPPED_LATE';

export interface WinGoPeriodState {
  periodNumber: string; // Unique business identifier e.g. "20260925100010491"
  periodStart: number; // UTC epoch in ms when THIS specific period started
  periodEnd: number; // UTC epoch in ms when THIS specific period ends (periodStart + 60,000ms)
  detectedAt: number; // UTC epoch in ms when discovered by polling
  target15PointMs: number; // UTC epoch in ms when THIS specific period reaches 15 seconds
  target40PointMs: number; // Backward compatibility alias
  targetSeconds: number; // 15
  elapsedSeconds: number; // Elapsed seconds within THIS specific period
  state: PeriodStateEnum;
  signalScheduled: boolean;
  signalSent: boolean;
  signalSentAt: number | null;
  signalResult: 'WIN' | 'LOSS' | null;
  completedAt: number | null;
  skippedReason?: string | null;
}

/**
 * Parses authoritative start timestamp in ms for a WinGo 1M period based on its period number.
 * Standard WinGo 1M format: YYYYMMDD10001XXXX
 * where XXXX is 1-1440 (1-based minute index of the UTC day).
 * Period begins at second 00 of that specific period's minute.
 * If format does not match, falls back to detectedAt timestamp.
 */
export function getPeriodStartTimeFromIssue(issueNumber: string, fallbackNow = Date.now()): number {
  if (!issueNumber) return fallbackNow;
  const match = issueNumber.trim().match(/^(\d{4})(\d{2})(\d{2})10001(\d{4})$/);
  if (match) {
    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10) - 1; // 0-indexed in JS Date
    const day = parseInt(match[3], 10);
    const periodIndex = parseInt(match[4], 10); // 1-1440
    const dayStartUtc = Date.UTC(year, month, day, 0, 0, 0, 0);
    return dayStartUtc + (periodIndex - 1) * 60 * 1000;
  }
  return fallbackNow;
}

/**
 * Calculates current UTC period number based on standard WinGo 1M format.
 */
export function formatWinGoIssueNumber(date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const periodIndex = hours * 60 + minutes + 1; // 1-1440
  return `${year}${month}${day}10001${String(periodIndex).padStart(4, '0')}`;
}

export type SignalTriggerCallback = (periodState: WinGoPeriodState) => Promise<void>;

export class PeriodLifecycleManager {
  private currentPeriodState: WinGoPeriodState | null = null;
  private previousPeriodStates: Map<string, WinGoPeriodState> = new Map();
  private signalTimer: NodeJS.Timeout | null = null;
  private activeTimerPeriod: string | null = null;
  private onSignalTrigger: SignalTriggerCallback | null = null;
  private lastLoggedElapsedSeconds = -1;

  /**
   * Registers callback to execute signal prediction and dispatch.
   */
  public registerSignalTriggerCallback(callback: SignalTriggerCallback): void {
    this.onSignalTrigger = callback;
  }

  /**
   * Returns current active period state.
   */
  public getCurrentPeriod(): WinGoPeriodState | null {
    if (this.currentPeriodState) {
      // Re-calculate live elapsed seconds
      const elapsedMs = Math.max(0, Date.now() - this.currentPeriodState.periodStart);
      this.currentPeriodState.elapsedSeconds = Math.floor(elapsedMs / 1000);
    }
    return this.currentPeriodState;
  }

  /**
   * Gets state for a past or tracked period.
   */
  public getPeriodState(periodNumber: string): WinGoPeriodState | null {
    if (this.currentPeriodState?.periodNumber === periodNumber) {
      return this.getCurrentPeriod();
    }
    return this.previousPeriodStates.get(periodNumber) || null;
  }

  /**
   * Called whenever polling discovers or returns a WinGo 1M period.
   *
   * POLLING BEHAVIOR:
   * When API returns 20260925100010491:
   * - recognize it as the current period
   * - create/restore its scheduler state
   * - track that exact period
   *
   * When API returns 20260925100010492:
   * - finalize the previous period appropriately
   * - create a NEW scheduler state for 10492
   * - start its 15-second lifecycle independently
   * - never reuse timer/state of 10491
   */
  public async onPeriodDetected(periodNumber: string, now = Date.now()): Promise<WinGoPeriodState> {
    if (!periodNumber) {
      throw new Error('Invalid periodNumber passed to onPeriodDetected');
    }

    // 1. Same period already being tracked
    if (this.currentPeriodState && this.currentPeriodState.periodNumber === periodNumber) {
      const elapsedMs = Math.max(0, now - this.currentPeriodState.periodStart);
      const elapsedSeconds = Math.floor(elapsedMs / 1000);
      this.currentPeriodState.elapsedSeconds = elapsedSeconds;

      // Periodically log waiting status
      if (
        (this.currentPeriodState.state === 'WAITING_15_SECONDS' || this.currentPeriodState.state === 'WAITING_40_SECONDS') &&
        elapsedSeconds !== this.lastLoggedElapsedSeconds &&
        elapsedSeconds < 15 &&
        elapsedSeconds % 5 === 0
      ) {
        this.lastLoggedElapsedSeconds = elapsedSeconds;
        this.logPeriodStatus(periodNumber, 'WAITING', elapsedSeconds, 15);
      }

      return this.currentPeriodState;
    }

    // 2. NEW PERIOD DETECTED (Transition to a new period)
    if (this.currentPeriodState) {
      this.finalizePreviousPeriod(this.currentPeriodState, now);
    }

    // Reset log tracker for new period
    this.lastLoggedElapsedSeconds = -1;

    // Create fresh state for this specific period (15s mark)
    const periodStart = getPeriodStartTimeFromIssue(periodNumber, now);
    const target15PointMs = periodStart + 15000;
    const target40PointMs = target15PointMs; // backward-compatibility alias
    const periodEnd = periodStart + 60000;
    const elapsedMs = Math.max(0, now - periodStart);
    const elapsedSeconds = Math.floor(elapsedMs / 1000);

    // DUPLICATE PROTECTION: Check if signal was already created in PostgreSQL
    const dbExisting = await query<any>(
      `SELECT id, status, sent_at FROM signals WHERE issue_number = $1`,
      [periodNumber]
    );
    const alreadyHasSignalInDb = dbExisting.rowCount > 0;

    let initialState: PeriodStateEnum = 'DETECTED';
    let signalScheduled = false;
    let signalSent = alreadyHasSignalInDb;
    let signalSentAt = alreadyHasSignalInDb && dbExisting.rows[0].sent_at
      ? new Date(dbExisting.rows[0].sent_at).getTime()
      : null;
    let skippedReason: string | null = null;

    if (alreadyHasSignalInDb) {
      initialState = 'WAITING_RESULT';
      signalScheduled = false;
      logger.info(
        { periodNumber },
        `[PERIOD LIFECYCLE] Period ${periodNumber} already has signal in database. Restoring state as WAITING_RESULT.`
      );
    } else if (elapsedSeconds >= 15) {
      // LATE-PERIOD POLICY:
      // If polling discovers a period after its first 15 seconds have already passed:
      // Do NOT blindly send an old signal.
      // Prefer skipping an already-expired signal opportunity and waiting for the next valid period.
      initialState = 'SKIPPED_LATE';
      signalScheduled = false;
      skippedReason = `Discovered late at ${elapsedSeconds}s (target 15s already elapsed).`;
      logger.warn(
        { periodNumber, elapsedSeconds },
        `[PERIOD LIFECYCLE] Period ${periodNumber} discovered late (${elapsedSeconds}s into period >= 15s). Skipping signal per late-period policy.`
      );
    } else {
      // Period is fresh (< 15s elapsed). Start 15-second lifecycle.
      initialState = 'WAITING_15_SECONDS';
      signalScheduled = true;
    }

    const newState: WinGoPeriodState = {
      periodNumber,
      periodStart,
      periodEnd,
      detectedAt: now,
      target15PointMs,
      target40PointMs,
      targetSeconds: 15,
      elapsedSeconds,
      state: initialState,
      signalScheduled,
      signalSent,
      signalSentAt,
      signalResult: null,
      completedAt: null,
      skippedReason,
    };

    this.currentPeriodState = newState;

    if (newState.state === 'WAITING_15_SECONDS' || newState.state === 'WAITING_40_SECONDS') {
      this.logPeriodStatus(periodNumber, 'WAITING', elapsedSeconds, 15);
      this.schedule15SecondTimerForPeriod(periodNumber, target15PointMs, now);
    }

    return newState;
  }

  /**
   * Finalizes previous period state cleanly without cross-period leaks.
   */
  private finalizePreviousPeriod(prev: WinGoPeriodState, now: number): void {
    // Cancel any active timer associated with previous period
    this.cancelPeriodTimer();

    if (prev.state === 'WAITING_15_SECONDS' || prev.state === 'WAITING_40_SECONDS') {
      prev.state = 'COMPLETED';
      prev.completedAt = now;
    } else if (prev.state === 'SIGNAL_SENT' || prev.state === 'WAITING_RESULT') {
      // Stays in WAITING_RESULT until settled by result watcher
    }

    // Keep in archive for inspection (max 20 entries)
    this.previousPeriodStates.set(prev.periodNumber, prev);
    if (this.previousPeriodStates.size > 20) {
      const oldestKey = this.previousPeriodStates.keys().next().value;
      if (oldestKey) this.previousPeriodStates.delete(oldestKey);
    }
  }

  /**
   * Schedules precision timer strictly for the 15-second point of THIS specific period.
   */
  public schedule15SecondTimerForPeriod(
    periodNumber: string,
    target15PointMs: number,
    now: number
  ): void {
    this.cancelPeriodTimer();

    const delayMs = Math.max(0, target15PointMs - now);
    this.activeTimerPeriod = periodNumber;

    logger.info(
      {
        periodNumber,
        delaySeconds: (delayMs / 1000).toFixed(1),
        target15Point: new Date(target15PointMs).toISOString(),
      },
      `[PERIOD TIMER] Scheduled signal for period ${periodNumber} in ${(delayMs / 1000).toFixed(1)}s (at 15 seconds into this period)`
    );

    this.signalTimer = setTimeout(async () => {
      try {
        await this.triggerSignalForPeriod(periodNumber, target15PointMs);
      } catch (err: any) {
        logger.error(
          { err: err.message, periodNumber },
          `[PERIOD TIMER] Error executing 15-second trigger for period ${periodNumber}`
        );
      }
    }, delayMs);
  }

  /**
   * Backward-compatible alias for 40-second timer method.
   */
  public schedule40SecondTimerForPeriod(
    periodNumber: string,
    targetPointMs: number,
    now: number
  ): void {
    this.schedule15SecondTimerForPeriod(periodNumber, targetPointMs, now);
  }

  /**
   * Validates and triggers signal execution at exactly 15 seconds into the period.
   *
   * PERIOD VALIDATION RULES:
   * 1. The period still exists.
   * 2. The period number is still the intended period.
   * 3. That period has not already received a signal.
   * 4. The period has not already been completed/expired.
   * 5. The scheduler is still associated with the same period.
   */
  public async triggerSignalForPeriod(
    periodNumber: string,
    targetPointMs?: number,
    executionTimeMs = Date.now()
  ): Promise<boolean> {
    const now = executionTimeMs;

    // 1. Verify period still exists in scheduler
    if (!this.currentPeriodState) {
      logger.warn({ periodNumber }, '[PERIOD VALIDATION] Failed: No active period in scheduler.');
      return false;
    }

    // 2. Verify period number matches intended period
    if (this.currentPeriodState.periodNumber !== periodNumber) {
      logger.warn(
        { requestedPeriod: periodNumber, currentPeriod: this.currentPeriodState.periodNumber },
        '[PERIOD VALIDATION] Failed: Period number mismatch.'
      );
      return false;
    }

    // 3. Verify period has not already received a signal (in-memory check)
    if (this.currentPeriodState.signalSent) {
      logger.info(
        { periodNumber },
        `[PERIOD VALIDATION] Failed: Period ${periodNumber} has already received a signal.`
      );
      return false;
    }

    // 3b. Verify period has not already received a signal (PostgreSQL atomic check)
    const existing = await query<any>(
      `SELECT id, status FROM signals WHERE issue_number = $1`,
      [periodNumber]
    );
    if (existing.rowCount > 0) {
      this.currentPeriodState.signalSent = true;
      this.currentPeriodState.state = 'WAITING_RESULT';
      logger.info(
        { periodNumber },
        `[PERIOD VALIDATION] Failed: Period ${periodNumber} already recorded in PostgreSQL.`
      );
      return false;
    }

    // 4. Verify period has not already been completed or expired
    if (this.currentPeriodState.state === 'COMPLETED' || now >= this.currentPeriodState.periodEnd) {
      logger.warn(
        { periodNumber, state: this.currentPeriodState.state, now, periodEnd: this.currentPeriodState.periodEnd },
        '[PERIOD VALIDATION] Failed: Period has already completed or expired.'
      );
      return false;
    }

    // 5. Verify scheduler timer association
    if (this.activeTimerPeriod && this.activeTimerPeriod !== periodNumber) {
      logger.warn(
        { periodNumber, activeTimerPeriod: this.activeTimerPeriod },
        '[PERIOD VALIDATION] Failed: Scheduler timer association mismatch.'
      );
      return false;
    }

    // Precision drift adjustment if timer triggered slightly early (< 1000ms drift)
    if (targetPointMs && now < targetPointMs) {
      const driftMs = targetPointMs - now;
      if (driftMs > 0 && driftMs < 1000) {
        await new Promise((res) => setTimeout(res, driftMs));
      }
    }

    // Validation PASSED! Trigger the signal for THIS specific period.
    this.currentPeriodState.state = 'SIGNAL_SENT';
    this.currentPeriodState.signalSent = true;
    this.currentPeriodState.signalSentAt = Date.now();
    this.currentPeriodState.elapsedSeconds = 15;

    // Required logging format
    this.logPeriodStatus(periodNumber, 'SIGNAL_SENT', 15, 15);

    try {
      if (this.onSignalTrigger) {
        await this.onSignalTrigger(this.currentPeriodState);
      }
      this.currentPeriodState.state = 'WAITING_RESULT';
      return true;
    } catch (err: any) {
      logger.error(
        { err: err.message, periodNumber },
        `[PERIOD LIFECYCLE] Error executing signal trigger callback for ${periodNumber}`
      );
      return false;
    }
  }

  /**
   * Settles result when drawn by WinGo game.
   */
  public onPeriodSettled(
    periodNumber: string,
    result: 'WIN' | 'LOSS',
    _actualNumber?: number,
    _actualSize?: string
  ): void {
    const state = this.getPeriodState(periodNumber);
    if (state) {
      state.signalResult = result;
      state.state = result;
      state.completedAt = Date.now();
      logger.info(
        { periodNumber, result },
        `[PERIOD RESULT] Period ${periodNumber} result confirmed: ${result}`
      );
    }
  }

  /**
   * Cancels active period timer.
   */
  public cancelPeriodTimer(): void {
    if (this.signalTimer) {
      clearTimeout(this.signalTimer);
      this.signalTimer = null;
    }
    this.activeTimerPeriod = null;
  }

  /**
   * Resets scheduler completely (e.g. on bot stop).
   */
  public reset(): void {
    this.cancelPeriodTimer();
    this.currentPeriodState = null;
  }

  /**
   * Formats and logs the required period status.
   */
  private logPeriodStatus(
    periodNumber: string,
    state: 'WAITING' | 'SIGNAL_SENT',
    elapsedSeconds: number,
    targetSeconds: number
  ): void {
    const formattedLog = `\n[PERIOD SIGNAL]\nPeriod: ${periodNumber}\nState: ${state}\nElapsed: ${elapsedSeconds} seconds\nTarget: ${targetSeconds} seconds\n`;
    console.log(formattedLog);
    logger.info({
      period: periodNumber,
      state,
      elapsed: `${elapsedSeconds}s`,
      target: `${targetSeconds}s`,
    }, `[PERIOD SIGNAL] Period ${periodNumber} - State: ${state} (${elapsedSeconds}s/${targetSeconds}s)`);
  }
}

export const periodLifecycleManager = new PeriodLifecycleManager();
