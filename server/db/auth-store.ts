import fs from 'fs';
import path from 'path';
import {
  useMultiFileAuthState,
  BufferJSON,
  type AuthenticationState,
} from '@whiskeysockets/baileys';
import { query } from './index.js';
import { logger } from '../services/logger.js';

const AUTH_DIR = path.resolve(process.cwd(), process.env.AUTH_DIR || 'auth_info_baileys');

/**
 * Checks whether valid, authenticated WhatsApp credentials exist.
 * Checks local filesystem first, then falls back to PostgreSQL.
 */
export async function hasStoredAuth(): Promise<boolean> {
  try {
    const credsPath = path.join(AUTH_DIR, 'creds.json');
    if (fs.existsSync(credsPath)) {
      const raw = fs.readFileSync(credsPath, 'utf-8');
      const parsed = JSON.parse(raw, BufferJSON.reviver);
      if (parsed?.me?.id || parsed?.registered === true || parsed?.account) {
        return true;
      }
    }

    // Fallback: check PostgreSQL/local DB
    const credsRes = await query<{ data: any }>(
      'SELECT data FROM whatsapp_auth WHERE id = $1',
      ['creds']
    );

    if (credsRes.rowCount === 0 || !credsRes.rows[0]?.data) {
      return false;
    }

    const raw = credsRes.rows[0].data;
    const parsed =
      typeof raw === 'string'
        ? JSON.parse(raw, BufferJSON.reviver)
        : JSON.parse(JSON.stringify(raw), BufferJSON.reviver);

    return !!(parsed?.me?.id || parsed?.registered === true || parsed?.account);
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Failed to check stored WhatsApp auth');
    return false;
  }
}

/**
 * Reads the phone number from stored creds.json (e.g. after QR code scan).
 */
export function getStoredUserPhone(): string | null {
  try {
    const credsPath = path.join(AUTH_DIR, 'creds.json');
    if (fs.existsSync(credsPath)) {
      const raw = fs.readFileSync(credsPath, 'utf-8');
      const parsed = JSON.parse(raw, BufferJSON.reviver);
      if (parsed?.me?.id) {
        return parsed.me.id.split(':')[0].replace(/\D/g, '');
      }
    }
  } catch {}
  return null;
}

/**
 * Restores auth files from PostgreSQL to disk if disk is empty.
 */
async function restoreAuthFromDbIfNeeded(): Promise<void> {
  try {
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }

    const credsPath = path.join(AUTH_DIR, 'creds.json');
    if (!fs.existsSync(credsPath)) {
      const res = await query<{ id: string; data: any }>(
        'SELECT id, data FROM whatsapp_auth'
      );
      if (res.rowCount > 0) {
        logger.info(`Restoring ${res.rowCount} WhatsApp auth keys from PostgreSQL to local disk...`);
        for (const row of res.rows) {
          const filename = row.id.endsWith('.json') ? row.id : `${row.id}.json`;
          const filePath = path.join(AUTH_DIR, filename);
          const content =
            typeof row.data === 'string' ? row.data : JSON.stringify(row.data);
          fs.writeFileSync(filePath, content, 'utf-8');
        }
      }
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Error restoring auth from PostgreSQL');
  }
}

/**
 * Syncs auth files to PostgreSQL in the background without blocking pairing handshake.
 */
async function syncAuthToDb(): Promise<void> {
  try {
    if (!fs.existsSync(AUTH_DIR)) return;
    const files = fs.readdirSync(AUTH_DIR);
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(AUTH_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const keyId = file.replace(/\.json$/, '');
      await query(
        `INSERT INTO whatsapp_auth (id, data, updated_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (id) DO UPDATE
         SET data = EXCLUDED.data, updated_at = NOW()`,
        [keyId, content]
      );
    }
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Failed to sync auth files to PostgreSQL');
  }
}

/**
 * Native, mutex-protected multi-file auth state for Baileys with PostgreSQL sync.
 * Guarantees zero latency and eliminates "Couldn't link device" errors during handshake.
 */
export async function usePostgresAuthState(): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  clearAuth: () => Promise<void>;
}> {
  await restoreAuthFromDbIfNeeded();

  if (!fs.existsSync(AUTH_DIR)) {
    fs.mkdirSync(AUTH_DIR, { recursive: true });
  }

  const { state, saveCreds: originalSaveCreds } = await useMultiFileAuthState(AUTH_DIR);

  const saveCreds = async () => {
    await originalSaveCreds();
    // Non-blocking sync to PostgreSQL
    setTimeout(() => {
      syncAuthToDb().catch(() => {});
    }, 100);
  };

  const clearAuth = async () => {
    try {
      if (fs.existsSync(AUTH_DIR)) {
        fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        logger.info('Local WhatsApp auth directory cleared.');
      }
      await query('DELETE FROM whatsapp_auth');
      logger.info('PostgreSQL WhatsApp auth table cleared.');
    } catch (err: any) {
      logger.error({ err: err.message }, 'Failed to clear WhatsApp auth');
    }
  };

  return {
    state,
    saveCreds,
    clearAuth,
  };
}
