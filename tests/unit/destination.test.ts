import { describe, it, expect } from 'vitest';
import { validateNewsletterJid } from '../../server/services/destination.js';

describe('WhatsApp Newsletter JID Validation', () => {
  it('accepts valid @newsletter JIDs without alteration', () => {
    const valid = '120363411395110604@newsletter';
    const result = validateNewsletterJid(valid);
    expect(result.valid).toBe(true);
    expect(result.normalizedJid).toBe(valid);
  });

  it('rejects group JIDs containing @g.us', () => {
    const group = '120363411395110604@g.us';
    const result = validateNewsletterJid(group);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('@g.us');
  });

  it('rejects user JIDs containing @s.whatsapp.net', () => {
    const user = '120363411395110604@s.whatsapp.net';
    const result = validateNewsletterJid(user);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('@s.whatsapp.net');
  });

  it('rejects invalid or empty JIDs', () => {
    expect(validateNewsletterJid('').valid).toBe(false);
    expect(validateNewsletterJid('randomstring').valid).toBe(false);
  });
});
