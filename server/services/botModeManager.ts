import { query } from '../db/index.js';
import { logger } from './logger.js';
import { whatsAppManager } from '../whatsapp/client.js';

export type BotMode = 'STOPPED' | 'NORMAL' | 'SESSION';

export interface PredictionGateResult {
  allowed: boolean;
  mode: BotMode;
  reason: string;
  session?: any;
}

export class BotModeManager {
  private currentMode: BotMode = 'STOPPED';
  private isInitialized = false;

  /**
   * Initializes bot mode on server startup from PostgreSQL.
   */
  async initOnStartup(): Promise<BotMode> {
    try {
      const res = await query<{ value: string }>(
        `SELECT value FROM settings WHERE key = 'bot_mode'`
      );
      if (res.rowCount && res.rows[0]?.value) {
        const val = res.rows[0].value.trim().toUpperCase() as BotMode;
        if (val === 'NORMAL' || val === 'SESSION' || val === 'STOPPED') {
          this.currentMode = val;
        }
      } else {
        // Seed default STOPPED if not present
        await query(
          `INSERT INTO settings (key, value, updated_at) VALUES ('bot_mode', 'STOPPED', NOW())
           ON CONFLICT (key) DO NOTHING`
        );
        this.currentMode = 'STOPPED';
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to read initial bot_mode from database; defaulting to STOPPED');
      this.currentMode = 'STOPPED';
    }

    this.isInitialized = true;
    logger.info(`[BOT MODE] Restored authoritative bot_mode from PostgreSQL: ${this.currentMode}`);

    // Restore state based on loaded mode
    if (this.currentMode === 'NORMAL') {
      logger.info('[STARTUP] Restoring NORMAL BOT mode...');
      try {
        const { botRunner } = await import('../bot/runner.js');
        await botRunner.startNormal();
      } catch (err: any) {
        logger.error({ err: err.message }, 'Failed to restore NORMAL bot mode on startup');
      }
    } else if (this.currentMode === 'SESSION') {
      logger.info('[STARTUP] Restoring SESSION scheduler mode...');
      try {
        const { sessionScheduler } = await import('./sessionScheduler.js');
        const { botRunner } = await import('../bot/runner.js');
        // Ensure result watcher is running so results settle
        botRunner.startResultWatcher();
        await sessionScheduler.startSessionMode();
      } catch (err: any) {
        logger.error({ err: err.message }, 'Failed to restore SESSION mode on startup');
      }
    } else {
      logger.info('[STARTUP] Bot mode is STOPPED. Standby.');
      try {
        const { botRunner } = await import('../bot/runner.js');
        // Run result watcher passively in background for in-flight signal settlement if any
        botRunner.startResultWatcher();
      } catch {}
    }

    return this.currentMode;
  }

  /**
   * Returns current in-memory bot mode.
   */
  getMode(): BotMode {
    return this.currentMode;
  }

  /**
   * Updates in-memory bot mode.
   */
  setMode(mode: BotMode): void {
    this.currentMode = mode;
  }

  /**
   * Synchronously or asynchronously reads mode from database if not yet initialized.
   */
  async getAuthoritativeMode(): Promise<BotMode> {
    try {
      const res = await query<{ value: string }>(
        `SELECT value FROM settings WHERE key = 'bot_mode'`
      );
      if (res.rowCount && res.rows[0]?.value) {
        const val = res.rows[0].value.trim().toUpperCase() as BotMode;
        if (val === 'NORMAL' || val === 'SESSION' || val === 'STOPPED') {
          this.currentMode = val;
          return val;
        }
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to fetch bot_mode from DB');
    }
    return this.currentMode;
  }

  /**
   * Persists mode in PostgreSQL settings table.
   */
  private async persistMode(mode: BotMode): Promise<void> {
    this.currentMode = mode;
    try {
      await query(
        `INSERT INTO settings (key, value, updated_at) VALUES ('bot_mode', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [mode]
      );

      const schedEnabled = mode === 'SESSION' ? 'true' : 'false';
      await query(
        `INSERT INTO settings (key, value, updated_at) VALUES ('session_scheduler_enabled', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [schedEnabled]
      );
      await query(
        `INSERT INTO settings (key, value, updated_at) VALUES ('schedule_enabled', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [schedEnabled]
      );
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to persist bot_mode in database');
    }
  }

  /**
   * Transition: -> NORMAL MODE
   * Activated by admin clicking "START BOT".
   *
   * 1. If already NORMAL, idempotently return current status without duplicate loops.
   * 2. If SESSION mode active, safely stop SESSION mode first.
   * 3. Set bot_mode = "NORMAL" in PostgreSQL.
   * 4. Session scheduler must NOT start.
   * 5. Sessions must NOT become RUNNING.
   * 6. Session timers must NOT control predictions.
   * 7. Session target must NOT stop normal bot.
   * 8. Start normal prediction loop.
   */
  async startNormalMode(): Promise<any> {
    const { botRunner } = await import('../bot/runner.js');
    const { sessionScheduler } = await import('./sessionScheduler.js');

    // Idempotency check: if already in NORMAL mode and running, return current status
    if (this.currentMode === 'NORMAL' && botRunner.getStatus().running) {
      logger.info('[BOT MODE] Already running in NORMAL mode. Skipping duplicate start.');
      return botRunner.getStatus();
    }

    // Safely stop SESSION mode if active
    if (this.currentMode === 'SESSION') {
      logger.info('[BOT MODE] Switching from SESSION mode to NORMAL mode. Safely stopping session scheduler...');
      await sessionScheduler.stopSessionMode();
    }

    // Persist new authoritative mode
    await this.persistMode('NORMAL');
    logger.info('[BOT MODE] 🟢 Switched to NORMAL BOT MODE');

    // Start normal bot runner
    const status = await botRunner.startNormal();
    return status;
  }

  /**
   * Transition: NORMAL -> STOPPED
   * Activated by admin clicking "STOP BOT".
   *
   * 1. Set bot_mode = "STOPPED" in PostgreSQL.
   * 2. Stop normal prediction loop.
   * 3. Do not modify session configurations.
   * 4. Do not delete scheduled sessions.
   * 5. Do not automatically activate session mode.
   */
  async stopNormalMode(): Promise<any> {
    const { botRunner } = await import('../bot/runner.js');

    await this.persistMode('STOPPED');
    logger.info('[BOT MODE] ⚪ Stopped NORMAL BOT MODE');

    const status = botRunner.stopNormal();
    return status;
  }

  /**
   * Transition: -> SESSION MODE
   * Activated by admin clicking "START SESSIONS".
   *
   * 1. If already SESSION, idempotently return current status without duplicate schedulers.
   * 2. If NORMAL mode active, safely stop NORMAL mode first.
   * 3. Set bot_mode = "SESSION" and session_scheduler_enabled = "true" in PostgreSQL.
   * 4. Start session scheduler.
   * 5. Evaluate configured schedule, wait for start time, start session automatically.
   */
  async startSessionMode(): Promise<any> {
    const { botRunner } = await import('../bot/runner.js');
    const { sessionScheduler } = await import('./sessionScheduler.js');

    // Idempotency check
    if (this.currentMode === 'SESSION' && sessionScheduler.isSessionRunning()) {
      logger.info('[BOT MODE] Already running in SESSION mode. Skipping duplicate start.');
      return sessionScheduler.getSchedulerStatus();
    }

    // Safely stop NORMAL mode if active
    if (this.currentMode === 'NORMAL') {
      logger.info('[BOT MODE] Switching from NORMAL mode to SESSION mode. Safely stopping normal bot...');
      botRunner.stopNormal();
    }

    // Persist new authoritative mode
    await this.persistMode('SESSION');
    logger.info('[BOT MODE] 🟣 Switched to SESSION MODE');

    // Start session scheduler and watcher
    botRunner.startResultWatcher();
    const status = await sessionScheduler.startSessionMode();

    // Trigger immediate reminder check for on-time or catch-up reminders
    const { sessionReminderService } = await import('./sessionReminderService.js');
    sessionReminderService.checkAndTriggerStartupReminder().catch(() => {});

    return status;
  }

  /**
   * Transition: SESSION -> STOPPED
   * Activated by admin clicking "STOP SESSIONS".
   *
   * 1. Set bot_mode = "STOPPED" and session_scheduler_enabled = "false" in PostgreSQL.
   * 2. Stop NEW session predictions.
   * 3. Cancel/pause active session safely in bot_sessions.
   * 4. Do not delete session history or configs.
   * 5. Do not automatically switch to NORMAL mode.
   */
  async stopSessionMode(): Promise<any> {
    const { sessionScheduler } = await import('./sessionScheduler.js');

    await this.persistMode('STOPPED');
    logger.info('[BOT MODE] ⚪ Stopped SESSION MODE');

    const status = await sessionScheduler.stopSessionMode();
    return status;
  }

  /**
   * Single Prediction Engine Gatekeeper (Requirement 12).
   *
   * ONE prediction engine service that receives current mode: NORMAL or SESSION.
   *
   * canGeneratePrediction():
   * if bot_mode === "NORMAL":
   *     return normalBotRules()
   * if bot_mode === "SESSION":
   *     return sessionRules()
   * if bot_mode === "STOPPED":
   *     return false
   */
  async canGeneratePrediction(): Promise<PredictionGateResult> {
    const mode = this.currentMode;

    // Both modes require WhatsApp to be ready before sending signals (Requirement 1, 2 & 11)
    const waCheck = await whatsAppManager.isReady();
    if (!waCheck.ready) {
      return {
        allowed: false,
        mode,
        reason: waCheck.reason || 'Waiting for WhatsApp connection',
      };
    }

    if (mode === 'STOPPED') {
      return {
        allowed: false,
        mode: 'STOPPED',
        reason: 'Bot is stopped (STOPPED mode)',
      };
    }

    // 1. NORMAL BOT RULES
    if (mode === 'NORMAL') {
      // Normal bot rules:
      // - Session scheduler must NOT start
      // - Sessions must NOT become RUNNING
      // - Session timers must NOT control predictions
      // - Session target must NOT stop normal bot
      // - Normal bot continues until admin clicks STOP BOT
      return {
        allowed: true,
        mode: 'NORMAL',
        reason: 'Normal bot mode active and WhatsApp ready',
      };
    }

    // 2. SESSION MODE RULES
    if (mode === 'SESSION') {
      const { sessionScheduler } = await import('./sessionScheduler.js');
      const active = await sessionScheduler.getActiveSession();

      if (!active) {
        const next = await sessionScheduler.getNextScheduledSession();
        if (next) {
          return {
            allowed: false,
            mode: 'SESSION',
            reason: `No live session active. Next scheduled: "${next.name}" starts at ${next.startTimeFormatted} (${next.startsInFormatted} left)`,
          };
        }
        return {
          allowed: false,
          mode: 'SESSION',
          reason: 'No active session running currently',
        };
      }

      if (active.status !== 'RUNNING') {
        return {
          allowed: false,
          mode: 'SESSION',
          reason: `Active session is in status ${active.status}`,
        };
      }

      // Session target: Only session mode uses session target
      if (active.wins >= active.target_wins) {
        return {
          allowed: false,
          mode: 'SESSION',
          reason: `Target of ${active.target_wins} WINs already reached (${active.wins}/${active.target_wins}). Session completed.`,
          session: active,
        };
      }

      const nowTz = await sessionScheduler.getNowTz();
      const nowTimeStr = nowTz.toFormat('HH:mm');

      // Start time check
      if (nowTimeStr < active.start_time && !active.started_at) {
        return {
          allowed: false,
          mode: 'SESSION',
          reason: `Session start time ${active.start_time} has not arrived yet (current: ${nowTimeStr} Asia/Karachi)`,
          session: active,
        };
      }

      return {
        allowed: true,
        mode: 'SESSION',
        reason: `Live session active: ${active.session_name} (${active.wins}/${active.target_wins} WINs)`,
        session: active,
      };
    }

    return {
      allowed: false,
      mode: 'STOPPED',
      reason: 'Unknown bot mode',
    };
  }
}

export const botModeManager = new BotModeManager();
