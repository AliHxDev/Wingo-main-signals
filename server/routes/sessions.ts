import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import { sessionScheduler } from '../services/sessionScheduler.js';
import { botModeManager } from '../services/botModeManager.js';
import { logger } from '../services/logger.js';
import { renderDynamicSessionHistory } from '../utils/formatters.js';
import { whatsAppManager } from '../whatsapp/client.js';
import { getActiveWhatsAppDestination } from '../services/destination.js';

export const sessionsRouter = Router();

/**
 * GET /api/sessions/status
 * Returns current scheduler status, active session, remaining wins, next session countdown.
 */
sessionsRouter.get('/status', async (_req: Request, res: Response): Promise<void> => {
  try {
    const status = await sessionScheduler.getSchedulerStatus();
    res.json(status);
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to fetch session status');
    res.status(500).json({ error: err.message || 'Failed to fetch session status' });
  }
});

/**
 * GET /api/sessions/configs
 * Lists all configured sessions sorted by start time.
 */
sessionsRouter.get('/configs', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await query<any>(
      `SELECT * FROM session_configs ORDER BY start_time ASC`
    );
    res.json(result.rows);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to list session configs' });
  }
});

const configSchema = z.object({
  session_name: z.string().min(1, 'Session name is required').max(100),
  start_time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Format must be HH:mm (24h)'),
  end_time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional().nullable(),
  target_wins: z.coerce.number().min(1).max(50),
  min_confidence: z.coerce.number().min(50).max(99).optional().default(65),
  signal_delay_min: z.coerce.number().optional(),
  signal_delay_max: z.coerce.number().optional(),
  enabled: z.boolean().optional().default(true),
});

/**
 * POST /api/sessions/configs
 * Create a new scheduled session (Runs until target WIN is reached).
 */
sessionsRouter.post('/configs', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const parse = configSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: parse.error.issues[0]?.message || 'Invalid session configuration' });
      return;
    }

    const {
      session_name,
      start_time,
      target_wins,
      min_confidence,
      enabled,
    } = parse.data;

    const config = await sessionScheduler.createSessionConfig({
      session_name,
      start_time,
      target_wins,
      min_confidence,
      enabled,
    });

    res.status(201).json({
      success: true,
      config,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to create session config' });
  }
});

/**
 * PUT /api/sessions/configs/:id
 * Update an existing session configuration.
 */
sessionsRouter.put('/configs/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const configId = parseInt(req.params.id, 10);
    if (isNaN(configId)) {
      res.status(400).json({ error: 'Invalid config ID' });
      return;
    }

    const parse = configSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: parse.error.issues[0]?.message || 'Invalid session configuration' });
      return;
    }

    const {
      session_name,
      start_time,
      target_wins,
      min_confidence,
      enabled,
    } = parse.data;

    const updated = await sessionScheduler.updateSessionConfig(configId, {
      session_name,
      start_time,
      target_wins,
      min_confidence,
      enabled,
    });

    if (!updated) {
      res.status(404).json({ error: 'Session configuration not found' });
      return;
    }

    res.json({
      success: true,
      config: updated,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update session config' });
  }
});

/**
 * POST /api/sessions/configs/:id/toggle
 * Toggle enabled status of a configuration.
 */
sessionsRouter.post('/configs/:id/toggle', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const configId = parseInt(req.params.id, 10);
    if (isNaN(configId)) {
      res.status(400).json({ error: 'Invalid config ID' });
      return;
    }

    const updateRes = await query<any>(
      `UPDATE session_configs
       SET enabled = NOT enabled, updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [configId]
    );

    if (updateRes.rowCount === 0) {
      res.status(404).json({ error: 'Session configuration not found' });
      return;
    }

    res.json({
      success: true,
      config: updateRes.rows[0],
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to toggle session configuration' });
  }
});

/**
 * DELETE /api/sessions/configs/:id
 * Remove a session configuration safely.
 * If the session is currently active, it is cleanly stopped and pending timers cleared.
 */
sessionsRouter.delete('/configs/:id', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const configId = parseInt(req.params.id, 10);
    if (isNaN(configId)) {
      res.status(400).json({ error: 'Invalid config ID' });
      return;
    }

    const success = await sessionScheduler.deleteSessionConfig(configId);

    if (!success) {
      res.status(404).json({ error: 'Session configuration not found' });
      return;
    }

    res.json({ success: true, message: 'Session configuration deleted successfully' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to delete session configuration' });
  }
});

/**
 * GET /api/sessions/history
 * Lists session runs with date filtering.
 */
sessionsRouter.get('/history', async (req: Request, res: Response): Promise<void> => {
  try {
    const { range = 'all', startDate, endDate, status } = req.query;

    let dateClause = '';
    const params: any[] = [];

    const nowTz = await sessionScheduler.getNowTz();
    const todayStr = nowTz.toFormat('yyyy-MM-dd');
    const yesterdayStr = nowTz.minus({ days: 1 }).toFormat('yyyy-MM-dd');
    const last7Str = nowTz.minus({ days: 7 }).toFormat('yyyy-MM-dd');
    const last30Str = nowTz.minus({ days: 30 }).toFormat('yyyy-MM-dd');

    if (range === 'today') {
      params.push(todayStr);
      dateClause = `WHERE (s.schedule_date = $1 OR s.schedule_date >= $1)`;
    } else if (range === 'yesterday') {
      params.push(yesterdayStr, todayStr);
      dateClause = `WHERE s.schedule_date >= $1 AND s.schedule_date < $2`;
    } else if (range === 'last7') {
      params.push(last7Str);
      dateClause = `WHERE s.schedule_date >= $1`;
    } else if (range === 'last30') {
      params.push(last30Str);
      dateClause = `WHERE s.schedule_date >= $1`;
    } else if (range === 'custom' && startDate && endDate) {
      params.push(startDate, endDate);
      dateClause = `WHERE s.schedule_date >= $1 AND s.schedule_date <= $2`;
    }

    if (status && typeof status === 'string') {
      const idx = params.length + 1;
      params.push(status);
      dateClause += dateClause ? ` AND s.status = $${idx}` : `WHERE s.status = $${idx}`;
    }

    // SINGLE SOURCE OF TRUTH:
    // Aggregate wins, losses, and total directly from signals table.
    // Invariant: TOTAL = WIN + LOSS ALWAYS.
    const historyRes = await query<any>(
      `SELECT 
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
         s.target_message_sent_at,
         s.history_message_sent_at,
         s.created_at,
         s.updated_at
       FROM bot_sessions s
       LEFT JOIN (
         SELECT 
           session_id,
           COALESCE(SUM(CASE WHEN status = 'WIN' THEN 1 ELSE 0 END), 0) as wins,
           COALESCE(SUM(CASE WHEN status = 'LOSS' THEN 1 ELSE 0 END), 0) as losses,
           COALESCE(SUM(CASE WHEN status IN ('WIN', 'LOSS') THEN 1 ELSE 0 END), 0) as total
         FROM signals
         WHERE session_id IS NOT NULL
         GROUP BY session_id
       ) sig ON s.id = sig.session_id
       ${dateClause} 
       ORDER BY s.started_at DESC, s.id DESC LIMIT 100`,
      params
    );

    const mapped = historyRes.rows.map((row: any) => {
      const wins = parseInt(row.wins || '0', 10);
      const losses = parseInt(row.losses || '0', 10);
      const totalSignals = wins + losses; // Guaranteed: TOTAL = WIN + LOSS ALWAYS
      const winRate = totalSignals > 0 ? Math.round((wins / totalSignals) * 10000) / 100 : 0.00;
      return {
        ...row,
        wins,
        losses,
        total_signals: totalSignals,
        win_rate: winRate,
      };
    });

    res.json(mapped);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retrieve session history' });
  }
});

/**
 * GET /api/sessions/:id
 * Retrieve a specific session and all its signals.
 * Both the session summary and detailed history come from the exact same authoritative signals.
 */
sessionsRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  try {
    const sessionId = parseInt(req.params.id, 10);
    if (isNaN(sessionId)) {
      res.status(400).json({ error: 'Invalid session ID' });
      return;
    }

    // 1. Authoritative signal records for this session
    const signalsRes = await query<any>(
      `SELECT * FROM signals WHERE session_id = $1 ORDER BY id ASC`,
      [sessionId]
    );

    const sess = await sessionScheduler.getSessionById(sessionId);
    if (!sess) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    // 2. Authoritative summary calculation directly from the exact signal records:
    // Deduplicate by issue_number if needed
    const uniqueMap = new Map<string, typeof signalsRes.rows[0]>();
    for (const s of signalsRes.rows) {
      if (s.issue_number && !uniqueMap.has(s.issue_number)) {
        uniqueMap.set(s.issue_number, s);
      }
    }
    const uniqueSignals = Array.from(uniqueMap.values());
    const settled = uniqueSignals.filter((s: any) => s.status === 'WIN' || s.status === 'LOSS');
    const wins = settled.filter((s: any) => s.status === 'WIN').length;
    const losses = settled.filter((s: any) => s.status === 'LOSS').length;
    const total = wins + losses;
    const winRate = total > 0 ? Math.round((wins / total) * 10000) / 100 : 0.00;

    sess.wins = wins;
    sess.losses = losses;
    sess.total_signals = total;
    sess.win_rate = winRate;

    res.json({
      session: sess,
      signals: signalsRes.rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load session details' });
  }
});

/**
 * POST /api/sessions/start-sessions
 * POST /api/sessions/start-schedule
 * Switches system to SESSION MODE and enables automatic daily schedule.
 * Evaluates configured schedule and runs sessions until target WIN is reached.
 */
const handleStartSessions = async (_req: Request, res: Response): Promise<void> => {
  try {
    const status = await botModeManager.startSessionMode();
    res.json({
      success: true,
      mode: 'SESSION',
      scheduleEnabled: true,
      message: 'Switched to SESSION MODE. Sessions will start at scheduled times and run until target WIN is reached.',
      status,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to start session schedule' });
  }
};

sessionsRouter.post('/start-sessions', requireAuth, handleStartSessions);
sessionsRouter.post('/start-schedule', requireAuth, handleStartSessions);

/**
 * POST /api/sessions/stop-sessions
 * POST /api/sessions/stop-schedule
 * Switches system to STOPPED mode and pauses automatic daily schedule.
 */
const handleStopSessions = async (_req: Request, res: Response): Promise<void> => {
  try {
    const status = await botModeManager.stopSessionMode();
    res.json({
      success: true,
      mode: 'STOPPED',
      scheduleEnabled: false,
      message: 'SESSION MODE stopped. Prediction engine IDLE.',
      status,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to stop session schedule' });
  }
};

sessionsRouter.post('/stop-sessions', requireAuth, handleStopSessions);
sessionsRouter.post('/stop-schedule', requireAuth, handleStopSessions);

/**
 * POST /api/sessions/toggle-schedule
 * Toggle or explicitly set daily schedule enabled state.
 */
sessionsRouter.post('/toggle-schedule', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const current = await sessionScheduler.isScheduleEnabled();
    const nextState = req.body.enabled !== undefined ? !!req.body.enabled : !current;
    const status = nextState
      ? await botModeManager.startSessionMode()
      : await botModeManager.stopSessionMode();
    res.json({
      success: true,
      mode: nextState ? 'SESSION' : 'STOPPED',
      scheduleEnabled: nextState,
      message: `Session schedule ${nextState ? 'enabled' : 'paused'}`,
      status,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to toggle schedule' });
  }
});

/**
 * POST /api/sessions/start-now
 * Explicit manual override: starts the specified (or default) session immediately (Requirement 3).
 */
sessionsRouter.post('/start-now', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { configId } = req.body;
    const session = await sessionScheduler.startSessionNow(configId ? Number(configId) : undefined);
    res.json({
      success: true,
      message: `Session "${session.session_name}" started immediately (manual override).`,
      session,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to manually start session' });
  }
});

/**
 * POST /api/sessions/start-manual
 * Alias for start-now.
 */
sessionsRouter.post('/start-manual', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { configId } = req.body;
    const session = await sessionScheduler.startSessionNow(configId ? Number(configId) : undefined);
    res.json({
      success: true,
      message: `Session "${session.session_name}" started successfully`,
      session,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to manually start session' });
  }
});

/**
 * POST /api/sessions/stop
 * POST /api/sessions/stop-manual
 * Manually stop the currently active session (Requirement 6 & 21).
 */
sessionsRouter.post('/stop', requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const stopped = await sessionScheduler.stopActiveSession();
    res.json({
      success: true,
      message: stopped ? `Session "${stopped.session_name}" stopped successfully` : 'No active running session to stop',
      session: stopped,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to stop session' });
  }
});

sessionsRouter.post('/stop-manual', requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const stopped = await sessionScheduler.stopActiveSession();
    res.json({
      success: true,
      message: stopped ? `Session "${stopped.session_name}" stopped successfully` : 'No active running session to stop',
      session: stopped,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to stop session' });
  }
});

/**
 * POST /api/sessions/complete-target
 * Manually trigger target completion for the active session (sends TARGET_COMPLETE template).
 */
sessionsRouter.post('/complete-target', requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const active = await sessionScheduler.getActiveSession();
    if (!active) {
      res.status(400).json({ error: 'No running session to complete' });
      return;
    }

    const completed = await sessionScheduler.completeSessionTarget(active.id, true);
    res.json({
      success: completed,
      message: completed ? 'Session target completed and message broadcast.' : 'Session could not be completed.',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to complete session target' });
  }
});

/**
 * POST /api/sessions/broadcast-history
 * Broadcast the daily / session history summary message to WhatsApp.
 */
sessionsRouter.post('/broadcast-history', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.body;
    let targetSessionId = sessionId;

    if (!targetSessionId) {
      // Find latest completed or running session
      const sRes = await query<any>(`SELECT id FROM bot_sessions ORDER BY started_at DESC LIMIT 1`);
      targetSessionId = sRes.rows[0]?.id;
    }

    if (!targetSessionId) {
      res.status(400).json({ error: 'No session data found to broadcast history' });
      return;
    }

    const sess = await sessionScheduler.getSessionById(targetSessionId);
    if (!sess) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    const sigsRes = await query<any>(
      `SELECT * FROM signals WHERE session_id = $1 ORDER BY id ASC`,
      [targetSessionId]
    );

    const historyMsg = await renderDynamicSessionHistory({
      sessionName: sess.session_name,
      startTime: sess.started_at ? new Date(sess.started_at).toLocaleTimeString() : 'N/A',
      endTime: sess.completed_at ? new Date(sess.completed_at).toLocaleTimeString() : new Date().toLocaleTimeString(),
      targetWins: sess.target_wins,
      wins: sess.wins,
      losses: sess.losses,
      totalSignals: sess.total_signals,
      winRate: sess.win_rate,
      status: sess.status,
      signals: sigsRes.rows,
    });

    const destination = (await getActiveWhatsAppDestination()) || 'dashboard';

    if (destination && destination !== 'dashboard') {
      await whatsAppManager.sendMessage(historyMsg, destination, 'SESSION_HISTORY');
    }

    res.json({
      success: true,
      message: `Session history broadcasted successfully to ${destination}`,
      renderedMessage: historyMsg,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to broadcast session history' });
  }
});
