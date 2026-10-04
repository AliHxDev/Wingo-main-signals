import { query } from '../db/index.js';
import { logger } from './logger.js';

export interface DestinationValidationResult {
  valid: boolean;
  error?: string;
  normalizedJid?: string;
}

/**
 * Validates a WhatsApp Newsletter JID.
 * Must match standard newsletter pattern (e.g. 120363411395110604@newsletter).
 * Must NOT convert @newsletter to @g.us or @s.whatsapp.net.
 */
export function validateNewsletterJid(input: string): DestinationValidationResult {
  if (!input || typeof input !== 'string') {
    return { valid: false, error: 'Newsletter JID is required.' };
  }

  const trimmed = input.trim();

  // Ensure it has not been mangled into other JID domains
  if (trimmed.endsWith('@g.us')) {
    return {
      valid: false,
      error: 'Invalid Newsletter JID: Contains @g.us (Group JID). Must be a @newsletter JID.',
    };
  }

  if (trimmed.endsWith('@s.whatsapp.net')) {
    return {
      valid: false,
      error: 'Invalid Newsletter JID: Contains @s.whatsapp.net (User JID). Must be a @newsletter JID.',
    };
  }

  // Must end with @newsletter
  if (!trimmed.endsWith('@newsletter')) {
    return {
      valid: false,
      error: 'Invalid Newsletter JID: Destination must end with @newsletter (e.g. 120363411395110604@newsletter).',
    };
  }

  // Check prefix before @newsletter is non-empty numeric/alphanumeric ID
  const parts = trimmed.split('@');
  if (parts.length !== 2 || parts[0].length < 5) {
    return {
      valid: false,
      error: 'Invalid Newsletter JID format: Identifier must be valid (e.g. 120363411395110604@newsletter).',
    };
  }

  return { valid: true, normalizedJid: trimmed };
}

/**
 * Single Destination Resolver:
 * Reads the currently active WhatsApp Newsletter channel directly from PostgreSQL.
 * All outgoing messages (Test Message, Signal, WIN, LOSS) MUST resolve their destination through this function.
 */
export async function getActiveWhatsAppDestination(): Promise<string | null> {
  try {
    const res = await query<{ value: string }>(
      'SELECT value FROM settings WHERE key = $1',
      ['newsletter_jid']
    );

    if (res.rowCount > 0 && res.rows[0]?.value) {
      const jid = res.rows[0].value.trim();
      if (jid.length > 0) {
        return jid;
      }
    }
    return null;
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to query active WhatsApp destination from database');
    return null;
  }
}

/**
 * Persists a new active WhatsApp Newsletter channel into PostgreSQL.
 * Changes take effect immediately across all future messages without requiring a server restart or WhatsApp re-pairing.
 */
export async function setActiveWhatsAppDestination(jid: string): Promise<string> {
  const validation = validateNewsletterJid(jid);
  if (!validation.valid || !validation.normalizedJid) {
    throw new Error(validation.error || 'Invalid Newsletter JID');
  }

  const targetJid = validation.normalizedJid;

  await query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ('newsletter_jid', $1, NOW())
     ON CONFLICT (key) DO UPDATE
     SET value = EXCLUDED.value, updated_at = NOW();`,
    [targetJid]
  );

  logger.info({ destination: targetJid }, 'Updated active WhatsApp Newsletter destination in PostgreSQL');
  return targetJid;
}
