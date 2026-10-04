import {
  makeWASocket,
  DisconnectReason,
  Browsers,
  fetchLatestBaileysVersion,
  type WASocket,
  type ConnectionState as BaileysConnectionState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { usePostgresAuthState, hasStoredAuth, getStoredUserPhone } from '../db/auth-store.js';
import { query } from '../db/index.js';
import { logger, LogEvent, logLifecycle } from '../services/logger.js';
import { getActiveWhatsAppDestination, validateNewsletterJid } from '../services/destination.js';

export type WhatsAppStatus =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'not_paired'
  | 'logged_out'
  | 'pairing'
  | 'error';

export interface WhatsAppClientState {
  status: WhatsAppStatus;
  phoneNumber: string | null;
  pairingCode: string | null;
  pairingExpiresAt: string | null;
  qrCode?: string | null;
  lastConnectedAt: string | null;
  lastError: string | null;
  reconnectAttempts: number;
  isRegistered: boolean;
  destinationConfigured: boolean;
  destination: string | null;
  isReady: boolean;
}

export class WhatsAppManager {
  private sock: WASocket | null = null;
  private status: WhatsAppStatus = 'not_paired';
  private phoneNumber: string | null = null;
  private pairingCode: string | null = null;
  private qrCodeDataUrl: string | null = null;
  private pairingExpiresAt: Date | null = null;
  private lastConnectedAt: Date | null = null;
  private lastError: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 8;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isPairingInProgress = false;
  private isShuttingDown = false;
  private isInitializing = false;
  private initPromise: Promise<WASocket> | null = null;
  private clearAuthFn: (() => Promise<void>) | null = null;
  private saveCredsFn: (() => Promise<void>) | null = null;
  private lastTestMessageSentAt = 0;

  constructor() {
    this.loadPersistedState().catch((err) => {
      logger.warn({ err: err.message }, 'Failed to load initial WhatsApp state from DB');
    });
  }

  /**
   * Loads persisted connection metadata from PostgreSQL.
   */
  private async loadPersistedState(): Promise<void> {
    try {
      const res = await query<any>(
        'SELECT * FROM whatsapp_connection WHERE id = $1',
        ['primary']
      );
      if (res.rowCount > 0 && res.rows[0]) {
        const row = res.rows[0];
        const rawStatus = row.status;
        if (
          rawStatus === 'connected' ||
          rawStatus === 'connecting' ||
          rawStatus === 'disconnected' ||
          rawStatus === 'not_paired' ||
          rawStatus === 'logged_out' ||
          rawStatus === 'pairing'
        ) {
          this.status = rawStatus;
        } else {
          this.status = 'not_paired';
        }
        this.phoneNumber = row.phone_number || null;
        this.pairingCode = row.pairing_code || null;
        this.pairingExpiresAt = row.pairing_expires_at ? new Date(row.pairing_expires_at) : null;
        this.lastConnectedAt = row.connected_at ? new Date(row.connected_at) : null;
        this.lastError = row.last_error || null;
      } else {
        this.status = 'not_paired';
      }
    } catch (err: any) {
      logger.error({ err: err.message }, 'Error reading persisted WhatsApp state');
      this.status = 'not_paired';
    }
  }

  /**
   * Persists connection metadata to PostgreSQL.
   */
  private async persistState(): Promise<void> {
    try {
      await query(
        `INSERT INTO whatsapp_connection (
          id, status, phone_number, pairing_code, pairing_expires_at, last_error, connected_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          phone_number = EXCLUDED.phone_number,
          pairing_code = EXCLUDED.pairing_code,
          pairing_expires_at = EXCLUDED.pairing_expires_at,
          last_error = EXCLUDED.last_error,
          connected_at = EXCLUDED.connected_at,
          updated_at = NOW();`,
        [
          'primary',
          this.status,
          this.phoneNumber,
          this.pairingCode,
          this.pairingExpiresAt?.toISOString() || null,
          this.lastError,
          this.lastConnectedAt?.toISOString() || null,
        ]
      );
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to persist WhatsApp connection state');
    }
  }

  /**
   * Called during server startup on Render (Requirement 16).
   * Restores WhatsApp connection from persistent storage if valid credentials exist.
   * If credentials are unavailable, sets status to 'not_paired' and prevents predictions.
   */
  async initOnStartup(): Promise<void> {
    try {
      const hasAuth = await hasStoredAuth();
      if (hasAuth) {
        logger.info('Found existing WhatsApp credentials. Restoring connection...');
        this.phoneNumber = getStoredUserPhone() || this.phoneNumber;
        this.status = 'connecting';
        this.getOrInitSocket().catch((err) => {
          logger.error({ err: err.message }, 'Failed to restore WhatsApp connection on startup');
        });
      } else {
        logger.info('No WhatsApp credentials stored. WhatsApp status: NOT_PAIRED.');
        this.status = 'not_paired';
        this.sock = null;
        this.pairingCode = null;
        await this.persistState();
      }
    } catch (err: any) {
      logger.error({ err: err.message }, 'Error in WhatsApp initOnStartup');
      this.status = 'not_paired';
    }
  }

  /**
   * Initializes or returns the active Baileys socket.
   * STRICT SINGLE SOCKET:
   * Prevents duplicate simultaneous sockets. Reuses existing socket or safely closes
   * the previous socket before creating a new one (Requirement 7).
   */
  async getOrInitSocket(): Promise<WASocket> {
    if (this.initPromise) {
      return this.initPromise;
    }

    if (this.sock && this.socketReady()) {
      return this.sock;
    }

    this.isInitializing = true;
    this.initPromise = (async () => {
      try {
        // Safely teardown previous socket if present
        if (this.sock) {
          try {
            this.sock.ev.removeAllListeners('connection.update');
            this.sock.ev.removeAllListeners('creds.update');
            this.sock.end(undefined);
          } catch {}
          this.sock = null;
        }

        logLifecycle(LogEvent.WHATSAPP_CONNECTING);
        if (this.status !== 'pairing') {
          this.status = 'connecting';
        }
        this.lastError = null;
        await this.persistState();

        const { state, saveCreds, clearAuth } = await usePostgresAuthState();
        this.saveCredsFn = saveCreds;
        this.clearAuthFn = clearAuth;

        const baileysLogger = pino({ level: 'silent' });

        let waVersion: [number, number, number] | undefined = undefined;
        try {
          const versionInfo = await fetchLatestBaileysVersion();
          waVersion = versionInfo.version;
          logger.info({ waVersion }, 'Using latest WhatsApp Web protocol version');
        } catch {
          // fallback to default if network fetch fails
        }

        const sock = makeWASocket({
          version: waVersion,
          auth: state,
          printQRInTerminal: false,
          logger: baileysLogger,
          browser: Browsers.ubuntu('Chrome'),
          syncFullHistory: false,
          generateHighQualityLinkPreview: true,
          connectTimeoutMs: 60000,
          defaultQueryTimeoutMs: 60000,
          keepAliveIntervalMs: 25000,
          emitOwnEvents: false,
        });

        this.sock = sock;

        sock.ev.on('creds.update', async () => {
          await saveCreds();
        });

        sock.ev.on('connection.update', async (update: Partial<BaileysConnectionState>) => {
          await this.handleConnectionUpdate(update);
        });

        return sock;
      } finally {
        this.isInitializing = false;
        this.initPromise = null;
      }
    })();

    return this.initPromise;
  }

  /**
   * Handles Baileys connection events (Requirement 8).
   * Connection state from Baileys is the authoritative source of truth.
   */
  private async handleConnectionUpdate(update: Partial<BaileysConnectionState>): Promise<void> {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      try {
        const QRCode = await import('qrcode');
        this.qrCodeDataUrl = await QRCode.toDataURL(qr);
        logger.info('Live WhatsApp QR code generated for scanning');
      } catch (err: any) {
        logger.warn({ err: err.message }, 'Failed to render QR code data URL');
      }
    }

    if (connection === 'open') {
      this.status = 'connected';
      this.reconnectAttempts = 0; // Reset exponential backoff on successful connection (Requirement 9)
      this.isPairingInProgress = false;
      this.pairingCode = null;
      this.qrCodeDataUrl = null;
      this.pairingExpiresAt = null;
      this.lastConnectedAt = new Date();
      this.lastError = null;

      logLifecycle(LogEvent.WHATSAPP_CONNECTED, {
        jid: this.sock?.user?.id,
        phone: this.phoneNumber,
      });

      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }

      await this.persistState();
      console.log(`[WHATSAPP] Authoritative connection established: CONNECTED (${this.sock?.user?.id || 'Ready'})`);

      // Trigger session scheduler tick on reconnection to resume eligible session (Requirement 4 & 6)
      try {
        const { sessionScheduler } = await import('../services/sessionScheduler.js');
        sessionScheduler.tick().catch(() => {});
      } catch {}

    } else if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
      const errorMsg = lastDisconnect?.error?.message || 'Connection closed';

      logLifecycle(LogEvent.WHATSAPP_DISCONNECTED, {
        statusCode,
        reason: errorMsg,
      });

      // 1. Logged out explicitly by user or WhatsApp server (Requirement 15)
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;
      if (isLoggedOut) {
        console.log('[WHATSAPP] Account logged out. Setting state to LOGGED_OUT / NOT_PAIRED.');
        this.status = 'logged_out';
        this.sock = null;
        this.pairingCode = null;
        this.pairingExpiresAt = null;
        this.lastError = 'WhatsApp session logged out. Please pair again.';
        if (this.clearAuthFn) {
          await this.clearAuthFn();
        }
        await this.persistState();

        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        return;
      }

      // 2. Bad session (500) - stored credentials corrupted or invalidated
      if (statusCode === DisconnectReason.badSession) {
        logger.warn('WhatsApp reported bad or corrupted session. Clearing invalid credentials.');
        this.status = 'not_paired';
        this.sock = null;
        this.pairingCode = null;
        this.pairingExpiresAt = null;
        this.lastError = 'WhatsApp credentials expired or corrupted. Please pair again.';
        if (this.clearAuthFn) {
          await this.clearAuthFn();
        }
        await this.persistState();

        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        return;
      }

      // 3. Connection replaced (440) - another client or instance connected
      if (statusCode === DisconnectReason.connectionReplaced) {
        logger.warn('WhatsApp connection replaced by another session/device.');
        this.status = 'disconnected';
        this.sock = null;
        this.lastError = 'Connection replaced by another active session.';
        await this.persistState();

        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        return;
      }

      // 4. Restart required (515) - standard Baileys pairing & protocol restart
      if (statusCode === DisconnectReason.restartRequired) {
        logger.info('WhatsApp requested restart (515); restarting socket connection immediately...');
        this.sock = null;
        setTimeout(() => {
          this.getOrInitSocket().catch((err) => {
            logger.error({ err: err.message }, 'Failed during restartRequired reconnect');
          });
        }, 1000);
        return;
      }

      // 5. User is actively pairing with phone number
      const hasActivePairing =
        (this.status === 'pairing' || !!this.pairingCode) &&
        this.pairingExpiresAt &&
        new Date(this.pairingExpiresAt).getTime() > Date.now();

      if (hasActivePairing && !this.isShuttingDown) {
        logger.info('Socket connection closed during pairing wait; keeping pairing code active and reconnecting socket...');
        this.sock = null;
        setTimeout(() => {
          this.getOrInitSocket().catch((err) => {
            logger.error({ err: err.message }, 'Failed during pairing socket recovery');
          });
        }, 1500);
        return;
      }

      // 6. Standard disconnected state
      this.status = 'disconnected';
      this.sock = null;
      this.lastError = `Connection closed (status ${statusCode || 'unknown'}).`;
      await this.persistState();

      // Check if credentials exist before scheduling automatic reconnect
      const hasAuth = await hasStoredAuth();
      if (!hasAuth) {
        this.status = 'not_paired';
        this.lastError = null;
        await this.persistState();
        return;
      }

      // Exponential reconnect backoff (Requirement 9): 1s, 2s, 4s, 8s, 16s, 30s max
      if (!this.isShuttingDown && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        const backoffMs = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 30000);
        logger.info(
          { attempt: this.reconnectAttempts, max: this.maxReconnectAttempts, backoffMs },
          'Scheduling WhatsApp reconnect with exponential backoff...'
        );

        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
        }

        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null;
          this.getOrInitSocket().catch((err) => {
            logger.error({ err: err.message }, 'Failed during automatic reconnect attempt');
          });
        }, backoffMs);
      } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        this.status = 'disconnected';
        this.lastError = `Reconnection attempts (${this.maxReconnectAttempts}) reached limit. Manual reconnect available.`;
        await this.persistState();
      }
    }
  }

  /**
   * Checks whether WhatsApp is in authenticated CONNECTED state.
   */
  whatsappConnected(): boolean {
    return this.status === 'connected' && this.sock !== null;
  }

  /**
   * Checks whether WhatsApp authentication credentials are valid and registered.
   */
  whatsappAuthenticated(): boolean {
    if (!this.sock) return false;
    const creds = this.sock.authState?.creds;
    return !!(creds?.registered === true || creds?.me?.id);
  }

  /**
   * Checks whether the underlying Baileys WebSocket is open and ready.
   */
  socketReady(): boolean {
    if (!this.sock) return false;
    const ws = (this.sock as any).ws;
    if (!ws) return false;
    if (ws.isClosed || ws.isClosing) return false;
    // WebSocket.OPEN is 1
    return ws.readyState === 1 || ws.readyState === undefined;
  }

  /**
   * Checks whether an active WhatsApp Newsletter channel destination is configured.
   * Requirement 11: Validates format (e.g. 120363411395110604@newsletter).
   */
  async destinationConfigured(): Promise<{
    configured: boolean;
    destination: string | null;
    error?: string;
  }> {
    const dest = await getActiveWhatsAppDestination();
    if (!dest) {
      return {
        configured: false,
        destination: null,
        error: '⚠️ WhatsApp destination is not configured.',
      };
    }

    const validation = validateNewsletterJid(dest);
    if (!validation.valid || !validation.normalizedJid) {
      return {
        configured: false,
        destination: dest,
        error: `⚠️ WhatsApp destination is invalid: ${validation.error}`,
      };
    }

    return {
      configured: true,
      destination: validation.normalizedJid,
    };
  }

  /**
   * AUTHORITATIVE READINESS GATE (Requirement 1 & 10):
   * A session MUST NEVER start and the prediction engine MUST NEVER generate
   * new signals unless this returns ready: true.
   *
   * Verifies all 4 conditions:
   * 1. whatsappConnected()
   * 2. whatsappAuthenticated()
   * 3. socketReady()
   * 4. destinationConfigured()
   */
  async isReady(): Promise<{ ready: boolean; reason?: string; destination?: string }> {
    if (this.status === 'not_paired') {
      return { ready: false, reason: 'WhatsApp Not Connected (NOT_PAIRED)' };
    }
    if (this.status === 'logged_out') {
      return { ready: false, reason: 'WhatsApp Logged Out' };
    }
    if (!this.whatsappConnected()) {
      return { ready: false, reason: 'WhatsApp is not connected' };
    }
    if (!this.whatsappAuthenticated()) {
      return { ready: false, reason: 'WhatsApp is not authenticated' };
    }
    if (!this.socketReady()) {
      return { ready: false, reason: 'WhatsApp socket is not ready' };
    }

    const destCheck = await this.destinationConfigured();
    if (!destCheck.configured) {
      return { ready: false, reason: destCheck.error || '⚠️ WhatsApp destination is not configured.' };
    }

    return { ready: true, destination: destCheck.destination! };
  }

  /**
   * Returns current connection state enum.
   */
  getConnectionState(): WhatsAppStatus {
    return this.status;
  }

  /**
   * Generates a Phone Number Pairing Code (Requirement 14).
   * Ensures no duplicate sockets, cleans phone number, requests 8-char pairing code.
   */
  async requestPairingCode(rawPhoneNumber: string): Promise<string> {
    if (this.isPairingInProgress) {
      throw new Error('A pairing request is already in progress. Please wait.');
    }

    let cleanPhone = rawPhoneNumber.replace(/\D/g, '');
    // Smart phone normalization (especially for Pakistan and regional carriers)
    if (cleanPhone.startsWith('03') && cleanPhone.length === 11) {
      cleanPhone = '92' + cleanPhone.slice(1);
    } else if (cleanPhone.startsWith('920') && cleanPhone.length === 12) {
      cleanPhone = '92' + cleanPhone.slice(3);
    } else if (cleanPhone.startsWith('0')) {
      cleanPhone = cleanPhone.replace(/^0+/, '');
    }

    if (!cleanPhone || cleanPhone.length < 8 || cleanPhone.length > 15) {
      throw new Error('Invalid phone number format. Provide 8 to 15 digits including country code.');
    }

    if (this.status === 'connected' && this.whatsappAuthenticated()) {
      throw new Error('WhatsApp is already connected and authenticated. Logout first before pairing a new number.');
    }

    this.isPairingInProgress = true;
    logLifecycle(LogEvent.PAIRING_STARTED, { phone: cleanPhone });

    // CRITICAL: If not yet authenticated, wipe stale keys to prevent "Could not link device"
    if (!this.whatsappAuthenticated()) {
      if (this.sock) {
        try {
          this.sock.ev.removeAllListeners('connection.update');
          this.sock.ev.removeAllListeners('creds.update');
          this.sock.end(undefined);
        } catch {}
        this.sock = null;
      }
      if (this.clearAuthFn) {
        await this.clearAuthFn();
      }
    }

    const attemptPairing = async (targetSock: WASocket): Promise<string> => {
      logger.info('Waiting for WhatsApp socket to open before requesting pairing code...');
      await Promise.race([
        targetSock.waitForSocketOpen(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Connection timed out waiting for WhatsApp servers.')), 20000)
        ),
      ]);

      // Give WhatsApp 3.5s to establish cryptographic session channels
      await new Promise((resolve) => setTimeout(resolve, 3500));
      const code = await targetSock.requestPairingCode(cleanPhone);

      // Persist credentials immediately so 515 restart doesn't wipe them
      try {
        if (this.saveCredsFn) {
          await this.saveCredsFn();
        }
      } catch (err: any) {
        logger.warn({ err: err.message }, 'Failed to persist credentials immediately after pairing code generation');
      }

      return code;
    };

    try {
      let sock = await this.getOrInitSocket();

      if (sock.authState?.creds?.registered) {
        this.isPairingInProgress = false;
        this.status = 'connected';
        await this.persistState();
        throw new Error('WhatsApp is already authenticated and registered.');
      }

      let code: string;
      try {
        code = await attemptPairing(sock);
      } catch (firstErr: any) {
        const isClosedError =
          firstErr?.message?.includes('Connection Closed') ||
          firstErr?.message?.includes('connectionClosed') ||
          firstErr?.output?.statusCode === DisconnectReason.connectionClosed;

        if (isClosedError) {
          logger.warn('Socket closed on first pairing attempt; retrying with a fresh socket connection...');
          if (this.sock) {
            try {
              this.sock.end(undefined);
            } catch {}
            this.sock = null;
          }
          const freshSock = await this.getOrInitSocket();
          code = await attemptPairing(freshSock);
        } else {
          throw firstErr;
        }
      }

      this.status = 'pairing';
      this.phoneNumber = cleanPhone;
      this.pairingCode = code;
      this.pairingExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes expiry
      this.lastError = null;

      logLifecycle(LogEvent.PAIRING_CODE_GENERATED, {
        phone: cleanPhone,
        code,
      });

      await this.persistState();
      this.isPairingInProgress = false;
      return code;
    } catch (err: any) {
      this.isPairingInProgress = false;
      this.lastError = err.message || 'Failed to request pairing code';
      logLifecycle(LogEvent.PAIRING_FAILED, { error: this.lastError });
      await this.persistState();
      throw err;
    }
  }

  /**
   * Sends a message with full readiness validation (Requirement 10 & 12).
   * Catches errors safely without crashing the Node.js process.
   */
  async sendMessage(
    messageText: string,
    explicitDestination?: string,
    messageType: 'TEST_MESSAGE' | 'SIGNAL' | 'WIN' | 'LOSS' | 'TARGET_COMPLETE' | 'SESSION_HISTORY' | string = 'SIGNAL'
  ): Promise<{ success: boolean; messageId?: string; destination: string }> {
    const destination = explicitDestination || (await getActiveWhatsAppDestination());

    if (!destination) {
      const err = '⚠️ WhatsApp destination is not configured.';
      await this.logDelivery(messageType, 'none', messageText, 'FAILED', err);
      throw new Error(err);
    }

    const validation = validateNewsletterJid(destination);
    if (!validation.valid || !validation.normalizedJid) {
      const err = `⚠️ Invalid WhatsApp destination: ${validation.error}`;
      await this.logDelivery(messageType, destination, messageText, 'FAILED', err);
      throw new Error(err);
    }

    if (!this.whatsappConnected() || !this.sock) {
      const err = 'WhatsApp is not connected. Please pair or connect WhatsApp before sending messages.';
      await this.logDelivery(messageType, destination, messageText, 'FAILED', err);
      throw new Error(err);
    }

    try {
      const sendPromise = this.sock.sendMessage(validation.normalizedJid, { text: messageText });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('WhatsApp delivery timed out after 12s')), 12000)
      );
      const sendResult = (await Promise.race([sendPromise, timeoutPromise])) as any;
      const messageId = sendResult?.key?.id || undefined;

      await this.logDelivery(messageType, validation.normalizedJid, messageText, 'SUCCESS');
      logLifecycle(LogEvent.SIGNAL_SENT, { destination: validation.normalizedJid, type: messageType, messageId });

      return { success: true, messageId, destination: validation.normalizedJid };
    } catch (err: any) {
      const errMsg = err.message || 'Unknown Baileys send error';
      await this.logDelivery(messageType, destination, messageText, 'FAILED', errMsg);
      logLifecycle(LogEvent.SIGNAL_FAILED, { destination, type: messageType, error: errMsg });

      // If socket disconnected during send, mark status and trigger recovery
      if (
        errMsg.includes('Connection Closed') ||
        errMsg.includes('closed') ||
        errMsg.includes('timed out')
      ) {
        this.status = 'disconnected';
        this.lastError = `Send failed due to disconnected socket: ${errMsg}`;
        await this.persistState();
      }

      throw new Error(`Failed to send WhatsApp message to ${destination}: ${errMsg}`);
    }
  }

  /**
   * Sends a test message to the configured active Newsletter.
   */
  async sendTestMessage(): Promise<{ destination: string; messageId?: string }> {
    const now = Date.now();
    if (now - this.lastTestMessageSentAt < 5000) {
      throw new Error('Test message rate limit exceeded. Please wait 5 seconds between tests.');
    }

    const destination = await getActiveWhatsAppDestination();
    if (!destination) {
      throw new Error('⚠️ WhatsApp destination is not configured. Please configure your WhatsApp Channel in Settings first.');
    }

    const { renderDynamicTest } = await import('../utils/formatters.js');
    const messageText = await renderDynamicTest(destination);
    const result = await this.sendMessage(messageText, destination, 'TEST_MESSAGE');
    this.lastTestMessageSentAt = now;
    return { destination, messageId: result.messageId };
  }

  /**
   * Resolves a WhatsApp Channel invite link or code to its @newsletter JID.
   */
  async resolveChannelLink(input: string): Promise<{ jid: string; name?: string; description?: string }> {
    const trimmed = input.trim();

    if (trimmed.endsWith('@newsletter')) {
      return { jid: trimmed };
    }

    const match = trimmed.match(/(?:whatsapp\.com\/channel\/|chat\.whatsapp\.com\/)([a-zA-Z0-9_-]+)/i);
    const code = match ? match[1] : trimmed;

    if (!code) {
      throw new Error('Could not parse channel invite code or JID.');
    }

    if (!this.whatsappConnected() || !this.sock) {
      throw new Error(
        'WhatsApp must be connected to resolve channel invite links. Alternatively, enter the channel JID directly (e.g. 120363411395110604@newsletter).'
      );
    }

    try {
      const metadata = await (this.sock as any).newsletterMetadata('invite', code);
      if (metadata && metadata.id) {
        const jid = metadata.id.includes('@newsletter') ? metadata.id : `${metadata.id}@newsletter`;
        return {
          jid,
          name: metadata.thread_metadata?.name?.text || metadata.name,
          description: metadata.thread_metadata?.description?.text,
        };
      }
      throw new Error('Channel not found for this invite code.');
    } catch (err: any) {
      throw new Error(`Failed to resolve channel link: ${err.message || 'Invalid channel invite'}`);
    }
  }

  /**
   * Records delivery logs into PostgreSQL.
   */
  private async logDelivery(
    type: string,
    destination: string,
    message: string,
    status: 'SUCCESS' | 'FAILED',
    error?: string
  ): Promise<void> {
    try {
      await query(
        `INSERT INTO delivery_logs (type, destination, message, status, error, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [type, destination, message, status, error || null]
      );
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to record delivery log');
    }
  }

  /**
   * Logs out from WhatsApp (Requirement 15).
   * Sets backend state to LOGGED_OUT / NOT_PAIRED, stops predictions, requires pairing again.
   */
  async logout(): Promise<void> {
    this.isShuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.sock) {
      try {
        await this.sock.logout();
      } catch {}
      this.sock = null;
    }

    if (this.clearAuthFn) {
      await this.clearAuthFn();
    }

    this.status = 'logged_out';
    this.phoneNumber = null;
    this.pairingCode = null;
    this.pairingExpiresAt = null;
    this.lastError = 'Logged out. Pairing required.';
    this.reconnectAttempts = 0;
    this.isShuttingDown = false;

    await this.persistState();
    logLifecycle(LogEvent.WHATSAPP_DISCONNECTED, { reason: 'User requested logout' });

    console.log('[WHATSAPP] Logged out successfully. Prediction generation disabled.');
  }

  /**
   * Reconnects WhatsApp manually (Requirement 6 & 7).
   * Safely closes old socket before initiating a single fresh connection.
   */
  async reconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.reconnectAttempts = 0;
    this.lastError = null;

    if (this.sock) {
      try {
        this.sock.end(undefined);
      } catch {}
      this.sock = null;
    }

    await this.getOrInitSocket();
  }

  /**
   * Returns current WhatsApp status for API and dashboard.
   * Requirement 13: Only shows connected when Baileys reports open & authenticated.
   */
  getStatus(): WhatsAppClientState {
    const isPairingExpired =
      this.pairingExpiresAt !== null && new Date() > this.pairingExpiresAt;

    const isConnected = this.whatsappConnected() && this.whatsappAuthenticated();
    let effectiveStatus: WhatsAppStatus = isConnected ? 'connected' : this.status;
    if (!isConnected && this.status === 'connected') {
      effectiveStatus = 'disconnected';
    }

    return {
      status: effectiveStatus,
      phoneNumber: this.phoneNumber,
      pairingCode: isPairingExpired ? null : this.pairingCode,
      pairingExpiresAt: this.pairingExpiresAt?.toISOString() || null,
      qrCode: isConnected ? null : this.qrCodeDataUrl,
      lastConnectedAt: this.lastConnectedAt?.toISOString() || null,
      lastError: this.lastError,
      reconnectAttempts: this.reconnectAttempts,
      isRegistered: this.whatsappAuthenticated(),
      destinationConfigured: false, // populated dynamically via async or API where needed
      destination: null,
      isReady: isConnected,
    };
  }
}

export const whatsAppManager = new WhatsAppManager();
export const whatsappService = whatsAppManager;
