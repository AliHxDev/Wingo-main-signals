import { DateTime } from 'luxon';
import { query } from '../db/index.js';
import { logger } from './logger.js';
import { whatsAppManager } from '../whatsapp/client.js';
import { getActiveWhatsAppDestination } from './destination.js';
import { botModeManager } from './botModeManager.js';
import {
  renderDynamicTargetComplete,
  renderDynamicSessionHistory,
} from '../utils/formatters.js';

export interface SessionConfig {
  id: number;
  session_name: string;
  start_time: string; // "HH:mm" 24h e.g. "06:00", "14:00", "20:00"
  end_time?: string | null;
  enabled: boolean;
  target_wins: number;
  min_confidence: number;
  signal_delay_min: number;
  signal_delay_max: number;
  created_at?: string;
  updated_at?: string;
}

export interface BotSession {
  id: number;
  session_config_id: number | null;
  session_name: string;
  schedule_date: string; // "YYYY-MM-DD"
  date?: string; // alias
  start_time: string; // "HH:mm"
  end_time?: string | null;
  status: 'SCHEDULED' | 'RUNNING' | 'TARGET_COMPLETED' | 'STOPPED' | 'CANCELLED';
  target_wins: number;
  wins: number;
  losses: number;
  total_signals: number;
  win_rate: number;
  started_at: string | null;
  completed_at: string | null;
  target_completion_status?: 'PENDING' | 'SENT' | 'FAILED' | null;
  target_completion_scheduled_for?: string | null;
  target_completion_sent_at?: string | null;
  target_message_sent_at?: string | null;
  history_message_status?: 'PENDING' | 'SENT' | 'FAILED' | null;
  history_scheduled_for?: string | null;
  history_message_sent_at?: string | null;
  history_sent_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface NextSessionInfo {
  configId: number;
  name: string;
  startTime: string; // "06:00"
  startTimeFormatted: string; // "06:00 AM"
  endTime?: string | null;
  startDate: string; // "YYYY-MM-DD"
  startsInSeconds: number;
  startsInFormatted: string; // "HH:mm:ss"
  targetWins: number;
}

export interface SchedulerStatus {
  timezone: string;
  currentTime: string;
  currentDate: string;
  botMode: 'STOPPED' | 'NORMAL' | 'SESSION';
  scheduleEnabled: boolean;
  predictionEngineStatus: 'RUNNING' | 'IDLE' | 'PAUSED' | 'STOPPED';
  predictionEngineReason: string;
  sessionStateDisplay: string;
  currentSession: BotSession | null;
  activeSession: BotSession | null;
  remainingWins: number | null;
  whatsAppReady?: boolean;
  whatsAppStatus?: string;
  nextSession: NextSessionInfo | null;
  configs: SessionConfig[];
  todaySessions: BotSession[];
}

export class SessionScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isTicking = false;
  private isStarted = false;
  private defaultTimezone = 'Asia/Karachi';

  isSessionRunning(): boolean {
    return this.isStarted && botModeManager.getMode() === 'SESSION';
  }

  /**
   * Starts session scheduler mode authoritatively.
   */
  async startSessionMode(): Promise<SchedulerStatus> {
    botModeManager.setMode('SESSION');
    if (this.isStarted) {
      await this.tick();
      return this.getSchedulerStatus();
    }

    this.isStarted = true;
    logger.info('Starting WinGo Server-Side Persistent Session Scheduler (SESSION MODE)...');

    // Startup recovery
    await this.recoverOnStartup();

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    // High-frequency 2-second tick loop
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        logger.error({ err: err.message }, 'Error in SessionScheduler tick');
      });
    }, 2000);

    // Initial immediate tick
    await this.tick();

    // Start result watcher in botRunner
    try {
      const { botRunner } = await import('../bot/runner.js');
      botRunner.startResultWatcher();
      // Only schedule next signal if a session is ACTUALLY active and running right now
      const active = await this.getActiveSession();
      if (active && active.status === 'RUNNING') {
        botRunner.scheduleNext15SecondSignal();
      }
    } catch {}

    return this.getSchedulerStatus();
  }

  /**
   * Stops session scheduler mode authoritatively.
   */
  async stopSessionMode(): Promise<SchedulerStatus> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isStarted = false;
    if (botModeManager.getMode() === 'SESSION') {
      botModeManager.setMode('STOPPED');
    }

    // Safely stop any active running session in DB
    await this.stopActiveSession();

    try {
      const { botRunner } = await import('../bot/runner.js');
      botRunner.cancelPendingScheduledSignals();
    } catch {}

    logger.info('WinGo Session Scheduler stopped.');
    return this.getSchedulerStatus();
  }

  /**
   * Initializes the scheduler loop on server startup.
   * Runs 100% server-side in Node.js independent of any client browser.
   */
  async start(): Promise<void> {
    await this.startSessionMode();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isStarted = false;
    logger.info('WinGo Session Scheduler stopped.');
  }

  /**
   * Helper to format 24h time to 12h AM/PM
   */
  public format12h(time24: string): string {
    if (!time24) return '';
    const parts = time24.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1] || '0', 10);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 || 12;
    return `${h12.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  }

  /**
   * Reads configured timezone from settings, falling back strictly to Asia/Karachi.
   */
  async getTimezone(): Promise<string> {
    try {
      const res = await query<{ value: string }>(
        `SELECT value FROM settings WHERE key = 'bot_timezone'`
      );
      return res.rows[0]?.value?.trim() || this.defaultTimezone;
    } catch {
      return this.defaultTimezone;
    }
  }

  /**
   * Gets current DateTime strictly in configured timezone (Asia/Karachi).
   */
  async getNowTz(): Promise<DateTime> {
    const tz = await this.getTimezone();
    return DateTime.now().setZone(tz);
  }

  /**
   * Checks if automatic daily schedule is enabled in PostgreSQL.
   */
  async isScheduleEnabled(): Promise<boolean> {
    return botModeManager.getMode() === 'SESSION';
  }

  /**
   * Enables or disables the automatic daily schedule in PostgreSQL via botModeManager.
   */
  async setScheduleEnabled(enabled: boolean): Promise<SchedulerStatus> {
    if (enabled) {
      await botModeManager.startSessionMode();
    } else {
      await botModeManager.stopSessionMode();
    }
    return this.getSchedulerStatus();
  }

  async enableSchedule(): Promise<SchedulerStatus> {
    return this.setScheduleEnabled(true);
  }

  async disableSchedule(): Promise<SchedulerStatus> {
    return this.setScheduleEnabled(false);
  }

  /**
   * Authoritative SQL query base that joins bot_sessions with recorded signal results.
   * GUARANTEES:
   * 1. TOTAL = WIN + LOSS invariant holds 100% of the time.
   * 2. Counters are derived directly from the authoritative signal records, never trusting stale cached counters.
   */
  private getSessionSelectWithStatsQuery(): string {
    return `
      SELECT 
        s.id,
        s.session_config_id,
        s.session_name,
        s.schedule_date,
        s.date,
        s.start_time,
        s.end_time,
        s.status,
        s.target_wins,
        COALESCE(sig.wins, 0)::integer as wins,
        COALESCE(sig.losses, 0)::integer as losses,
        COALESCE(sig.total, 0)::integer as total_signals,
        s.started_at,
        s.completed_at,
        s.target_completion_status,
        s.target_completion_scheduled_for,
        s.target_completion_sent_at,
        s.target_message_sent_at,
        s.history_message_status,
        s.history_scheduled_for,
        s.history_message_sent_at,
        s.history_sent_at,
        s.created_at,
        s.updated_at
      FROM bot_sessions s
      LEFT JOIN (
        SELECT 
          session_id,
          COUNT(DISTINCT CASE WHEN status = 'WIN' THEN issue_number END) as wins,
          COUNT(DISTINCT CASE WHEN status = 'LOSS' THEN issue_number END) as losses,
          COUNT(DISTINCT CASE WHEN status IN ('WIN', 'LOSS') THEN issue_number END) as total
        FROM signals
        WHERE session_id IS NOT NULL
        GROUP BY session_id
      ) sig ON s.id = sig.session_id
    `;
  }

  /**
   * Gets current active RUNNING session with authoritative statistics.
   */
  async getActiveSession(): Promise<BotSession | null> {
    try {
      const nowTz = await this.getNowTz();
      const todayDateStr = nowTz.toFormat('yyyy-MM-dd');

      // Auto-expire any stale RUNNING session left behind from previous dates
      await query(
        `UPDATE bot_sessions 
         SET status = 'COMPLETED', completed_at = COALESCE(completed_at, NOW()), updated_at = NOW() 
         WHERE status = 'RUNNING' AND schedule_date < $1`,
        [todayDateStr]
      ).catch(() => {});

      const res = await query<any>(
        `${this.getSessionSelectWithStatsQuery()} WHERE s.status = 'RUNNING' AND s.schedule_date = $1 ORDER BY s.id DESC LIMIT 1`,
        [todayDateStr]
      );
      if (res.rowCount === 0) return null;
      return this.mapSessionRow(res.rows[0]);
    } catch (err: any) {
      logger.error({ err: err.message }, 'Error getting active session');
      return null;
    }
  }

  /**
   * Gets the current session for today (RUNNING > SCHEDULED > TARGET_COMPLETED > STOPPED).
   */
  async getCurrentSessionForToday(): Promise<BotSession | null> {
    try {
      const nowTz = await this.getNowTz();
      const todayDateStr = nowTz.toFormat('yyyy-MM-dd');
      const res = await query<any>(
        `${this.getSessionSelectWithStatsQuery()}
         WHERE s.schedule_date = $1 
         ORDER BY 
           CASE s.status 
             WHEN 'RUNNING' THEN 1 
             WHEN 'SCHEDULED' THEN 2 
             WHEN 'TARGET_COMPLETED' THEN 3
             ELSE 4 
           END,
           s.id DESC 
         LIMIT 1`,
        [todayDateStr]
      );
      if (res.rowCount === 0) return null;
      return this.mapSessionRow(res.rows[0]);
    } catch (err: any) {
      logger.error({ err: err.message }, 'Error getting current session for today');
      return null;
    }
  }

  /**
   * Gets all sessions recorded for today with authoritative statistics.
   */
  async getTodaySessions(): Promise<BotSession[]> {
    try {
      const nowTz = await this.getNowTz();
      const todayDateStr = nowTz.toFormat('yyyy-MM-dd');
      const res = await query<any>(
        `${this.getSessionSelectWithStatsQuery()} WHERE s.schedule_date = $1 ORDER BY s.start_time ASC, s.id ASC`,
        [todayDateStr]
      );
      return res.rows.map((r) => this.mapSessionRow(r));
    } catch {
      return [];
    }
  }

  /**
   * Gets all configured session definitions from PostgreSQL.
   */
  async getSessionConfigs(): Promise<SessionConfig[]> {
    try {
      const res = await query<SessionConfig>(
        `SELECT * FROM session_configs ORDER BY start_time ASC`
      );
      return res.rows;
    } catch (err: any) {
      logger.error({ err: err.message }, 'Error getting session configs');
      return [];
    }
  }

  async getSessionConfigById(id: number): Promise<SessionConfig | null> {
    const res = await query<SessionConfig>('SELECT * FROM session_configs WHERE id = $1', [id]);
    return res.rows[0] || null;
  }

  async createSessionConfig(data: {
    session_name: string;
    start_time: string;
    target_wins?: number;
    min_confidence?: number;
    signal_delay_min?: number;
    signal_delay_max?: number;
    enabled?: boolean;
  }): Promise<SessionConfig> {
    const res = await query<SessionConfig>(
      `INSERT INTO session_configs (
        session_name, start_time, target_wins, min_confidence, signal_delay_min, signal_delay_max, enabled
      ) VALUES ($1, $2, $3, $4, 15, 15, $5)
      RETURNING *`,
      [
        data.session_name,
        data.start_time,
        data.target_wins ?? 10,
        data.min_confidence ?? 65,
        data.enabled ?? true,
      ]
    );
    return res.rows[0];
  }

  async updateSessionConfig(
    id: number,
    data: Partial<SessionConfig>
  ): Promise<SessionConfig | null> {
    const existing = await this.getSessionConfigById(id);
    if (!existing) return null;

    const res = await query<SessionConfig>(
      `UPDATE session_configs SET
        session_name = COALESCE($1, session_name),
        start_time = COALESCE($2, start_time),
        target_wins = COALESCE($3, target_wins),
        min_confidence = COALESCE($4, min_confidence),
        enabled = COALESCE($5, enabled),
        updated_at = NOW()
      WHERE id = $6
      RETURNING *`,
      [
        data.session_name,
        data.start_time,
        data.target_wins,
        data.min_confidence,
        data.enabled,
        id,
      ]
    );
    return res.rows[0] || null;
  }

  /**
   * Safely deletes a session configuration from PostgreSQL.
   * If the session is currently active/running, stops it cleanly first,
   * cancels its pending timers, and keeps the scheduler running smoothly.
   */
  async deleteSessionConfig(id: number): Promise<boolean> {
    try {
      // Find if there is an active running session for this config
      const activeRes = await query<BotSession>(
        `SELECT * FROM bot_sessions WHERE session_config_id = $1 AND status = 'RUNNING'`,
        [id]
      );
      for (const active of activeRes.rows) {
        // Safely stop the running session
        await query(
          `UPDATE bot_sessions SET status = 'STOPPED', updated_at = NOW() WHERE id = $1`,
          [active.id]
        );
        // Cancel pending timers
        try {
          const { botRunner } = await import('../bot/runner.js');
          botRunner.cancelPendingScheduledSignals(active.id);
        } catch {}
        console.log(`[SESSION] Active session #${active.id} safely stopped prior to session config deletion.`);
      }

      // Now delete from session_configs (bot_sessions history is preserved via ON DELETE SET NULL!)
      const res = await query('DELETE FROM session_configs WHERE id = $1', [id]);
      return (res.rowCount || 0) > 0;
    } catch (err: any) {
      logger.error({ err: err.message, configId: id }, 'Error deleting session config safely');
      throw err;
    }
  }

  /**
   * Prediction loop gatekeeper.
   * Delegates authoritatively to botModeManager (Requirement 12).
   */
  async canGeneratePrediction(): Promise<{
    allowed: boolean;
    reason: string;
    session?: BotSession;
  }> {
    const gate = await botModeManager.canGeneratePrediction();
    return {
      allowed: gate.allowed,
      reason: gate.reason,
      session: gate.session,
    };
  }

  /**
   * Handles startup recovery:
   * Resumes active RUNNING session if target has not been reached.
   * If target was reached while offline, completes it.
   */
  async recoverOnStartup(): Promise<void> {
    try {
      const nowTz = await this.getNowTz();
      const todayDateStr = nowTz.toFormat('yyyy-MM-dd');
      const nowTimeStr = nowTz.toFormat('HH:mm');

      logger.info(
        `[SESSION] Startup recovery check at ${nowTimeStr} Asia/Karachi (Date: ${todayDateStr})`
      );

      // Check for any active RUNNING session in database
      const active = await this.getActiveSession();
      if (active) {
        // Sync stats from signals
        await this.syncSessionStats(active.id);
        const refreshed = await this.getSessionById(active.id);

        if (!refreshed) return;

        // If target already reached, complete it now
        if (refreshed.wins >= refreshed.target_wins) {
          console.log(
            `[SESSION] Active session #${refreshed.id} on startup already reached target wins (${refreshed.wins}/${refreshed.target_wins}). Completing session.`
          );
          await this.completeSessionTarget(refreshed.id);
          await this.processPendingTargetCompletions();
          return;
        }

        console.log(
          `[SESSION] Resumed active running session: ${refreshed.session_name} (${refreshed.wins}/${refreshed.target_wins} WINs). Prediction engine RUNNING.`
        );
      } else {
        console.log(`[SESSION] No active session currently running on startup. Standby.`);
      }

      // Process any pending completion or history message deliveries from previous runs
      await this.processPendingTargetCompletions();
    } catch (err: any) {
      logger.error({ err: err.message }, 'Error during session startup recovery');
    }
  }

  /**
   * Periodic server-side scheduler tick (runs every 2 seconds).
   *
   * Core logic:
   * 1. If an active session is RUNNING:
   *    - Sync wins/losses from signals table.
   *    - Check if wins >= target_wins:
   *      If YES: completeSessionTarget()! Status becomes TARGET_COMPLETED.
   *      Prediction engine immediately stops!
   *    - Return. (No other session can start while one is running).
   * 2. If NO session is RUNNING:
   *    - If schedule_enabled is false, do nothing.
   *    - Check enabled session configs for today.
   *    - If a session is due (current time >= start_time) and has not completed today:
   *      Start that session automatically (Status -> RUNNING).
   *      Immediately trigger botRunner cycle.
   *    - If start time has not arrived yet (e.g. 05:30 AM < 06:00 AM):
   *      Ensure next session is created with status = 'SCHEDULED'.
   *      Prediction engine remains IDLE.
   */
  async tick(): Promise<void> {
    if (this.isTicking) return;
    this.isTicking = true;

    try {
      // Process any pending delayed completion or history messages across all completed sessions
      await this.processPendingTargetCompletions();

      // 0. Only execute scheduler ticks in SESSION mode! (Requirement 1 & 4)
      const currentMode = botModeManager.getMode();
      if (currentMode !== 'SESSION') {
        return;
      }

      // 1. Check if there is an active RUNNING session
      const activeSession = await this.getActiveSession();
      if (activeSession) {
        // Refresh session counts
        await this.syncSessionStats(activeSession.id);
        const refreshed = await this.getSessionById(activeSession.id);

        if (refreshed) {
          // Check target reached
          if (refreshed.wins >= refreshed.target_wins) {
            console.log(
              `[SESSION] ${refreshed.session_name} target reached: ${refreshed.wins}/${refreshed.target_wins} WIN`
            );
            await this.completeSessionTarget(refreshed.id);
            return;
          }
        }

        // WhatsApp safety check during running session (Requirement 5)
        const waCheck = await whatsAppManager.isReady();
        if (!waCheck.ready) {
          // Active session disconnect: immediately stop NEW predictions, keep DB state intact
          return;
        }

        return;
      }

      // 2. No active RUNNING session.
      // If schedule is disabled by admin, do not start sessions automatically
      const isSchedEnabled = await this.isScheduleEnabled();
      if (!isSchedEnabled) {
        return;
      }

      const nowTz = await this.getNowTz();
      const todayDateStr = nowTz.toFormat('yyyy-MM-dd');
      const nowTimeStr = nowTz.toFormat('HH:mm');

      const configs = await this.getSessionConfigs();
      const enabledConfigs = configs.filter((c) => c.enabled);
      if (enabledConfigs.length === 0) return;

      // Fetch all today's session rows from bot_sessions
      const todaySessionsRes = await query<BotSession>(
        `SELECT * FROM bot_sessions WHERE schedule_date = $1`,
        [todayDateStr]
      );
      const todayMap = new Map<number, BotSession>();
      for (const s of todaySessionsRes.rows) {
        if (s.session_config_id) {
          todayMap.set(s.session_config_id, s);
        }
      }

      // Evaluate each enabled session configuration for today against current Pakistan time
      const dueConfigs: SessionConfig[] = [];
      const upcomingConfigs: { config: SessionConfig; startDt: DateTime; diffSeconds: number }[] = [];

      for (const config of enabledConfigs) {
        if (!config.start_time || typeof config.start_time !== 'string') continue;
        const [h, m] = config.start_time.split(':').map(Number);
        if (isNaN(h) || isNaN(m)) continue;

        const s = todayMap.get(config.id);

        // If this session has already completed, stopped, or missed for today, skip it
        if (s && s.status !== 'SCHEDULED') {
          continue;
        }

        const configStartDt = nowTz.set({ hour: h, minute: m, second: 0, millisecond: 0 });
        const diffSeconds = Math.floor(nowTz.diff(configStartDt).as('seconds'));

        // Case 1: Start time is in the future (diffSeconds < 0)
        if (diffSeconds < 0) {
          upcomingConfigs.push({
            config,
            startDt: configStartDt,
            diffSeconds: Math.abs(diffSeconds),
          });

          // Ensure next upcoming session is tracked as SCHEDULED in database
          if (!s) {
            await query(
              `INSERT INTO bot_sessions (
                session_config_id, session_name, schedule_date, date, start_time,
                status, target_wins, created_at, updated_at
              ) VALUES ($1, $2, $3, $3, $4, 'SCHEDULED', $5, NOW(), NOW())
              ON CONFLICT (session_config_id, schedule_date) DO NOTHING`,
              [config.id, config.session_name, todayDateStr, config.start_time, config.target_wins]
            ).catch(() => {});
          }
          continue;
        }

        // Case 2: Scheduled start time arrived RIGHT NOW (within 0 to 180 seconds, 0-3 minutes of start time)
        if (diffSeconds >= 0 && diffSeconds < 180) {
          dueConfigs.push(config);
          continue;
        }

        // Case 3: Start time was in the past (> 3 minutes ago) and was not run earlier today
        // Mark as MISSED so it NEVER starts late, hours later, or after another session completes!
        if (!s || s.status === 'SCHEDULED') {
          await query(
            `INSERT INTO bot_sessions (
              session_config_id, session_name, schedule_date, date, start_time,
              status, target_wins, created_at, updated_at
            ) VALUES ($1, $2, $3, $3, $4, 'MISSED', $5, NOW(), NOW())
            ON CONFLICT (session_config_id, schedule_date) 
            DO UPDATE SET status = 'MISSED', updated_at = NOW()
            WHERE bot_sessions.status = 'SCHEDULED'`,
            [config.id, config.session_name, todayDateStr, config.start_time, config.target_wins]
          ).catch(() => {});
        }
      }

      if (dueConfigs.length > 0) {
        // Sort ascending by start_time and take the config whose time has arrived right now
        dueConfigs.sort((a, b) => a.start_time.localeCompare(b.start_time));
        const configToStart = dueConfigs[dueConfigs.length - 1];

        // Requirement 1 & 3: Check WhatsApp connection before starting session
        const waCheck = await whatsAppManager.isReady();
        if (!waCheck.ready) {
          // Disconnected at session start (Requirement 3):
          // DO NOT start the session as RUNNING!
          // DO NOT generate predictions.
          // DO NOT send signals.
          // Ensure session is tracked as SCHEDULED waiting for WhatsApp.
          const existingSession = todayMap.get(configToStart.id);
          if (!existingSession) {
            await query(
              `INSERT INTO bot_sessions (
                session_config_id, session_name, schedule_date, date, start_time,
                status, target_wins, created_at, updated_at
              ) VALUES ($1, $2, $3, $3, $4, 'SCHEDULED', $5, NOW(), NOW())
              ON CONFLICT (session_config_id, schedule_date) DO NOTHING`,
              [configToStart.id, configToStart.session_name, todayDateStr, configToStart.start_time, configToStart.target_wins]
            );
          }
          return;
        }

        console.log(`[SESSION] Current time: ${nowTimeStr} Asia/Karachi`);
        console.log(
          `[SESSION] WhatsApp ready. Starting scheduled session: "${configToStart.session_name}" (Target: ${configToStart.target_wins} WINs)`
        );

        await this.createAndStartSession(configToStart, todayDateStr);

        // Immediately trigger botRunner to start predictions without waiting
        try {
          const { botRunner } = await import('../bot/runner.js');
          botRunner.startResultWatcher();
          botRunner.detectAndTrackCurrentPeriod().catch(() => {});
          botRunner.scheduleNext15SecondSignal();
        } catch {}

        return;
      }

      // If no config is due right now, ensure the earliest upcoming config for today is tracked as SCHEDULED
      if (upcomingConfigs.length > 0) {
        upcomingConfigs.sort((a, b) => a.diffSeconds - b.diffSeconds);
        const nextUpcoming = upcomingConfigs[0];

        const existingNext = todayMap.get(nextUpcoming.config.id);
        if (!existingNext) {
          await query(
            `INSERT INTO bot_sessions (
              session_config_id, session_name, schedule_date, date, start_time,
              status, target_wins, created_at, updated_at
            ) VALUES ($1, $2, $3, $3, $4, 'SCHEDULED', $5, NOW(), NOW())
            ON CONFLICT (session_config_id, schedule_date) DO NOTHING`,
            [nextUpcoming.config.id, nextUpcoming.config.session_name, todayDateStr, nextUpcoming.config.start_time, nextUpcoming.config.target_wins]
          ).catch(() => {});
        }
      }
    } catch (err: any) {
      logger.error({ err: err.message }, 'Error in scheduler tick cycle');
    } finally {
      this.isTicking = false;
    }
  }

  /**
   * Creates or updates a session to RUNNING status in PostgreSQL.
   */
  private async createAndStartSession(config: SessionConfig, scheduleDate: string): Promise<BotSession> {
    const res = await query<BotSession>(
      `INSERT INTO bot_sessions (
        session_config_id, session_name, schedule_date, date, start_time,
        status, target_wins, started_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $3, $4, 'RUNNING', $5, NOW(), NOW(), NOW())
      ON CONFLICT (session_config_id, schedule_date) 
      DO UPDATE SET 
        status = 'RUNNING', 
        started_at = COALESCE(bot_sessions.started_at, NOW()), 
        completed_at = NULL,
        updated_at = NOW()
      RETURNING *`,
      [config.id, config.session_name, scheduleDate, config.start_time, config.target_wins]
    );

    const session = this.mapSessionRow(res.rows[0]);
    console.log(`[SESSION] Session #${session.id} ("${session.session_name}") is now RUNNING.`);
    return session;
  }

  /**
   * Explicit manual start override.
   * Starts a session immediately regardless of scheduled start time.
   */
  async startSessionNow(configId?: number): Promise<BotSession> {
    const nowTz = await this.getNowTz();
    const todayDateStr = nowTz.toFormat('yyyy-MM-dd');

    let config: SessionConfig | null = null;
    const configs = await this.getSessionConfigs();

    if (configId) {
      config = configs.find((c) => c.id === configId) || null;
    }

    if (!config) {
      config = configs.find((c) => c.enabled) || configs[0];
    }

    if (!config) {
      throw new Error('No session configuration available');
    }

    // If an active session exists, mark it STOPPED first to prevent collision
    const active = await this.getActiveSession();
    if (active) {
      await query(`UPDATE bot_sessions SET status = 'STOPPED', updated_at = NOW() WHERE id = $1`, [
        active.id,
      ]);
    }

    console.log(`[SESSION] Manual override: Starting "${config.session_name}" immediately.`);

    const res = await query<BotSession>(
      `INSERT INTO bot_sessions (
        session_config_id, session_name, schedule_date, date, start_time,
        status, target_wins, started_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $3, $4, 'RUNNING', $5, NOW(), NOW(), NOW())
      ON CONFLICT (session_config_id, schedule_date)
      DO UPDATE SET 
        status = 'RUNNING', 
        started_at = NOW(), 
        completed_at = NULL, 
        updated_at = NOW()
      RETURNING *`,
      [config.id, config.session_name, todayDateStr, config.start_time, config.target_wins]
    );

    // Trigger immediate prediction cycle and period scheduling
    try {
      const { botRunner } = await import('../bot/runner.js');
      botRunner.startResultWatcher();
      botRunner.detectAndTrackCurrentPeriod().catch(() => {});
      botRunner.scheduleNext15SecondSignal();
    } catch {}

    return this.mapSessionRow(res.rows[0]);
  }

  /**
   * Manually stops the currently active session.
   */
  async stopActiveSession(): Promise<BotSession | null> {
    const active = await this.getActiveSession();
    if (!active) return null;

    const res = await query<BotSession>(
      `UPDATE bot_sessions 
       SET status = 'STOPPED', updated_at = NOW() 
       WHERE id = $1 RETURNING *`,
      [active.id]
    );

    console.log(`[SESSION] Active session #${active.id} ("${active.session_name}") stopped by admin.`);
    console.log(`[SESSION] Prediction engine IDLE.`);

    // Cancel any pending scheduled signals in botRunner
    try {
      const { botRunner } = await import('../bot/runner.js');
      botRunner.cancelPendingScheduledSignals(active.id);
    } catch {}

    if (res.rowCount === 0) return null;
    return this.mapSessionRow(res.rows[0]);
  }

  private targetCompleteTimers: Map<number, NodeJS.Timeout> = new Map();
  private historyTimers: Map<number, NodeJS.Timeout> = new Map();
  private deliveringTargetComplete: Set<number> = new Set();
  private deliveringHistory: Set<number> = new Set();

  private scheduleTargetCompletionTimer(sessionId: number, delayMs: number): void {
    if (this.targetCompleteTimers.has(sessionId)) {
      clearTimeout(this.targetCompleteTimers.get(sessionId)!);
    }
    const timer = setTimeout(async () => {
      this.targetCompleteTimers.delete(sessionId);
      await this.deliverTargetCompletionMessage(sessionId);
    }, Math.max(0, delayMs));
    this.targetCompleteTimers.set(sessionId, timer);
  }

  private scheduleHistoryTimer(sessionId: number, delayMs: number): void {
    if (this.historyTimers.has(sessionId)) {
      clearTimeout(this.historyTimers.get(sessionId)!);
    }
    const timer = setTimeout(async () => {
      this.historyTimers.delete(sessionId);
      await this.deliverSessionHistoryMessage(sessionId);
    }, Math.max(0, delayMs));
    this.historyTimers.set(sessionId, timer);
  }

  /**
   * Atomic and idempotent target completion handler.
   *
   * When target_wins is reached:
   * 1. Atomically marks bot_sessions status to 'TARGET_COMPLETED'.
   * 2. Stops new predictions immediately.
   * 3. Cancels in-flight scheduled signals for this session.
   * 4. Schedules TARGET_COMPLETE message after exactly 20 seconds.
   * 5. After TARGET_COMPLETE is successfully sent, schedules SESSION_HISTORY message after exactly 20 seconds.
   */
  async completeSessionTarget(sessionId: number, forceManual = false): Promise<boolean> {
    // 1. Sync stats from authoritative recorded signal results
    await this.syncSessionStats(sessionId);

    // 2. Atomic update conditional on status = 'RUNNING' and (forceManual OR wins >= target_wins)
    const updateRes = await query<any>(
      `UPDATE bot_sessions 
       SET status = 'TARGET_COMPLETED',
           completed_at = COALESCE(completed_at, NOW()),
           target_completion_status = 'PENDING',
           target_completion_scheduled_for = NOW() + INTERVAL '20 seconds',
           history_message_status = 'PENDING',
           history_scheduled_for = NULL,
           updated_at = NOW() 
       WHERE id = $1 AND status = 'RUNNING' ${forceManual ? '' : 'AND wins >= target_wins'}
       RETURNING id, target_wins, wins, session_name`,
      [sessionId]
    );

    // If rowCount === 0, it was already completed or did not meet target wins! Prevent duplicate processing.
    if (updateRes.rowCount === 0) {
      return false;
    }

    const session = updateRes.rows[0];

    console.log(
      `[SESSION] 🎉 "${session.session_name}" TARGET REACHED: ${session.wins}/${session.target_wins} WINs!`
    );
    console.log(`[SESSION] Prediction engine for this session is now STOPPED (IDLE).`);
    console.log(`[SESSION] Target completion message scheduled in exactly 20 seconds.`);

    // Cancel any scheduled signals that were queued but not dispatched
    try {
      const { botRunner } = await import('../bot/runner.js');
      botRunner.cancelPendingScheduledSignals(sessionId);
    } catch {}

    // Schedule 20-second timer for TARGET_COMPLETE message
    this.scheduleTargetCompletionTimer(sessionId, 20000);

    return true;
  }

  /**
   * Delivers the TARGET_COMPLETED message after the 20-second post-completion delay.
   */
  async deliverTargetCompletionMessage(sessionId: number): Promise<boolean> {
    if (this.deliveringTargetComplete.has(sessionId)) {
      return false;
    }

    try {
      const sessionRes = await query<any>(
        `SELECT * FROM bot_sessions WHERE id = $1`,
        [sessionId]
      );
      if (sessionRes.rowCount === 0) return false;
      const session = sessionRes.rows[0];

      if (session.status !== 'TARGET_COMPLETED') return false;

      // Duplicate protection: if already sent, do not send again
      if (session.target_completion_status === 'SENT' || session.target_completion_sent_at || session.target_message_sent_at) {
        return true;
      }

      // Exact timing check: wait 20 seconds from completion
      const scheduledMs = session.target_completion_scheduled_for
        ? new Date(session.target_completion_scheduled_for).getTime()
        : (session.completed_at ? new Date(session.completed_at).getTime() + 20000 : Date.now());
      const remainingMs = scheduledMs - Date.now();
      if (remainingMs > 500) {
        this.scheduleTargetCompletionTimer(sessionId, remainingMs);
        return false;
      }

      const destination = await getActiveWhatsAppDestination();
      const waCheck = await whatsAppManager.isReady();
      const isConnected = waCheck.ready && whatsAppManager.getStatus().status === 'connected';

      if (!destination || !isConnected) {
        logger.warn({ sessionId }, '[SESSION COMPLETION] WhatsApp not ready/connected. Target completion message held in PENDING state.');
        return false;
      }

      // Atomic lock / claim: transition state from PENDING or FAILED to SENDING
      const claimRes = await query<any>(
        `UPDATE bot_sessions 
         SET target_completion_status = 'SENDING', updated_at = NOW() 
         WHERE id = $1 AND (target_completion_status = 'PENDING' OR target_completion_status = 'FAILED' OR target_completion_status IS NULL)
         RETURNING id`,
        [sessionId]
      );
      if (claimRes.rowCount === 0) {
        return false;
      }

      this.deliveringTargetComplete.add(sessionId);

      try {
        // Query fresh signals directly from database
        const signalsRes = await query<any>(
          `SELECT * FROM signals WHERE session_id = $1 ORDER BY id ASC`,
          [sessionId]
        );

        // Verify and derive authoritative numbers from persisted records
        const uniqueMap = new Map<string, any>();
        for (const s of signalsRes.rows) {
          if (s.issue_number && !uniqueMap.has(s.issue_number)) {
            uniqueMap.set(s.issue_number, s);
          }
        }
        const uniqueSignals = Array.from(uniqueMap.values());
        const settled = uniqueSignals.filter((s: any) => s.status === 'WIN' || s.status === 'LOSS');
        const wins = settled.filter((s: any) => s.status === 'WIN').length;
        const losses = settled.filter((s: any) => s.status === 'LOSS').length;
        const totalSignals = wins + losses;
        const rawRate = totalSignals > 0 ? (wins / totalSignals) * 100 : 0;
        const winRate = rawRate % 1 === 0 ? rawRate.toFixed(0) : (Math.round(rawRate * 100) / 100).toFixed(2);

        const tz = await this.getTimezone();
        const startTimeFormatted = session.started_at
          ? DateTime.fromISO(new Date(session.started_at).toISOString())
              .setZone(tz)
              .toFormat('hh:mm a')
          : this.format12h(session.start_time);

        const endTimeFormatted = session.completed_at
          ? DateTime.fromISO(new Date(session.completed_at).toISOString())
              .setZone(tz)
              .toFormat('hh:mm a')
          : DateTime.now().setZone(tz).toFormat('hh:mm a');

        const targetCompleteMsg = await renderDynamicTargetComplete({
          targetWins: session.target_wins,
          wins,
          losses,
          totalSignals,
          winRate,
          sessionName: session.session_name,
          startTime: startTimeFormatted,
          endTime: endTimeFormatted,
          signals: uniqueSignals,
        });

        await whatsAppManager.sendMessage(targetCompleteMsg, destination, 'TARGET_COMPLETE');

        // Update state: mark target_completion_status = 'SENT', and start 20s history timer now!
        const updateRes = await query<any>(
          `UPDATE bot_sessions 
           SET target_completion_status = 'SENT',
               target_completion_sent_at = NOW(),
               target_message_sent_at = NOW(),
               history_scheduled_for = NOW() + INTERVAL '20 seconds',
               history_message_status = 'PENDING',
               updated_at = NOW() 
           WHERE id = $1 AND target_completion_status = 'SENDING'
           RETURNING id`,
          [sessionId]
        );

        if (updateRes.rowCount > 0) {
          console.log(`[SESSION] Sent TARGET_COMPLETE message to WhatsApp channel: ${destination}`);
          console.log(`[SESSION] Session history scheduled in exactly 20 seconds.`);
          this.scheduleHistoryTimer(sessionId, 20000);
          return true;
        }

        return true;
      } catch (err: any) {
        logger.error({ err: err.message, sessionId }, '[SESSION COMPLETION] Failed to deliver target completion message');
        await query(
          `UPDATE bot_sessions SET target_completion_status = 'FAILED', updated_at = NOW() WHERE id = $1 AND target_completion_status = 'SENDING'`,
          [sessionId]
        ).catch(() => {});
        return false;
      } finally {
        this.deliveringTargetComplete.delete(sessionId);
      }
    } catch (outerErr: any) {
      logger.error({ err: outerErr.message, sessionId }, '[SESSION COMPLETION] Unexpected error in deliverTargetCompletionMessage');
      return false;
    }
  }

  /**
   * Delivers the SESSION_HISTORY message exactly 20 seconds AFTER target completion was sent.
   */
  async deliverSessionHistoryMessage(sessionId: number): Promise<boolean> {
    if (this.deliveringHistory.has(sessionId)) {
      return false;
    }

    try {
      const sessionRes = await query<any>(
        `SELECT * FROM bot_sessions WHERE id = $1`,
        [sessionId]
      );
      if (sessionRes.rowCount === 0) return false;
      const session = sessionRes.rows[0];

      if (session.status !== 'TARGET_COMPLETED') return false;

      // Requirement: Target completion message MUST be sent before history
      if (session.target_completion_status !== 'SENT' && !session.target_completion_sent_at && !session.target_message_sent_at) {
        logger.info({ sessionId }, '[SESSION HISTORY] Target completion message not yet sent; holding history.');
        return false;
      }

      // Duplicate protection: if already sent, do not send again
      if (session.history_message_status === 'SENT' || session.history_message_sent_at || session.history_sent_at) {
        return true;
      }

      // Timing check: wait 20 seconds after target completion was sent
      const targetSentAtMs = session.target_completion_sent_at
        ? new Date(session.target_completion_sent_at).getTime()
        : (session.target_message_sent_at ? new Date(session.target_message_sent_at).getTime() : 0);

      const scheduledMs = session.history_scheduled_for
        ? new Date(session.history_scheduled_for).getTime()
        : (targetSentAtMs ? targetSentAtMs + 20000 : Date.now());

      const remainingMs = scheduledMs - Date.now();
      if (remainingMs > 500) {
        this.scheduleHistoryTimer(sessionId, remainingMs);
        return false;
      }

      const destination = await getActiveWhatsAppDestination();
      const waCheck = await whatsAppManager.isReady();
      const isConnected = waCheck.ready && whatsAppManager.getStatus().status === 'connected';

      if (!destination || !isConnected) {
        logger.warn({ sessionId }, '[SESSION HISTORY] WhatsApp not ready/connected. Session history held in PENDING state.');
        return false;
      }

      // Atomic lock / claim: transition state from PENDING or FAILED to SENDING
      const claimRes = await query<any>(
        `UPDATE bot_sessions 
         SET history_message_status = 'SENDING', updated_at = NOW() 
         WHERE id = $1 AND (history_message_status = 'PENDING' OR history_message_status = 'FAILED' OR history_message_status IS NULL)
         RETURNING id`,
        [sessionId]
      );
      if (claimRes.rowCount === 0) {
        return false;
      }

      this.deliveringHistory.add(sessionId);

      try {
        // Query fresh signals directly from database (do not use in-memory cache)
        const signalsRes = await query<any>(
          `SELECT * FROM signals WHERE session_id = $1 ORDER BY id ASC`,
          [sessionId]
        );

        // Verify and derive authoritative numbers from persisted records
        const uniqueMap = new Map<string, any>();
        for (const s of signalsRes.rows) {
          if (s.issue_number && !uniqueMap.has(s.issue_number)) {
            uniqueMap.set(s.issue_number, s);
          }
        }
        const uniqueSignals = Array.from(uniqueMap.values());
        const settled = uniqueSignals.filter((s: any) => s.status === 'WIN' || s.status === 'LOSS');
        const wins = settled.filter((s: any) => s.status === 'WIN').length;
        const losses = settled.filter((s: any) => s.status === 'LOSS').length;
        const totalPredictions = wins + losses; // Guaranteed: TOTAL = WIN + LOSS
        const rawWinRate = totalPredictions > 0 ? (wins / totalPredictions) * 100 : 0;
        const winRate = rawWinRate % 1 === 0 ? rawWinRate.toFixed(0) : (Math.round(rawWinRate * 100) / 100).toFixed(2);

        // Verify invariant: totalPredictions === wins + losses
        if (totalPredictions !== wins + losses) {
          logger.error({ totalPredictions, wins, losses }, 'Invariant violation: total != wins + losses');
        }

        // Update session statistics in database
        await query(
          `UPDATE bot_sessions 
           SET wins = $1, losses = $2, total_signals = $3, win_rate = $4, updated_at = NOW() 
           WHERE id = $5`,
          [wins, losses, totalPredictions, parseFloat(winRate), sessionId]
        );

        const tz = await this.getTimezone();
        const startTimeFormatted = session.started_at
          ? DateTime.fromISO(new Date(session.started_at).toISOString())
              .setZone(tz)
              .toFormat('hh:mm a')
          : this.format12h(session.start_time);

        const endTimeFormatted = session.completed_at
          ? DateTime.fromISO(new Date(session.completed_at).toISOString())
              .setZone(tz)
              .toFormat('hh:mm a')
          : DateTime.now().setZone(tz).toFormat('hh:mm a');

        const historyMsg = await renderDynamicSessionHistory({
          sessionName: session.session_name,
          startTime: startTimeFormatted,
          endTime: endTimeFormatted,
          targetWins: session.target_wins,
          wins,
          losses,
          totalSignals: totalPredictions,
          winRate,
          status: 'TARGET COMPLETED',
          signals: uniqueSignals,
        });

        await whatsAppManager.sendMessage(historyMsg, destination, 'SESSION_HISTORY');

        // Update state: mark history_message_status = 'SENT'
        const updateRes = await query<any>(
          `UPDATE bot_sessions 
           SET history_message_status = 'SENT',
               history_message_sent_at = NOW(),
               history_sent_at = NOW(),
               updated_at = NOW() 
           WHERE id = $1 AND history_message_status = 'SENDING'
           RETURNING id`,
          [sessionId]
        );

        if (updateRes.rowCount > 0) {
          console.log(`[SESSION] Sent SESSION_HISTORY message to WhatsApp channel: ${destination}`);
          return true;
        }

        return true;
      } catch (err: any) {
        logger.error({ err: err.message, sessionId }, '[SESSION HISTORY] Failed to deliver session history message');
        await query(
          `UPDATE bot_sessions SET history_message_status = 'FAILED', updated_at = NOW() WHERE id = $1 AND history_message_status = 'SENDING'`,
          [sessionId]
        ).catch(() => {});
        return false;
      } finally {
        this.deliveringHistory.delete(sessionId);
      }
    } catch (outerErr: any) {
      logger.error({ err: outerErr.message, sessionId }, '[SESSION HISTORY] Unexpected error in deliverSessionHistoryMessage');
      return false;
    }
  }

  /**
   * Scans for any sessions that reached target completion and require delayed message delivery.
   * Handles restarts, delay continuation, and recovery safely.
   */
  async processPendingTargetCompletions(): Promise<void> {
    try {
      // Clear any stale SENDING status if process previously restarted or died while sending (>30s ago)
      await query(
        `UPDATE bot_sessions 
         SET target_completion_status = 'PENDING', updated_at = NOW() 
         WHERE status = 'TARGET_COMPLETED' 
           AND target_completion_status = 'SENDING' 
           AND updated_at < NOW() - INTERVAL '30 seconds'`
      ).catch(() => {});

      await query(
        `UPDATE bot_sessions 
         SET history_message_status = 'PENDING', updated_at = NOW() 
         WHERE status = 'TARGET_COMPLETED' 
           AND history_message_status = 'SENDING' 
           AND updated_at < NOW() - INTERVAL '30 seconds'`
      ).catch(() => {});

      const res = await query<any>(
        `SELECT id, status, completed_at, target_completion_status, target_completion_scheduled_for,
                target_completion_sent_at, target_message_sent_at,
                history_message_status, history_scheduled_for, history_message_sent_at, history_sent_at,
                updated_at
         FROM bot_sessions
         WHERE status = 'TARGET_COMPLETED'
           AND (
             target_completion_status IS NULL
             OR target_completion_status != 'SENT'
             OR history_message_status IS NULL
             OR history_message_status != 'SENT'
           )
         ORDER BY id ASC`
      );

      for (const session of res.rows) {
        const targetSent = session.target_completion_status === 'SENT' || !!session.target_completion_sent_at || !!session.target_message_sent_at;

        if (!targetSent) {
          if (this.deliveringTargetComplete.has(session.id) || session.target_completion_status === 'SENDING') {
            continue;
          }

          let scheduledTimeMs = session.target_completion_scheduled_for
            ? new Date(session.target_completion_scheduled_for).getTime()
            : 0;

          if (!scheduledTimeMs) {
            scheduledTimeMs = session.completed_at
              ? new Date(session.completed_at).getTime() + 20000
              : Date.now() + 20000;
            await query(
              `UPDATE bot_sessions SET target_completion_scheduled_for = $1, target_completion_status = 'PENDING' WHERE id = $2`,
              [new Date(scheduledTimeMs).toISOString(), session.id]
            );
          }

          const remainingMs = scheduledTimeMs - Date.now();
          if (remainingMs <= 0) {
            await this.deliverTargetCompletionMessage(session.id);
          } else {
            this.scheduleTargetCompletionTimer(session.id, remainingMs);
          }
        } else {
          const historySent = session.history_message_status === 'SENT' || !!session.history_message_sent_at || !!session.history_sent_at;
          if (!historySent) {
            if (this.deliveringHistory.has(session.id) || session.history_message_status === 'SENDING') {
              continue;
            }

            let historyScheduledMs = session.history_scheduled_for
              ? new Date(session.history_scheduled_for).getTime()
              : 0;

            if (!historyScheduledMs) {
              const targetSentAtMs = session.target_completion_sent_at
                ? new Date(session.target_completion_sent_at).getTime()
                : (session.target_message_sent_at ? new Date(session.target_message_sent_at).getTime() : Date.now());
              historyScheduledMs = targetSentAtMs + 20000;
              await query(
                `UPDATE bot_sessions SET history_scheduled_for = $1, history_message_status = 'PENDING' WHERE id = $2`,
                [new Date(historyScheduledMs).toISOString(), session.id]
              );
            }

            const remainingMs = historyScheduledMs - Date.now();
            if (remainingMs <= 0) {
              await this.deliverSessionHistoryMessage(session.id);
            } else {
              this.scheduleHistoryTimer(session.id, remainingMs);
            }
          }
        }
      }
    } catch (err: any) {
      logger.error({ err: err.message }, 'Error processing pending target completions');
    }
  }

  /**
   * Recalculates wins, losses, total_signals, and win_rate from signals table for a session.
   * GUARANTEES: TOTAL = WIN + LOSS invariant ALWAYS holds.
   * No prediction is ever counted as both WIN and LOSS.
   */
  async syncSessionStats(sessionId: number): Promise<{ wins: number; losses: number; totalSignals: number; winRate: number }> {
    try {
      const countsRes = await query<any>(
        `SELECT 
           COUNT(DISTINCT CASE WHEN status = 'WIN' THEN issue_number END) as wins,
           COUNT(DISTINCT CASE WHEN status = 'LOSS' THEN issue_number END) as losses
         FROM signals WHERE session_id = $1`,
        [sessionId]
      );

      const wins = parseInt(countsRes.rows[0]?.wins || '0', 10);
      const losses = parseInt(countsRes.rows[0]?.losses || '0', 10);
      const totalSignals = wins + losses; // Invariant: TOTAL = WIN + LOSS ALWAYS
      const winRate = totalSignals > 0 ? Math.round((wins / totalSignals) * 10000) / 100 : 0.00;

      await query(
        `UPDATE bot_sessions 
         SET wins = $1, losses = $2, total_signals = $3, win_rate = $4, updated_at = NOW() 
         WHERE id = $5`,
        [wins, losses, totalSignals, winRate, sessionId]
      );

      return { wins, losses, totalSignals, winRate };
    } catch (err: any) {
      logger.error({ err: err.message, sessionId }, 'Error syncing session stats');
      return { wins: 0, losses: 0, totalSignals: 0, winRate: 0 };
    }
  }

  /**
   * Gets single session by ID with authoritative statistics.
   */
  async getSessionById(sessionId: number): Promise<BotSession | null> {
    const res = await query<any>(
      `${this.getSessionSelectWithStatsQuery()} WHERE s.id = $1`,
      [sessionId]
    );
    if (res.rowCount === 0) return null;
    return this.mapSessionRow(res.rows[0]);
  }

  /**
   * Calculates next scheduled session.
   *
   * 1. Reads all enabled session configurations.
   * 2. Checks against current Asia/Karachi time.
   * 3. Excludes already completed/stopped sessions for today.
   * 4. If all done today, rolls over to tomorrow's first enabled config.
   */
  async getNextScheduledSession(): Promise<NextSessionInfo | null> {
    const tz = await this.getTimezone();
    const nowTz = DateTime.now().setZone(tz);
    const todayDateStr = nowTz.toFormat('yyyy-MM-dd');
    const tomorrowDateStr = nowTz.plus({ days: 1 }).toFormat('yyyy-MM-dd');
    const nowTimeStr = nowTz.toFormat('HH:mm');

    const configs = await this.getSessionConfigs();
    const enabledConfigs = configs.filter((c) => c.enabled);
    if (enabledConfigs.length === 0) return null;

    // Check today's existing sessions
    const todaySessionsRes = await query<BotSession>(
      `SELECT * FROM bot_sessions WHERE schedule_date = $1`,
      [todayDateStr]
    );
    const todaySessionsMap = new Map<number, BotSession>();
    for (const s of todaySessionsRes.rows) {
      if (s.session_config_id) {
        todaySessionsMap.set(s.session_config_id, s);
      }
    }

    type Candidate = {
      config: SessionConfig;
      startTz: DateTime;
      startDateStr: string;
      diffSeconds: number;
    };
    const candidates: Candidate[] = [];

    for (const config of enabledConfigs) {
      const [h, m] = config.start_time.split(':').map(Number);
      const todaySession = todaySessionsMap.get(config.id);

      // Candidate 1: Today
      // If session for today already completed or stopped or running, do NOT select it as next
      const isTodayEligible =
        !todaySession ||
        todaySession.status === 'SCHEDULED';

      if (isTodayEligible && config.start_time > nowTimeStr) {
        const todayStartTz = nowTz.set({ hour: h, minute: m, second: 0, millisecond: 0 });
        const diffSec = Math.floor(todayStartTz.diff(nowTz).as('seconds'));
        if (diffSec > 0) {
          candidates.push({
            config,
            startTz: todayStartTz,
            startDateStr: todayDateStr,
            diffSeconds: diffSec,
          });
        }
      }

      // Candidate 2: Tomorrow
      const tomorrowStartTz = nowTz.plus({ days: 1 }).set({ hour: h, minute: m, second: 0, millisecond: 0 });
      const diffSecTomorrow = Math.floor(tomorrowStartTz.diff(nowTz).as('seconds'));
      if (diffSecTomorrow > 0) {
        candidates.push({
          config,
          startTz: tomorrowStartTz,
          startDateStr: tomorrowDateStr,
          diffSeconds: diffSecTomorrow,
        });
      }
    }

    if (candidates.length === 0) return null;

    // Sort by earliest start time (diffSeconds ascending)
    candidates.sort((a, b) => a.diffSeconds - b.diffSeconds);
    const earliest = candidates[0];

    const hours = Math.floor(earliest.diffSeconds / 3600);
    const minutes = Math.floor((earliest.diffSeconds % 3600) / 60);
    const seconds = earliest.diffSeconds % 60;
    const formatted = `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    return {
      configId: earliest.config.id,
      name: earliest.config.session_name,
      startTime: earliest.config.start_time,
      startTimeFormatted: this.format12h(earliest.config.start_time),
      endTime: earliest.config.end_time || null,
      startDate: earliest.startDateStr,
      startsInSeconds: earliest.diffSeconds,
      startsInFormatted: formatted,
      targetWins: earliest.config.target_wins,
    };
  }

  /**
   * Gets scheduler status including separate status values for UI.
   */
  async getSchedulerStatus(): Promise<SchedulerStatus> {
    const tz = await this.getTimezone();
    const nowTz = DateTime.now().setZone(tz);
    const todayDateStr = nowTz.toFormat('yyyy-MM-dd');
    const currentTimeStr = nowTz.toFormat('hh:mm:ss a');

    const mode = botModeManager.getMode();
    const isSchedEnabled = mode === 'SESSION';
    const activeSession = mode === 'SESSION' ? await this.getActiveSession() : null;
    const currentSession = await this.getCurrentSessionForToday();
    const configs = await this.getSessionConfigs();
    const todaySessions = await this.getTodaySessions();

    const predictionGate = await this.canGeneratePrediction();
    const waCheck = await whatsAppManager.isReady();
    const waStatus = whatsAppManager.getStatus();

    let predictionEngineStatus: 'RUNNING' | 'IDLE' | 'PAUSED' | 'STOPPED' = 'IDLE';
    let predictionEngineReason = predictionGate.reason;
    let sessionStateDisplay = 'INACTIVE';

    const nextSession = isSchedEnabled ? await this.getNextScheduledSession() : null;

    if (mode === 'NORMAL') {
      const { botRunner } = await import('../bot/runner.js');
      const isRunning = botRunner.getStatus().running;
      if (isRunning) {
        predictionEngineStatus = waCheck.ready ? 'RUNNING' : 'PAUSED';
        predictionEngineReason = waCheck.ready
          ? 'Normal Bot Mode actively sending predictions'
          : `Waiting for WhatsApp connection (${waCheck.reason})`;
      } else {
        predictionEngineStatus = 'STOPPED';
        predictionEngineReason = 'Normal Bot Mode stopped';
      }
      sessionStateDisplay = 'INACTIVE';
    } else if (mode === 'SESSION') {
      if (activeSession) {
        if (!waCheck.ready) {
          predictionEngineStatus = 'PAUSED';
          predictionEngineReason = `Waiting for WhatsApp connection (${waCheck.reason})`;
          sessionStateDisplay = 'PAUSED (Waiting for WhatsApp)';
        } else {
          predictionEngineStatus = 'RUNNING';
          predictionEngineReason = `Active session "${activeSession.session_name}" running (${activeSession.wins}/${activeSession.target_wins} WINs)`;
          sessionStateDisplay = 'LIVE SESSION';
        }
      } else {
        predictionEngineStatus = 'IDLE';
        if (!waCheck.ready) {
          sessionStateDisplay = 'WAITING FOR WHATSAPP';
          predictionEngineReason = `Waiting for WhatsApp connection (${waCheck.reason})`;
        } else if (nextSession) {
          sessionStateDisplay = 'SCHEDULED';
          predictionEngineReason = `Waiting for next session: ${nextSession.name} at ${nextSession.startTimeFormatted}`;
        } else {
          sessionStateDisplay = 'COMPLETED';
          predictionEngineReason = 'All configured sessions for today are completed';
        }
      }
    } else {
      // STOPPED
      predictionEngineStatus = 'STOPPED';
      predictionEngineReason = 'Bot is stopped';
      sessionStateDisplay = 'INACTIVE';
    }

    let remainingWins: number | null = null;
    if (activeSession) {
      remainingWins = Math.max(0, activeSession.target_wins - activeSession.wins);
    }

    return {
      timezone: tz,
      currentTime: currentTimeStr,
      currentDate: todayDateStr,
      botMode: mode,
      scheduleEnabled: isSchedEnabled,
      predictionEngineStatus,
      predictionEngineReason,
      sessionStateDisplay,
      currentSession,
      activeSession,
      remainingWins,
      whatsAppReady: waCheck.ready,
      whatsAppStatus: waStatus.status,
      nextSession,
      configs,
      todaySessions,
    };
  }

  private mapSessionRow(row: any): BotSession {
    const wins = parseInt(row.wins || '0', 10);
    const losses = parseInt(row.losses || '0', 10);
    const totalSignals = wins + losses; // Guaranteed: TOTAL = WIN + LOSS ALWAYS
    const winRate = totalSignals > 0 ? Math.round((wins / totalSignals) * 10000) / 100 : 0.00;

    return {
      id: row.id,
      session_config_id: row.session_config_id,
      session_name: row.session_name,
      schedule_date: row.schedule_date,
      date: row.date || row.schedule_date,
      start_time: row.start_time,
      end_time: row.end_time || null,
      status: row.status,
      target_wins: parseInt(row.target_wins || '10', 10),
      wins,
      losses,
      total_signals: totalSignals,
      win_rate: winRate,
      started_at: row.started_at ? new Date(row.started_at).toISOString() : null,
      completed_at: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      target_completion_status: row.target_completion_status || null,
      target_completion_scheduled_for: row.target_completion_scheduled_for ? new Date(row.target_completion_scheduled_for).toISOString() : null,
      target_completion_sent_at: row.target_completion_sent_at ? new Date(row.target_completion_sent_at).toISOString() : null,
      target_message_sent_at: row.target_message_sent_at ? new Date(row.target_message_sent_at).toISOString() : null,
      history_message_status: row.history_message_status || null,
      history_scheduled_for: row.history_scheduled_for ? new Date(row.history_scheduled_for).toISOString() : null,
      history_message_sent_at: row.history_message_sent_at ? new Date(row.history_message_sent_at).toISOString() : null,
      history_sent_at: row.history_sent_at ? new Date(row.history_sent_at).toISOString() : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };
  }
}

export const sessionScheduler = new SessionScheduler();
