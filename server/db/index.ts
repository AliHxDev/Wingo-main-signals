import fs from 'fs';
import path from 'path';
import pg from 'pg';
import bcrypt from 'bcrypt';
import { newDb } from 'pg-mem';
import { config } from '../config/index.js';
import { logger } from '../services/logger.js';

const { Pool } = pg;

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'wingo_database.json');

const PERSISTED_TABLES = [
  'users',
  'settings',
  'whatsapp_connection',
  'session_configs',
  'bot_sessions',
  'signals',
  'wingo_results',
  'delivery_logs',
  'session_reminders',
  'scheduled_reminders',
  'message_templates',
  'system_logs',
];

let saveTimeout: NodeJS.Timeout | null = null;

export async function flushLocalDatabase(target: DatabaseAdapter): Promise<void> {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const dump: Record<string, any[]> = {};
    for (const table of PERSISTED_TABLES) {
      try {
        const res = await target.query(`SELECT * FROM ${table}`);
        dump[table] = res.rows;
      } catch {}
    }
    const tempFile = `${DB_FILE}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(dump, null, 2), 'utf-8');
    fs.renameSync(tempFile, DB_FILE);
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Failed to persist local database to disk');
  }
}

export function scheduleLocalDatabaseSave(target: DatabaseAdapter): void {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    flushLocalDatabase(target).catch(() => {});
  }, 300);
}

export async function restoreLocalDatabase(target: DatabaseAdapter): Promise<void> {
  try {
    if (!fs.existsSync(DB_FILE)) return;
    const raw = fs.readFileSync(DB_FILE, 'utf-8');
    const data = JSON.parse(raw);
    logger.info('Restoring local persistent database from ./data/wingo_database.json...');

    for (const table of PERSISTED_TABLES) {
      const rows = data[table];
      if (!Array.isArray(rows) || rows.length === 0) continue;

      for (const row of rows) {
        try {
          if (table === 'settings') {
            await target.query(
              `INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`,
              [row.key, row.value]
            );
          } else if (table === 'users') {
            await target.query(
              `INSERT INTO users (id, username, password_hash) VALUES ($1, $2, $3) ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash;`,
              [row.id, row.username, row.password_hash]
            );
          } else if (table === 'whatsapp_connection') {
            await target.query(
              `INSERT INTO whatsapp_connection (id, status, phone_number, pairing_code, last_error) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, phone_number = EXCLUDED.phone_number;`,
              [row.id, row.status, row.phone_number, row.pairing_code, row.last_error]
            );
          } else if (table === 'session_configs') {
            await target.query(
              `INSERT INTO session_configs (id, session_name, start_time, end_time, enabled, target_wins, min_confidence, signal_delay_min, signal_delay_max) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (id) DO UPDATE SET session_name = EXCLUDED.session_name, start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time;`,
              [row.id, row.session_name, row.start_time, row.end_time, row.enabled, row.target_wins, row.min_confidence, row.signal_delay_min, row.signal_delay_max]
            );
          } else {
            const keys = Object.keys(row);
            const cols = keys.map((k) => `"${k}"`).join(', ');
            const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');
            const values = keys.map((k) => {
              const val = row[k];
              if (val !== null && typeof val === 'object' && !(val instanceof Date)) {
                return JSON.stringify(val);
              }
              return val;
            });
            await target.query(
              `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) ON CONFLICT DO NOTHING;`,
              values
            );
          }
        } catch {}
      }
    }
    logger.info('Local persistent database successfully restored.');
  } catch (err: any) {
    logger.warn({ err: err.message }, 'Failed to restore local database from file');
  }
}

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export interface DatabaseAdapter {
  query: <T = any>(text: string, params?: any[]) => Promise<QueryResult<T>>;
  close: () => Promise<void>;
  isRealPostgres: boolean;
}

let dbAdapter: DatabaseAdapter | null = null;
let dbInitPromise: Promise<DatabaseAdapter> | null = null;

export async function getDatabase(): Promise<DatabaseAdapter> {
  if (dbAdapter) {
    return dbAdapter;
  }

  if (dbInitPromise) {
    return dbInitPromise;
  }

  dbInitPromise = (async () => {
    let selectedAdapter: DatabaseAdapter | null = null;

    const isTestEnv =
      process.env.NODE_ENV === 'test' ||
      process.env.VITEST === 'true' ||
      config.NODE_ENV === 'test';

    const useLocalDb =
      process.env.USE_LOCAL_DB === 'true' ||
      !config.DATABASE_URL ||
      config.DATABASE_URL.trim() === '';

    if (!useLocalDb && !isTestEnv && config.DATABASE_URL) {
      const dbUrl = config.DATABASE_URL.trim();
      const isLocal = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1');
      const useSsl = config.DATABASE_SSL || !isLocal;
      const isSupabase = dbUrl.includes('supabase') || dbUrl.includes('pooler');

      logger.info(
        { ssl: useSsl, isSupabase },
        'Connecting to PostgreSQL database via DATABASE_URL...'
      );

      const maxRetries = 2;
      let lastErr: any = null;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          let pool: any;
          try {
            pool = new Pool({
              connectionString: dbUrl,
              ssl: useSsl ? { rejectUnauthorized: false } : undefined,
              max: 10,
              idleTimeoutMillis: 30000,
              connectionTimeoutMillis: 10000,
              keepAlive: true,
              keepAliveInitialDelayMillis: 10000,
            });
            await pool.query('SELECT 1');
          } catch (sslErr: any) {
            if (
              useSsl &&
              (sslErr.message?.includes('SSL') ||
                sslErr.message?.includes('ssl') ||
                sslErr.message?.includes('The server does not support SSL'))
            ) {
              logger.info(
                'SSL rejected by PostgreSQL server, connecting without SSL...'
              );
              pool = new Pool({
                connectionString: dbUrl,
                ssl: undefined,
                max: 10,
                idleTimeoutMillis: 30000,
                connectionTimeoutMillis: 10000,
                keepAlive: true,
                keepAliveInitialDelayMillis: 10000,
              });
              await pool.query('SELECT 1');
            } else {
              throw sslErr;
            }
          }

          pool.on('error', (err: any) => {
            logger.error({ err: err.message }, 'Unexpected PostgreSQL pool error');
          });

          selectedAdapter = {
            query: async <T = any>(text: string, params?: any[]) => {
              const res = await pool.query(text, params);
              return {
                rows: res.rows as T[],
                rowCount: res.rowCount ?? res.rows.length,
              };
            },
            close: async () => {
              await pool.end();
              dbAdapter = null;
              dbInitPromise = null;
            },
            isRealPostgres: true,
          };

          logger.info('Connected to PostgreSQL successfully.');
          break;
        } catch (connErr: any) {
          lastErr = connErr;
          logger.warn(
            { attempt, maxRetries, err: connErr.message },
            'PostgreSQL connection attempt failed, retrying...'
          );
          if (connErr.code === 'ENOTFOUND' || connErr.code === 'EAI_AGAIN') {
            break;
          }
          if (attempt < maxRetries) {
            await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          }
        }
      }

      if (!selectedAdapter && lastErr) {
        logger.warn(
          { err: lastErr.message },
          'PostgreSQL unreachable. Running on native local persistent database engine (Oracle self-contained).'
        );
        selectedAdapter = null;
      }
    }

    if (!selectedAdapter) {
      logger.info(
        'Using Oracle Native Persistent Database Engine (stored locally in ./data/wingo_database.json).'
      );
      const memDb = newDb();

      memDb.public.registerFunction({
        name: 'now',
        implementation: () => new Date().toISOString(),
      });

      const pgAdapter = memDb.adapters.createPg();
      const pool = new pgAdapter.Pool();

      selectedAdapter = {
        query: async <T = any>(text: string, params?: any[]) => {
          const res = await pool.query(text, params);
          const isWrite = /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/i.test(text.trim());
          if (isWrite && selectedAdapter) {
            scheduleLocalDatabaseSave(selectedAdapter);
          }
          return {
            rows: res.rows as T[],
            rowCount: res.rowCount ?? (res.rows ? res.rows.length : 0),
          };
        },
        close: async () => {
          if (selectedAdapter) {
            await flushLocalDatabase(selectedAdapter);
          }
          await pool.end();
          dbAdapter = null;
          dbInitPromise = null;
        },
        isRealPostgres: false,
      };
    }

    await initSchemaAndSeed(selectedAdapter);
    dbAdapter = selectedAdapter;
    return dbAdapter;
  })();

  return dbInitPromise;
}

export async function query<T = any>(text: string, params?: any[]): Promise<QueryResult<T>> {
  const db = await getDatabase();
  return db.query<T>(text, params);
}

export async function initDatabase(): Promise<void> {
  await getDatabase();
}

async function initSchemaAndSeed(targetAdapter?: DatabaseAdapter): Promise<void> {
  const target = targetAdapter || dbAdapter;
  if (!target) return;

  // 1. Create tables
  await target.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(100) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await target.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key VARCHAR(100) PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await target.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_auth (
      id VARCHAR(255) PRIMARY KEY,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await target.query(`
    CREATE TABLE IF NOT EXISTS whatsapp_connection (
      id VARCHAR(50) PRIMARY KEY,
      status VARCHAR(50) NOT NULL DEFAULT 'disconnected',
      phone_number VARCHAR(50),
      pairing_code VARCHAR(20),
      pairing_expires_at TIMESTAMPTZ,
      last_error TEXT,
      connected_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await target.query(`
    CREATE TABLE IF NOT EXISTS session_configs (
      id SERIAL PRIMARY KEY,
      session_name VARCHAR(100) NOT NULL,
      start_time VARCHAR(10) NOT NULL,
      end_time VARCHAR(10),
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      target_wins INTEGER NOT NULL DEFAULT 10,
      min_confidence INTEGER NOT NULL DEFAULT 65,
      signal_delay_min INTEGER NOT NULL DEFAULT 15,
      signal_delay_max INTEGER NOT NULL DEFAULT 15,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await target.query(`
    CREATE TABLE IF NOT EXISTS bot_sessions (
      id SERIAL PRIMARY KEY,
      session_config_id INTEGER,
      session_name VARCHAR(100) NOT NULL,
      schedule_date VARCHAR(20) NOT NULL,
      date VARCHAR(20),
      start_time VARCHAR(10) NOT NULL,
      end_time VARCHAR(10),
      status VARCHAR(50) NOT NULL DEFAULT 'SCHEDULED',
      target_wins INTEGER NOT NULL DEFAULT 10,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      total_signals INTEGER NOT NULL DEFAULT 0,
      win_rate NUMERIC(5,2) NOT NULL DEFAULT 0.00,
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      target_completion_status VARCHAR(20) DEFAULT NULL,
      target_completion_scheduled_for TIMESTAMPTZ,
      target_completion_sent_at TIMESTAMPTZ,
      target_message_sent_at TIMESTAMPTZ,
      history_message_status VARCHAR(20) DEFAULT NULL,
      history_scheduled_for TIMESTAMPTZ,
      history_message_sent_at TIMESTAMPTZ,
      history_sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await target.query(`
    CREATE TABLE IF NOT EXISTS signals (
      id SERIAL PRIMARY KEY,
      issue_number VARCHAR(100) UNIQUE NOT NULL,
      prediction VARCHAR(20) NOT NULL,
      predicted_color VARCHAR(50) NOT NULL,
      confidence INTEGER NOT NULL,
      status VARCHAR(30) NOT NULL DEFAULT 'SCHEDULED',
      scheduled_at TIMESTAMPTZ,
      sent_at TIMESTAMPTZ,
      actual_number INTEGER,
      actual_size VARCHAR(20),
      actual_color VARCHAR(50),
      sent_to VARCHAR(255) NOT NULL,
      session_id INTEGER,
      settled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migrations for existing tables
  try {
    await target.query(`ALTER TABLE signals ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;`);
    await target.query(`ALTER TABLE signals ADD COLUMN IF NOT EXISTS session_id INTEGER;`);
    await target.query(`ALTER TABLE signals ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;`);
    await target.query(`ALTER TABLE bot_sessions ADD COLUMN IF NOT EXISTS target_completion_status VARCHAR(20) DEFAULT NULL;`);
    await target.query(`ALTER TABLE bot_sessions ADD COLUMN IF NOT EXISTS target_completion_scheduled_for TIMESTAMPTZ;`);
    await target.query(`ALTER TABLE bot_sessions ADD COLUMN IF NOT EXISTS target_completion_sent_at TIMESTAMPTZ;`);
    await target.query(`ALTER TABLE bot_sessions ADD COLUMN IF NOT EXISTS history_message_status VARCHAR(20) DEFAULT NULL;`);
    await target.query(`ALTER TABLE bot_sessions ADD COLUMN IF NOT EXISTS history_scheduled_for TIMESTAMPTZ;`);
    await target.query(`ALTER TABLE bot_sessions ADD COLUMN IF NOT EXISTS history_sent_at TIMESTAMPTZ;`);
  } catch {
    // Ignore migration warnings on in-memory db
  }

  await target.query(`
    CREATE TABLE IF NOT EXISTS wingo_results (
      issue_number VARCHAR(100) PRIMARY KEY,
      number INTEGER NOT NULL,
      size VARCHAR(20) NOT NULL,
      colors TEXT NOT NULL,
      premium VARCHAR(50),
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await target.query(`
    CREATE TABLE IF NOT EXISTS delivery_logs (
      id SERIAL PRIMARY KEY,
      type VARCHAR(50) NOT NULL,
      destination VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      status VARCHAR(20) NOT NULL,
      error TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await target.query(`
    CREATE TABLE IF NOT EXISTS session_reminders (
      id SERIAL PRIMARY KEY,
      session_config_id INTEGER,
      session_name VARCHAR(100) NOT NULL,
      schedule_date VARCHAR(20) NOT NULL,
      session_time VARCHAR(10) NOT NULL,
      reminder_time VARCHAR(10) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
      destination VARCHAR(255),
      message TEXT,
      error TEXT,
      sent_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await target.query(`
    CREATE TABLE IF NOT EXISTS message_templates (
      key VARCHAR(50) PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      template TEXT NOT NULL,
      enabled BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  try {
    await target.query(`ALTER TABLE bot_sessions ADD COLUMN IF NOT EXISTS date VARCHAR(20)`);
    await target.query(`ALTER TABLE bot_sessions ADD COLUMN IF NOT EXISTS end_time VARCHAR(10)`);
    await target.query(`ALTER TABLE bot_sessions ADD COLUMN IF NOT EXISTS target_message_sent_at TIMESTAMPTZ`);
    await target.query(`ALTER TABLE bot_sessions ADD COLUMN IF NOT EXISTS history_message_sent_at TIMESTAMPTZ`);
    await target.query(`ALTER TABLE session_configs ADD COLUMN IF NOT EXISTS end_time VARCHAR(10)`);
    await target.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_sessions_config_date ON bot_sessions(session_config_id, schedule_date);`);
    await target.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_session_reminders_unique ON session_reminders(session_config_id, schedule_date, session_time);`);
    await target.query(`CREATE INDEX IF NOT EXISTS idx_session_reminders_created ON session_reminders(created_at DESC);`);
  } catch {
    // Already exists or unsupported
  }

  // Seed default templates
  const defaultTemplates = [
    {
      key: 'SIGNAL',
      name: 'Signal Message',
      template: `🎯 WinGo 1M Signal
━━━━━━━━━━━━━━━━
📊 Period: {issueNumber}
🎲 Prediction: {prediction}
🎨 Color: {color}
📈 Confidence: {confidence}%
⏱️ Time: {time}
━━━━━━━━━━━━━━━━
⚠️ Play responsibly`,
    },
    {
      key: 'WIN',
      name: 'WIN Result Message',
      template: `✅ WIN!
Period: {issueNumber}
Result: {resultNumber} ({resultSize}, {resultColor})
Our Signal: {predictionSize} {predictionColor} ✅`,
    },
    {
      key: 'LOSS',
      name: 'LOSS Result Message',
      template: `❌ LOSS
Period: {issueNumber}
Result: {resultNumber} ({resultSize}, {resultColor})
Our Signal: {predictionSize} {predictionColor} ❌`,
    },
    {
      key: 'TEST',
      name: 'Test Message',
      template: `🧪 TEST MESSAGE
━━━━━━━━━━━━━━━━
📊 Period: {issueNumber}
🎲 Prediction: {prediction}
🎨 Color: {color}
📈 Confidence: {confidence}%
⏱️ Time: {time}
━━━━━━━━━━━━━━━━`,
    },
    {
      key: 'TARGET_COMPLETE',
      name: 'Session Target Completed',
      template: `🎯 SESSION TARGET COMPLETED
━━━━━━━━━━━━━━━━
🏆 Target: {targetWins} WIN
✅ Wins: {wins}
❌ Losses: {losses}
📊 Total Signals: {totalSignals}
📈 Win Rate: {winRate}%
⏰ Session: {sessionName}
🕐 Started: {startTime}
🕐 Completed: {endTime}
━━━━━━━━━━━━━━━━
🎉 Today's session target has been completed successfully.`,
    },
    {
      key: 'SESSION_HISTORY',
      name: 'Session History Summary',
      template: `📋 SESSION HISTORY
━━━━━━━━━━━━━━━━
⏰ Session: {sessionName}
🕐 Time: {startTime} → {endTime}

Total Predictions: {totalSignals}

✅ WIN: {wins}
❌ LOSS: {losses}

📈 Win Rate: {winRate}%

━━━━━━━━━━━━━━━━
🏆 Target: {targetWins} WIN
🎯 Status: {status}
━━━━━━━━━━━━━━━━

{signalsList}`,
    },
    {
      key: 'REMINDER',
      name: 'Pre-Session Reminder',
      template: `🔔 SESSION STARTING SOON
━━━━━━━━━━━━━━━━
💰 PREPARE YOUR FUNDS

Your next WinGo session will start in {minutes_remaining} minutes.

⏰ Session: {session_time}
🎯 Target: {target} WIN

🌐 Website:
{website_link}

Please prepare your funds and be ready.

━━━━━━━━━━━━━━━━
⚠️ Play responsibly.`,
    },
  ];

  for (const t of defaultTemplates) {
    await target.query(
      `INSERT INTO message_templates (key, name, template, enabled)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (key) DO NOTHING;`,
      [t.key, t.name, t.template]
    );
  }

  // Seed default connection state row
  await target.query(`
    INSERT INTO whatsapp_connection (id, status)
    VALUES ('primary', 'disconnected')
    ON CONFLICT (id) DO NOTHING;
  `);

  // Seed Admin user
  const adminRes = await target.query('SELECT id FROM users WHERE username = $1', [
    config.ADMIN_USERNAME,
  ]);
  if (adminRes.rowCount === 0) {
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(config.ADMIN_PASSWORD, salt);
    await target.query(
      'INSERT INTO users (username, password_hash) VALUES ($1, $2)',
      [config.ADMIN_USERNAME, hash]
    );
    logger.info({ username: config.ADMIN_USERNAME }, 'Default admin account created');
  }

  // Seed Default Settings
  const settingsToSeed = [
    { key: 'newsletter_jid', value: config.DEFAULT_NEWSLETTER_JID || '' },
    { key: 'confidence_threshold', value: config.DEFAULT_CONFIDENCE_THRESHOLD.toString() },
    { key: 'polling_interval', value: config.DEFAULT_POLLING_INTERVAL.toString() },
    { key: 'wingo_api_url', value: 'https://draw.ar-lottery01.com/WinGo/WinGo_1M/GetHistoryIssuePage.json' },
    { key: 'wingo_source_mode', value: 'auto' },
    { key: 'bot_timezone', value: 'Asia/Karachi' },
    { key: 'bot_mode', value: 'STOPPED' },
    { key: 'session_scheduler_enabled', value: 'false' },
    { key: 'active_session_id', value: '' },
    { key: 'schedule_enabled', value: 'false' },
    { key: 'signal_delay_min', value: '15' },
    { key: 'signal_delay_max', value: '15' },
    { key: 'missed_session_policy', value: 'START_IF_WITHIN_WINDOW' },
    { key: 'missed_session_grace_minutes', value: '120' },
    { key: 'reminder_enabled', value: 'true' },
    { key: 'reminder_minutes_before', value: '30' },
    { key: 'reminder_website_url', value: 'https://example.com' },
  ];

  for (const s of settingsToSeed) {
    await target.query(
      `INSERT INTO settings (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO NOTHING;`,
      [s.key, s.value]
    );
  }

  // Update any existing settings or session configs with legacy 40s to 15s
  await target.query(
    `UPDATE settings SET value = '15', updated_at = NOW() WHERE key IN ('signal_delay_min', 'signal_delay_max') AND value = '40';`
  );
  await target.query(
    `UPDATE session_configs SET signal_delay_min = 15, signal_delay_max = 15 WHERE signal_delay_max = 40;`
  );

  // Seed Default Daily Session Configurations (Runs indefinitely until target WIN is reached)
  const defaultSessions = [
    { name: 'Morning', startTime: '06:00', targetWins: 10, minConf: 65, delayMin: 15, delayMax: 15 },
    { name: 'Afternoon', startTime: '14:00', targetWins: 10, minConf: 65, delayMin: 15, delayMax: 15 },
    { name: 'Night', startTime: '20:00', targetWins: 10, minConf: 65, delayMin: 15, delayMax: 15 },
  ];

  const existingConfigsRes = await target.query('SELECT COUNT(*) as cnt FROM session_configs');
  const count = parseInt(existingConfigsRes.rows[0]?.cnt || '0', 10);
  if (count === 0) {
    for (const sess of defaultSessions) {
      await target.query(
        `INSERT INTO session_configs (session_name, start_time, enabled, target_wins, min_confidence, signal_delay_min, signal_delay_max)
         VALUES ($1, $2, TRUE, $3, $4, $5, $6);`,
        [sess.name, sess.startTime, sess.targetWins, sess.minConf, sess.delayMin, sess.delayMax]
      );
    }
    logger.info('Default session schedules (Morning 06:00, Afternoon 14:00, Night 20:00) initialized.');
  }

  // Restore any persisted data from disk if running on local engine
  if (target && !target.isRealPostgres) {
    await restoreLocalDatabase(target);
    await flushLocalDatabase(target);
  }

  logger.info('Database schema and default records initialized.');
}

/**
 * Get current database status and masked URL for UI display
 */
export function getDatabaseInfo() {
  const currentUrl = process.env.DATABASE_URL || config.DATABASE_URL || '';
  const isReal = dbAdapter ? dbAdapter.isRealPostgres : false;
  let masked = '';

  if (currentUrl) {
    try {
      const u = new URL(currentUrl);
      if (u.password) {
        u.password = '••••••••';
      }
      masked = u.toString();
    } catch {
      masked = currentUrl.replace(/:(.*?)@/, ':••••••••@');
    }
  }

  return {
    isRealPostgres: isReal,
    type: isReal ? 'PostgreSQL (External)' : 'Oracle Native Persistent (Local Storage)',
    connected: true,
    hasUrlConfigured: !!currentUrl,
    maskedUrl: masked,
  };
}

/**
 * Dynamically connect and switch database at runtime from the Admin UI
 */
export async function switchDatabaseConnection(
  newUrl: string,
  useSsl: boolean = true
): Promise<{ success: boolean; message: string; isRealPostgres: boolean }> {
  const trimmed = newUrl.trim();
  if (!trimmed.startsWith('postgres://') && !trimmed.startsWith('postgresql://')) {
    return {
      success: false,
      message: 'Invalid database URL. Must start with postgres:// or postgresql://',
      isRealPostgres: dbAdapter?.isRealPostgres || false,
    };
  }

  try {
    logger.info({ useSsl }, 'Testing new PostgreSQL connection from UI...');
    let testPool: any;
    try {
      testPool = new Pool({
        connectionString: trimmed,
        ssl: useSsl ? { rejectUnauthorized: false } : undefined,
        max: 5,
        connectionTimeoutMillis: 8000,
      });
      await testPool.query('SELECT 1');
    } catch (sslErr: any) {
      if (
        useSsl &&
        (sslErr.message?.includes('SSL') ||
          sslErr.message?.includes('ssl') ||
          sslErr.message?.includes('The server does not support SSL'))
      ) {
        logger.info('SSL rejected by server, retrying without SSL...');
        testPool = new Pool({
          connectionString: trimmed,
          ssl: undefined,
          max: 5,
          connectionTimeoutMillis: 8000,
        });
        await testPool.query('SELECT 1');
      } else {
        throw sslErr;
      }
    }

    const newAdapter: DatabaseAdapter = {
      query: async <T = any>(text: string, params?: any[]) => {
        const res = await testPool.query(text, params);
        return {
          rows: res.rows as T[],
          rowCount: res.rowCount ?? (res.rows ? res.rows.length : 0),
        };
      },
      close: async () => {
        await testPool.end();
      },
      isRealPostgres: true,
    };

    // Run schema migrations on the new database
    await initSchemaAndSeed(newAdapter);

    // Close previous adapter if existed
    if (dbAdapter && dbAdapter.close) {
      try {
        await dbAdapter.close();
      } catch {
        // Ignore close errors
      }
    }

    dbAdapter = newAdapter;
    process.env.DATABASE_URL = trimmed;
    process.env.DATABASE_SSL = useSsl ? 'true' : 'false';

    // Persist to .env
    const { updateEnvVariables } = await import('../services/envService.js');
    updateEnvVariables({
      DATABASE_URL: trimmed,
      DATABASE_SSL: useSsl ? 'true' : 'false',
    });

    logger.info('Successfully switched database connection to new PostgreSQL database!');
    return {
      success: true,
      message: 'Successfully connected to PostgreSQL! Schema initialized and database is active.',
      isRealPostgres: true,
    };
  } catch (err: any) {
    logger.error({ err: err.message }, 'Failed to connect to new PostgreSQL database');
    return {
      success: false,
      message: `Connection failed: ${err.message}`,
      isRealPostgres: dbAdapter?.isRealPostgres || false,
    };
  }
}

