import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { sessionReminderService } from '../services/sessionReminderService.js';
import { logger } from '../services/logger.js';

export const remindersRouter = Router();

/**
 * GET /api/reminders/settings
 * Retrieves pre-session reminder configuration and template.
 */
remindersRouter.get('/settings', async (_req: Request, res: Response): Promise<void> => {
  try {
    const settings = await sessionReminderService.getSettings();
    res.json(settings);
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to fetch reminder settings');
    res.status(500).json({ error: err.message || 'Failed to fetch reminder settings' });
  }
});

const updateReminderSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  minutesBefore: z.coerce.number().min(1).max(1440).optional(),
  websiteUrl: z.string().trim().min(1, 'Website URL is required').optional(),
  template: z.string().min(5, 'Template is too short').optional(),
});

/**
 * PUT /api/reminders/settings
 * Saves pre-session reminder settings and template.
 */
remindersRouter.put('/settings', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const parse = updateReminderSettingsSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: parse.error.issues[0]?.message || 'Invalid reminder settings data' });
      return;
    }

    const updated = await sessionReminderService.updateSettings(parse.data);
    res.json({
      success: true,
      message: 'Pre-session reminder settings saved successfully.',
      settings: updated,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to update reminder settings');
    res.status(500).json({ error: err.message || 'Failed to update reminder settings' });
  }
});

/**
 * POST /api/reminders/reset-template
 * Resets reminder message template to system default.
 */
remindersRouter.post('/reset-template', requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const settings = await sessionReminderService.resetDefaultTemplate();
    res.json({
      success: true,
      message: 'Reminder template has been reset to default.',
      settings,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to reset reminder template');
    res.status(500).json({ error: err.message || 'Failed to reset reminder template' });
  }
});

/**
 * POST /api/reminders/send-test
 * Sends a real test reminder to the active WhatsApp channel.
 * Does NOT start a session, create a prediction, count WIN/LOSS, or complete target.
 */
remindersRouter.post('/send-test', requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await sessionReminderService.sendTestReminder();
    res.json(result);
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to send test reminder');
    res.status(400).json({ error: err.message || 'Failed to send test reminder' });
  }
});

/**
 * GET /api/reminders/history
 * Returns the latest reminder history log.
 */
remindersRouter.get('/history', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
    const history = await sessionReminderService.getReminderHistory(limit);
    res.json(history);
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to fetch reminder history');
    res.status(500).json({ error: err.message || 'Failed to fetch reminder history' });
  }
});
