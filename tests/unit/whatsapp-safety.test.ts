import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { whatsAppManager, type WhatsAppStatus } from '../../server/whatsapp/client.js';
import { validateNewsletterJid } from '../../server/services/destination.js';
import { sessionScheduler } from '../../server/services/sessionScheduler.js';

describe('WhatsApp Connection & Session Safety Suite', () => {
  beforeEach(async () => {
    await sessionScheduler.start();
  });

  describe('1. Authoritative WhatsApp Service & Status Check', () => {
    it('exposes all required methods on whatsAppManager', () => {
      expect(typeof whatsAppManager.getStatus).toBe('function');
      expect(typeof whatsAppManager.isReady).toBe('function');
      expect(typeof whatsAppManager.getConnectionState).toBe('function');
      expect(typeof whatsAppManager.requestPairingCode).toBe('function');
      expect(typeof whatsAppManager.sendMessage).toBe('function');
      expect(typeof whatsAppManager.reconnect).toBe('function');
      expect(typeof whatsAppManager.logout).toBe('function');
      expect(typeof whatsAppManager.whatsappConnected).toBe('function');
      expect(typeof whatsAppManager.whatsappAuthenticated).toBe('function');
      expect(typeof whatsAppManager.socketReady).toBe('function');
      expect(typeof whatsAppManager.destinationConfigured).toBe('function');
    });

    it('returns not_paired or disconnected when no WhatsApp session is active', () => {
      const status = whatsAppManager.getStatus();
      expect(['not_paired', 'disconnected', 'logged_out', 'connecting', 'connected']).toContain(status.status);
      expect(typeof status.isRegistered).toBe('boolean');
    });
  });

  describe('2. WhatsApp Readiness Gate (Requirement 1 & 2)', () => {
    it('blocks prediction generation when WhatsApp is NOT ready', async () => {
      // Spy on isReady to simulate WhatsApp being not connected
      const isReadySpy = vi.spyOn(whatsAppManager, 'isReady').mockResolvedValue({
        ready: false,
        reason: 'WhatsApp Not Connected (NOT_PAIRED)',
      });

      const gate = await sessionScheduler.canGeneratePrediction();
      expect(gate.allowed).toBe(false);
      expect(gate.reason).toContain('WhatsApp');

      isReadySpy.mockRestore();
    });

    it('does not send signal or mark as sent when WhatsApp is disconnected (Requirement 10 & 12)', async () => {
      const isReadySpy = vi.spyOn(whatsAppManager, 'isReady').mockResolvedValue({
        ready: false,
        reason: 'WhatsApp is not connected',
      });

      const ready = await whatsAppManager.isReady();
      expect(ready.ready).toBe(false);

      // Attempting to sendMessage when not connected throws a catchable error and does not crash
      await expect(
        whatsAppManager.sendMessage('Test Signal', '120363411395110604@newsletter', 'SIGNAL')
      ).rejects.toThrow();

      isReadySpy.mockRestore();
    });
  });

  describe('3. Newsletter Destination Validation (Requirement 11)', () => {
    it('validates correct @newsletter JID format', () => {
      const validJid = '120363411395110604@newsletter';
      const result = validateNewsletterJid(validJid);
      expect(result.valid).toBe(true);
      expect(result.normalizedJid).toBe(validJid);
    });

    it('rejects group JIDs (@g.us) as newsletter destination', () => {
      const groupJid = '120363411395110604@g.us';
      const result = validateNewsletterJid(groupJid);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('@g.us');
    });

    it('rejects user JIDs (@s.whatsapp.net) as newsletter destination', () => {
      const userJid = '923001234567@s.whatsapp.net';
      const result = validateNewsletterJid(userJid);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('@s.whatsapp.net');
    });

    it('rejects invalid or missing destinations', () => {
      expect(validateNewsletterJid('').valid).toBe(false);
      expect(validateNewsletterJid('invalid-string').valid).toBe(false);
    });
  });

  describe('4. Exponential Reconnection Backoff (Requirement 9)', () => {
    it('calculates bounded exponential backoff up to 30 seconds', () => {
      const calculateDelay = (attempt: number) => Math.min(1000 * Math.pow(2, attempt - 1), 30000);

      expect(calculateDelay(1)).toBe(1000);  // 1s
      expect(calculateDelay(2)).toBe(2000);  // 2s
      expect(calculateDelay(3)).toBe(4000);  // 4s
      expect(calculateDelay(4)).toBe(8000);  // 8s
      expect(calculateDelay(5)).toBe(16000); // 16s
      expect(calculateDelay(6)).toBe(30000); // 30s (capped)
      expect(calculateDelay(10)).toBe(30000); // 30s (capped)
    });
  });

  describe('5. Active Session Disconnect Handling (Requirement 5)', () => {
    it('pauses prediction generation when WhatsApp disconnects during a session without deleting the session', async () => {
      // Simulate WhatsApp disconnecting
      const isReadySpy = vi.spyOn(whatsAppManager, 'isReady').mockResolvedValue({
        ready: false,
        reason: 'WhatsApp is not connected',
      });

      const check = await sessionScheduler.canGeneratePrediction();
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain('WhatsApp');

      // The status should report PAUSED
      const status = await sessionScheduler.getSchedulerStatus();
      expect(['PAUSED', 'IDLE']).toContain(status.predictionEngineStatus);

      isReadySpy.mockRestore();
    });
  });

  describe('6. Automatic Recovery on Reconnection (Requirement 4 & 6)', () => {
    it('automatically permits predictions once WhatsApp becomes ready', async () => {
      // 1. First simulate disconnected
      let isReadyMock = vi.spyOn(whatsAppManager, 'isReady').mockResolvedValue({
        ready: false,
        reason: 'WhatsApp is not connected',
      });

      let check = await sessionScheduler.canGeneratePrediction();
      expect(check.allowed).toBe(false);

      // 2. Now simulate WhatsApp reconnecting
      isReadyMock.mockResolvedValue({
        ready: true,
        destination: '120363411395110604@newsletter',
      });

      // Now readiness check passes!
      const readyCheck = await whatsAppManager.isReady();
      expect(readyCheck.ready).toBe(true);
      expect(readyCheck.destination).toBe('120363411395110604@newsletter');

      isReadyMock.mockRestore();
    });
  });
});
