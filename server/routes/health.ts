import { Router, type Request, type Response } from 'express';
import { botRunner } from '../bot/runner.js';
import { whatsAppManager } from '../whatsapp/client.js';
import { query, getDatabase } from '../db/index.js';
import { botModeManager } from '../services/botModeManager.js';
import { sessionScheduler } from '../services/sessionScheduler.js';

export const healthRouter = Router();

healthRouter.get('/', async (_req: Request, res: Response): Promise<void> => {
  let dbOk = false;
  let isRealPostgres = false;
  let dbType = 'in-memory (pg-mem fallback)';

  try {
    const dbRes = await query('SELECT 1 as test');
    dbOk = dbRes.rowCount > 0;
    const db = await getDatabase();
    isRealPostgres = db.isRealPostgres;
    dbType = isRealPostgres ? 'postgresql (persistent)' : 'in-memory (pg-mem fallback)';
  } catch {
    dbOk = false;
  }

  const waStatus = whatsAppManager.getStatus();
  const botStatus = botRunner.getStatus();
  const mode = botModeManager.getMode();
  let activeSession: any = null;

  try {
    const sess = await sessionScheduler.getActiveSession();
    if (sess) {
      activeSession = {
        id: sess.id,
        name: sess.session_name,
        status: sess.status,
        targetWins: sess.target_wins,
        wins: sess.wins,
        losses: sess.losses,
        total: sess.total_signals,
      };
    }
  } catch {}

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    database: {
      connected: dbOk,
      type: dbType,
      isRealPostgres,
    },
    whatsapp: {
      status: waStatus.status,
      isRegistered: waStatus.isRegistered,
      phoneNumber: waStatus.phoneNumber,
    },
    bot: {
      running: botStatus.running,
      mode,
      lastIssue: botStatus.lastIssue,
    },
    activeSession,
    platform: {
      isRender: !!process.env.RENDER || !!process.env.RENDER_EXTERNAL_URL,
      externalUrl: process.env.RENDER_EXTERNAL_URL || null,
    },
  });
});

healthRouter.get('/download-bundle', (_req: Request, res: Response): void => {
  import('child_process').then(({ spawn }) => {
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', 'attachment; filename="wingo-bot.tar.gz"');

    const tarProcess = spawn('tar', [
      '--exclude=node_modules',
      '--exclude=.git',
      '-czf',
      '-',
      '.',
    ], { cwd: process.cwd() });

    tarProcess.stdout.pipe(res);
    tarProcess.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({ error: err.message });
      }
    });
  }).catch((err) => {
    res.status(500).json({ error: err.message });
  });
});

