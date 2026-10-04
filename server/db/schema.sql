-- WinGo WhatsApp Signal Bot Database Schema

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS whatsapp_auth (
  id VARCHAR(255) PRIMARY KEY,
  data JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS whatsapp_connection (
  id VARCHAR(50) PRIMARY KEY DEFAULT 'primary',
  status VARCHAR(50) NOT NULL DEFAULT 'disconnected',
  phone_number VARCHAR(50),
  pairing_code VARCHAR(20),
  pairing_expires_at TIMESTAMPTZ,
  last_error TEXT,
  connected_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS session_configs (
  id SERIAL PRIMARY KEY,
  session_name VARCHAR(100) NOT NULL,
  start_time VARCHAR(10) NOT NULL,
  target_wins INTEGER NOT NULL DEFAULT 10,
  min_confidence INTEGER NOT NULL DEFAULT 65,
  signal_delay_min INTEGER NOT NULL DEFAULT 15,
  signal_delay_max INTEGER NOT NULL DEFAULT 15,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bot_sessions (
  id SERIAL PRIMARY KEY,
  session_config_id INTEGER REFERENCES session_configs(id) ON DELETE SET NULL,
  session_name VARCHAR(100) NOT NULL,
  schedule_date VARCHAR(20) NOT NULL,
  start_time VARCHAR(10) NOT NULL,
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

CREATE TABLE IF NOT EXISTS message_templates (
  key VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  template TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS signals (
  id SERIAL PRIMARY KEY,
  issue_number VARCHAR(100) UNIQUE NOT NULL,
  prediction VARCHAR(20) NOT NULL,
  predicted_color VARCHAR(50) NOT NULL,
  confidence INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'SCHEDULED',
  scheduled_at TIMESTAMPTZ,
  actual_number INTEGER,
  actual_size VARCHAR(20),
  actual_color VARCHAR(50),
  sent_to VARCHAR(255) NOT NULL,
  session_id INTEGER,
  sent_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS wingo_results (
  issue_number VARCHAR(100) PRIMARY KEY,
  number INTEGER NOT NULL,
  size VARCHAR(20) NOT NULL,
  colors TEXT NOT NULL,
  premium VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS delivery_logs (
  id SERIAL PRIMARY KEY,
  type VARCHAR(50) NOT NULL,
  destination VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(20) NOT NULL,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS session_reminders (
  id SERIAL PRIMARY KEY,
  session_config_id INTEGER REFERENCES session_configs(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_signals_issue_number ON signals(issue_number);
CREATE INDEX IF NOT EXISTS idx_signals_status ON signals(status);
CREATE INDEX IF NOT EXISTS idx_signals_session_id ON signals(session_id);
CREATE INDEX IF NOT EXISTS idx_bot_sessions_date_status ON bot_sessions(schedule_date, status);
CREATE INDEX IF NOT EXISTS idx_bot_sessions_config ON bot_sessions(session_config_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bot_sessions_config_date ON bot_sessions(session_config_id, schedule_date);
CREATE INDEX IF NOT EXISTS idx_wingo_results_issue ON wingo_results(issue_number);
CREATE INDEX IF NOT EXISTS idx_delivery_logs_created ON delivery_logs(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_reminders_unique ON session_reminders(session_config_id, schedule_date, session_time);
CREATE INDEX IF NOT EXISTS idx_session_reminders_created ON session_reminders(created_at DESC);
