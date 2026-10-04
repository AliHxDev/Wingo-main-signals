import { Router, type Request, type Response } from 'express';
import { botRunner } from '../bot/runner.js';
import { winGoClient } from '../wingo/client.js';
import { requireAuth } from '../middleware/auth.js';
import { botModeManager } from '../services/botModeManager.js';

export const botRouter = Router();

botRouter.get('/status', async (req: Request, res: Response): Promise<void> => {
  const status = botRunner.getStatus();
  status.latestSignal = await botRunner.getLatestSignal();
  res.json(status);
});

botRouter.get('/wingo-status', async (req: Request, res: Response): Promise<void> => {
  try {
    const status = await winGoClient.getStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to get WinGo status' });
  }
});

botRouter.post('/dispatch-now', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await botRunner.dispatchInstantSignal();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to dispatch signal' });
  }
});

botRouter.post('/start', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const status = await botModeManager.startNormalMode();
    status.latestSignal = await botRunner.getLatestSignal();
    res.json({
      success: true,
      mode: 'NORMAL',
      message: 'WinGo 1M Signal Bot started in NORMAL BOT MODE.',
      status,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to start bot' });
  }
});

botRouter.post('/stop', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const status = await botModeManager.stopNormalMode();
    status.latestSignal = await botRunner.getLatestSignal();
    res.json({
      success: true,
      mode: 'STOPPED',
      message: 'WinGo 1M Signal Bot stopped.',
      status,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to stop bot' });
  }
});
