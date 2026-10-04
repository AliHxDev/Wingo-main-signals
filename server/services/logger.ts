import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  level: config.NODE_ENV === 'test' ? 'silent' : 'info',
  transport:
    config.NODE_ENV === 'development'
      ? {
          target: 'pino/file',
          options: { destination: 1 },
        }
      : undefined,
  base: { service: 'wingo-whatsapp-bot' },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export const LogEvent = {
  WHATSAPP_CONNECTING: 'WHATSAPP_CONNECTING',
  WHATSAPP_CONNECTED: 'WHATSAPP_CONNECTED',
  WHATSAPP_DISCONNECTED: 'WHATSAPP_DISCONNECTED',
  PAIRING_STARTED: 'PAIRING_STARTED',
  PAIRING_CODE_GENERATED: 'PAIRING_CODE_GENERATED',
  PAIRING_SUCCESS: 'PAIRING_SUCCESS',
  PAIRING_FAILED: 'PAIRING_FAILED',
  BOT_STARTED: 'BOT_STARTED',
  BOT_STOPPED: 'BOT_STOPPED',
  WINGO_FETCH: 'WINGO_FETCH',
  NEW_ISSUE: 'NEW_ISSUE',
  PREDICTION_GENERATED: 'PREDICTION_GENERATED',
  SIGNAL_SENT: 'SIGNAL_SENT',
  SIGNAL_FAILED: 'SIGNAL_FAILED',
  RESULT_RECEIVED: 'RESULT_RECEIVED',
  WIN: 'WIN',
  LOSS: 'LOSS',
} as const;

export function logLifecycle(event: keyof typeof LogEvent, data?: Record<string, unknown>) {
  logger.info({ event, ...(data ? sanitizeLogData(data) : {}) }, `[${event}]`);
}

function sanitizeLogData(data: Record<string, unknown>): Record<string, unknown> {
  const sanitized = { ...data };
  const sensitiveKeys = ['password', 'secret', 'token', 'key', 'auth', 'creds', 'authorization'];
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
      sanitized[key] = '[REDACTED]';
    }
  }
  return sanitized;
}
