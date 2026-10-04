import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { whatsAppManager } from '../whatsapp/client.js';
import { requireAuth } from '../middleware/auth.js';
import { testMessageRateLimiter } from '../middleware/rate-limiter.js';

export const whatsAppRouter = Router();

// Status can be viewed by authenticated users
whatsAppRouter.get('/status', (req: Request, res: Response): void => {
  const status = whatsAppManager.getStatus();
  res.json(status);
});

const pairSchema = z.object({
  phoneNumber: z.string().min(8, 'Phone number must be at least 8 digits with country code'),
});

whatsAppRouter.post('/pair', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const parse = pairSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: parse.error.issues[0]?.message || 'Invalid phone number' });
      return;
    }

    const { phoneNumber } = parse.data;
    const pairingCode = await whatsAppManager.requestPairingCode(phoneNumber);

    res.json({
      success: true,
      phoneNumber,
      pairingCode,
      message: 'Pairing code generated. Enter this 8-character code in WhatsApp on your phone.',
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to generate pairing code' });
  }
});

whatsAppRouter.post('/reconnect', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    await whatsAppManager.reconnect();
    res.json({ success: true, message: 'Reconnection initiated.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to reconnect WhatsApp' });
  }
});

whatsAppRouter.post('/logout', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    await whatsAppManager.logout();
    res.json({ success: true, message: 'WhatsApp session logged out.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to log out WhatsApp session' });
  }
});

whatsAppRouter.post('/reset', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    await whatsAppManager.logout();
    res.json({ success: true, message: 'WhatsApp session reset completely. You can now pair cleanly.' });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to reset WhatsApp session' });
  }
});

whatsAppRouter.post(
  '/test-message',
  requireAuth,
  testMessageRateLimiter,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await whatsAppManager.sendTestMessage();
      res.json({
        success: true,
        destination: result.destination,
        messageId: result.messageId,
        message: `Test message delivered successfully to ${result.destination}`,
      });
    } catch (err: any) {
      res.status(400).json({ error: err.message || 'Failed to send test message' });
    }
  }
);
