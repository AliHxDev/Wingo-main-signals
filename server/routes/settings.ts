import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { query } from '../db/index.js';
import { requireAuth } from '../middleware/auth.js';
import {
  getActiveWhatsAppDestination,
  setActiveWhatsAppDestination,
  validateNewsletterJid,
} from '../services/destination.js';

export const settingsRouter = Router();

settingsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const resSettings = await query<{ key: string; value: string }>('SELECT key, value FROM settings');
    const settingsMap: Record<string, string> = {};
    for (const r of resSettings.rows) {
      settingsMap[r.key] = r.value;
    }

    res.json({
      newsletterJid: settingsMap.newsletter_jid || '',
      confidenceThreshold: parseInt(settingsMap.confidence_threshold || '65', 10),
      pollingInterval: parseInt(settingsMap.polling_interval || '60', 10),
      wingoApiUrl: settingsMap.wingo_api_url || 'https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json',
      botTimezone: settingsMap.bot_timezone || 'Asia/Karachi',
      scheduleEnabled: settingsMap.schedule_enabled !== 'false',
      signalDelayFixed: 15,
      signalDelayMin: 15,
      signalDelayMax: 15,
      missedSessionPolicy: settingsMap.missed_session_policy || 'START_IF_WITHIN_WINDOW',
      missedSessionGraceMinutes: parseInt(settingsMap.missed_session_grace_minutes || '120', 10),
      activeDestination: await getActiveWhatsAppDestination(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to load settings' });
  }
});

const updateSettingsSchema = z.object({
  newsletterJid: z.string().optional(),
  confidenceThreshold: z.coerce.number().min(50).max(99).optional(),
  pollingInterval: z.coerce.number().min(10).max(300).optional(),
  wingoApiUrl: z.string().url().optional(),
  botTimezone: z.string().min(2).max(50).optional(),
  scheduleEnabled: z.boolean().optional(),
  signalDelayMin: z.coerce.number().min(5).max(60).optional(),
  signalDelayMax: z.coerce.number().min(5).max(120).optional(),
  missedSessionPolicy: z.enum(['START_IF_WITHIN_WINDOW', 'SKIP']).optional(),
  missedSessionGraceMinutes: z.coerce.number().min(5).max(720).optional(),
});

settingsRouter.put('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const parse = updateSettingsSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: parse.error.issues[0]?.message || 'Invalid settings data' });
      return;
    }

    const {
      newsletterJid,
      confidenceThreshold,
      pollingInterval,
      wingoApiUrl,
      botTimezone,
      scheduleEnabled,
      signalDelayMin,
      signalDelayMax,
      missedSessionPolicy,
      missedSessionGraceMinutes,
    } = parse.data;

    if (signalDelayMin !== undefined && signalDelayMax !== undefined && signalDelayMin > signalDelayMax) {
      res.status(400).json({ error: 'Minimum signal delay cannot exceed maximum delay.' });
      return;
    }

    // 1. Update newsletter JID if provided
    if (newsletterJid !== undefined) {
      const trimmed = newsletterJid.trim();
      if (trimmed.length > 0) {
        const val = validateNewsletterJid(trimmed);
        if (!val.valid) {
          res.status(400).json({ error: val.error });
          return;
        }
        await setActiveWhatsAppDestination(trimmed);
      } else {
        // Clear newsletter
        await query(
          `INSERT INTO settings (key, value, updated_at)
           VALUES ('newsletter_jid', '', NOW())
           ON CONFLICT (key) DO UPDATE SET value = '', updated_at = NOW();`
        );
      }
    }

    // 2. Update confidence threshold if provided
    if (confidenceThreshold !== undefined) {
      await query(
        `INSERT INTO settings (key, value, updated_at)
         VALUES ('confidence_threshold', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`,
        [confidenceThreshold.toString()]
      );
    }

    // 3. Update polling interval if provided
    if (pollingInterval !== undefined) {
      await query(
        `INSERT INTO settings (key, value, updated_at)
         VALUES ('polling_interval', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`,
        [pollingInterval.toString()]
      );
    }

    // 4. Update WinGo API URL if provided
    if (wingoApiUrl !== undefined) {
      await query(
        `INSERT INTO settings (key, value, updated_at)
         VALUES ('wingo_api_url', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`,
        [wingoApiUrl.trim()]
      );
    }

    // 5. Update Timezone (Permanently fixed to Pakistan: Asia/Karachi)
    await query(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ('bot_timezone', 'Asia/Karachi', NOW())
       ON CONFLICT (key) DO UPDATE SET value = 'Asia/Karachi', updated_at = NOW();`
    );

    if (scheduleEnabled !== undefined) {
      await query(
        `INSERT INTO settings (key, value, updated_at)
         VALUES ('schedule_enabled', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`,
        [scheduleEnabled ? 'true' : 'false']
      );
    }

    // 6. Update Signal Delays
    if (signalDelayMin !== undefined) {
      await query(
        `INSERT INTO settings (key, value, updated_at)
         VALUES ('signal_delay_min', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`,
        [signalDelayMin.toString()]
      );
    }
    if (signalDelayMax !== undefined) {
      await query(
        `INSERT INTO settings (key, value, updated_at)
         VALUES ('signal_delay_max', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`,
        [signalDelayMax.toString()]
      );
    }

    // 7. Update Missed Session Policy
    if (missedSessionPolicy !== undefined) {
      await query(
        `INSERT INTO settings (key, value, updated_at)
         VALUES ('missed_session_policy', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`,
        [missedSessionPolicy]
      );
    }
    if (missedSessionGraceMinutes !== undefined) {
      await query(
        `INSERT INTO settings (key, value, updated_at)
         VALUES ('missed_session_grace_minutes', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();`,
        [missedSessionGraceMinutes.toString()]
      );
    }

    res.json({
      success: true,
      message: 'Settings updated successfully. Changes applied immediately.',
      activeDestination: await getActiveWhatsAppDestination(),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update settings' });
  }
});

// Resolve WhatsApp channel invite link to raw @newsletter JID
settingsRouter.post('/resolve-channel', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { link } = req.body;
    if (!link || typeof link !== 'string') {
      res.status(400).json({ error: 'Please provide a channel invite link or JID.' });
      return;
    }

    const { whatsAppManager } = await import('../whatsapp/client.js');
    const resolved = await whatsAppManager.resolveChannelLink(link);
    res.json({ success: true, ...resolved });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to resolve channel link' });
  }
});

// Test connectivity to a WinGo API URL
settingsRouter.post('/test-wingo', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { winGoClient } = await import('../wingo/client.js');
    const customUrl = req.body?.url;
    if (customUrl && typeof customUrl === 'string' && customUrl.startsWith('http')) {
      winGoClient.setApiUrl(customUrl);
    }

    const issues = await winGoClient.fetchHistory();
    const status = await winGoClient.getStatus();
    res.json({
      success: true,
      status,
      count: issues.length,
      sample: issues.slice(0, 3),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to test WinGo data feed' });
  }
});

// GET current environment variables and database status
settingsRouter.get('/environment', requireAuth, async (_req: Request, res: Response): Promise<void> => {
  try {
    const { getDatabaseInfo } = await import('../db/index.js');
    const { readEnvFile, maskSensitiveValue } = await import('../services/envService.js');

    const envFromFile = readEnvFile();
    const dbInfo = getDatabaseInfo();

    const envList = [
      {
        key: 'DATABASE_URL',
        label: 'PostgreSQL Database URL',
        value: dbInfo.maskedUrl || maskSensitiveValue('DATABASE_URL', envFromFile.DATABASE_URL || process.env.DATABASE_URL || ''),
        rawConfigured: !!(process.env.DATABASE_URL || envFromFile.DATABASE_URL),
        description: 'PostgreSQL connection string (Supabase, Neon, Railway, Render, or Oracle localhost).',
        sensitive: true,
      },
      {
        key: 'DATABASE_SSL',
        label: 'Database SSL Mode',
        value: envFromFile.DATABASE_SSL || process.env.DATABASE_SSL || 'true',
        rawConfigured: true,
        description: 'Set to "true" for cloud databases (Supabase/Neon), or "false" for local Oracle PostgreSQL.',
        sensitive: false,
      },
      {
        key: 'ADMIN_USERNAME',
        label: 'Admin Username',
        value: process.env.ADMIN_USERNAME || envFromFile.ADMIN_USERNAME || 'admin',
        rawConfigured: true,
        description: 'Username for web dashboard login.',
        sensitive: false,
      },
      {
        key: 'PORT',
        label: 'Server Port',
        value: process.env.PORT || envFromFile.PORT || '3000',
        rawConfigured: true,
        description: 'HTTP port the server listens on (default 3000).',
        sensitive: false,
      },
      {
        key: 'NODE_ENV',
        label: 'Environment Mode',
        value: process.env.NODE_ENV || 'production',
        rawConfigured: true,
        description: 'production or development.',
        sensitive: false,
      },
    ];

    res.json({
      success: true,
      database: dbInfo,
      environment: envList,
      rawEnv: {
        DATABASE_URL: dbInfo.maskedUrl,
        DATABASE_SSL: envFromFile.DATABASE_SSL || process.env.DATABASE_SSL || 'true',
        ADMIN_USERNAME: process.env.ADMIN_USERNAME || envFromFile.ADMIN_USERNAME || 'admin',
        PORT: process.env.PORT || envFromFile.PORT || '3000',
        NODE_ENV: process.env.NODE_ENV || 'production',
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to retrieve environment configuration' });
  }
});

// POST to switch or update database connection string directly from UI
settingsRouter.post('/database-connection', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { databaseUrl, ssl } = req.body;
    if (!databaseUrl || typeof databaseUrl !== 'string' || databaseUrl.trim().length === 0) {
      res.status(400).json({ error: 'Please enter a valid PostgreSQL Database URL.' });
      return;
    }

    const { switchDatabaseConnection } = await import('../db/index.js');
    const result = await switchDatabaseConnection(databaseUrl.trim(), ssl !== false);

    if (!result.success) {
      res.status(400).json({ error: result.message });
      return;
    }

    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to switch database connection' });
  }
});

// POST to explicitly save WhatsApp Channel destination
settingsRouter.post('/channel', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { newsletterJid } = req.body;
    if (newsletterJid === undefined) {
      res.status(400).json({ error: 'newsletterJid parameter is required.' });
      return;
    }

    const trimmed = String(newsletterJid).trim();
    if (trimmed.length > 0) {
      const val = validateNewsletterJid(trimmed);
      if (!val.valid || !val.normalizedJid) {
        res.status(400).json({ error: val.error || 'Invalid Newsletter JID.' });
        return;
      }
      await setActiveWhatsAppDestination(val.normalizedJid);
      res.json({
        success: true,
        activeDestination: val.normalizedJid,
        message: `WhatsApp Channel destination successfully saved: ${val.normalizedJid}`,
      });
    } else {
      await setActiveWhatsAppDestination('');
      res.json({
        success: true,
        activeDestination: null,
        message: 'WhatsApp Channel destination cleared.',
      });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to save channel destination' });
  }
});
settingsRouter.post('/environment', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const updates: Record<string, string> = req.body?.updates || {};
    if (!updates || Object.keys(updates).length === 0) {
      res.status(400).json({ error: 'No variables provided to update.' });
      return;
    }

    const allowedKeys = ['DATABASE_SSL', 'ADMIN_USERNAME', 'PORT', 'NODE_ENV'];
    const filteredUpdates: Record<string, string> = {};

    for (const [k, v] of Object.entries(updates)) {
      if (allowedKeys.includes(k) && typeof v === 'string') {
        filteredUpdates[k] = v.trim();
      }
    }

    if (Object.keys(filteredUpdates).length === 0) {
      res.status(400).json({ error: 'No valid environment variables provided.' });
      return;
    }

    const { updateEnvVariables } = await import('../services/envService.js');
    const result = updateEnvVariables(filteredUpdates);

    res.json({
      success: true,
      message: `Updated ${result.updated.join(', ')} successfully in .env and runtime!`,
      updated: result.updated,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update environment variables' });
  }
});

