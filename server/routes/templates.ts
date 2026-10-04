import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { templateService } from '../services/templates.js';
import { whatsAppManager } from '../whatsapp/client.js';
import { getActiveWhatsAppDestination } from '../services/destination.js';
import { renderDynamicTest } from '../utils/formatters.js';
import { requireAuth } from '../middleware/auth.js';
import { testMessageRateLimiter } from '../middleware/rate-limiter.js';

export const templatesRouter = Router();

// GET all templates
templatesRouter.get('/', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const templates = await templateService.getAllTemplates();
    res.json({ success: true, templates });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch templates' });
  }
});

// GET single template
templatesRouter.get('/:key', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const key = req.params.key;
    const template = await templateService.getTemplate(key);
    res.json({ success: true, template });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch template' });
  }
});

const updateSchema = z.object({
  template: z.string().min(5, 'Template must be at least 5 characters long'),
  enabled: z.boolean().optional(),
});

// UPDATE template
templatesRouter.put('/:key', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const key = req.params.key;
    const parse = updateSchema.safeParse(req.body);
    if (!parse.success) {
      res.status(400).json({ error: parse.error.issues[0]?.message || 'Invalid template format' });
      return;
    }

    const { template, enabled } = parse.data;
    const updated = await templateService.updateTemplate(key, template, enabled ?? true);
    res.json({
      success: true,
      message: `Template ${key} updated successfully. All newly sent messages will use this template immediately.`,
      template: updated,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to update template' });
  }
});

// RESET template to default
templatesRouter.post('/:key/reset', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const key = req.params.key;
    const reset = await templateService.resetTemplate(key);
    res.json({
      success: true,
      message: `Template ${key} reset to default specification.`,
      template: reset,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Failed to reset template' });
  }
});

// PREVIEW template
templatesRouter.post('/preview', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { key, templateText } = req.body;
    if (!key) {
      res.status(400).json({ error: 'Template key is required for preview' });
      return;
    }

    const previewResult = templateService.preview(key, templateText);
    res.json({
      success: true,
      rendered: previewResult.rendered,
      variablesUsed: previewResult.variablesUsed,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to generate preview' });
  }
});

// SEND TEST MESSAGE using current TEST template
templatesRouter.post(
  '/send-test',
  requireAuth,
  testMessageRateLimiter,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const destination = await getActiveWhatsAppDestination();
      if (!destination) {
        res.status(400).json({
          error: 'No newsletter/channel configured. Please configure your WhatsApp Channel in Settings first.',
        });
        return;
      }

      const waStatus = whatsAppManager.getStatus();
      if (waStatus.status !== 'connected') {
        res.status(400).json({
          error: 'WhatsApp is not connected. Please pair your WhatsApp account before sending test messages.',
        });
        return;
      }

      // Render the active TEST template
      const messageText = await renderDynamicTest(destination);

      // Send to the active newsletter
      const result = await whatsAppManager.sendMessage(messageText, destination, 'TEST_MESSAGE');

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
