export interface User {
  id: number;
  username: string;
}

export type BotMode = 'STOPPED' | 'NORMAL' | 'SESSION';

export interface BotStatus {
  mode?: BotMode;
  running: boolean;
  predictionEngineStatus?: 'RUNNING' | 'IDLE' | 'PAUSED' | 'STOPPED';
  lastCycleAt: string | null;
  lastIssue: string | null;
  nextCheckAt: string | null;
  currentPeriod?: {
    periodNumber: string;
    state: string;
    elapsedSeconds: number;
    targetSeconds: number;
    signalSent: boolean;
    signalResult: string | null;
  } | null;
  latestSignal: Signal | null;
  lastError: string | null;
  pollingIntervalSeconds: number;
  confidenceThreshold: number;
}

export type WhatsAppConnectionState =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'not_paired'
  | 'logged_out'
  | 'pairing'
  | 'error';

export interface WhatsAppStatus {
  status: WhatsAppConnectionState;
  phoneNumber: string | null;
  pairingCode: string | null;
  pairingExpiresAt: string | null;
  qrCode?: string | null;
  lastConnectedAt: string | null;
  lastError: string | null;
  reconnectAttempts: number;
  isRegistered: boolean;
  destinationConfigured?: boolean;
  destination?: string | null;
  isReady?: boolean;
}

export interface Signal {
  id?: number;
  issue_number: string;
  prediction: 'BIG' | 'SMALL';
  predicted_color: 'RED' | 'GREEN';
  confidence: number;
  status: 'SCHEDULED' | 'PENDING' | 'WIN' | 'LOSS' | 'CANCELLED';
  actual_number?: number | null;
  actual_size?: 'BIG' | 'SMALL' | null;
  actual_color?: string | null;
  sent_to: string;
  sent_at?: string | null;
  scheduled_at?: string | null;
  settled_at?: string | null;
  session_id?: number | null;
}

export interface Statistics {
  totalSignals: number;
  settled: number;
  wins: number;
  losses: number;
  pending: number;
  winRate: number;
  recentSettled: Array<{ status: 'WIN' | 'LOSS'; issue_number: string }>;
  predictionsDistribution: {
    big: number;
    small: number;
  };
  deliveryStats: {
    success: number;
    failed: number;
  };
}

export interface AppSettings {
  newsletterJid: string;
  confidenceThreshold: number;
  pollingInterval: number;
  activeDestination: string | null;
  wingoApiUrl?: string;
  botTimezone?: string;
  scheduleEnabled?: boolean;
  signalDelayMin?: number;
  signalDelayMax?: number;
  missedSessionPolicy?: string;
  missedSessionGraceMinutes?: number;
}

export interface SessionConfig {
  id: number;
  session_name: string;
  start_time: string; // HH:mm
  end_time?: string | null;
  target_wins: number;
  min_confidence: number;
  signal_delay_min?: number;
  signal_delay_max?: number;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface BotSession {
  id: number;
  session_config_id: number | null;
  session_name: string;
  target_wins: number;
  status: 'SCHEDULED' | 'RUNNING' | 'TARGET_COMPLETED' | 'STOPPED' | 'CANCELLED' | string;
  total_signals: number;
  wins: number;
  losses: number;
  win_rate: number;
  start_time?: string;
  end_time?: string | null;
  started_at: string | null;
  completed_at: string | null;
  completion_message_sent?: boolean;
  target_message_sent_at?: string | null;
  history_message_sent_at?: string | null;
  schedule_date?: string;
  date?: string;
}

export interface SchedulerStatus {
  timezone?: string;
  currentTime?: string;
  currentDate?: string;
  botMode?: BotMode;
  scheduleEnabled?: boolean;
  predictionEngineStatus?: 'RUNNING' | 'IDLE' | 'PAUSED' | 'STOPPED';
  predictionEngineReason?: string;
  sessionStateDisplay?: string;
  currentSession?: BotSession | null;
  activeSession: BotSession | null;
  remainingWins: number | null;
  todaySessionsCount?: number;
  todayTargetWinsCompleted?: number;
  currentTimezone?: string;
  currentTimeLocal?: string;
  whatsAppReady?: boolean;
  whatsAppStatus?: WhatsAppConnectionState;
  nextSession: {
    configId?: number;
    name: string;
    startTime: string;
    startTimeFormatted?: string;
    endTime?: string | null;
    startDate?: string;
    startsInSeconds: number;
    startsInFormatted?: string;
    targetWins?: number;
  } | null;
  configs: SessionConfig[];
  todaySessions?: BotSession[];
}

export interface WinGoStatus {
  source: 'api' | 'live_simulation';
  apiUrl: string;
  isOnline: boolean;
  currentPeriod: string;
  lastFetchAt: string | null;
  lastError: string | null;
  totalCached: number;
}

export interface DispatchResult {
  success: boolean;
  signal: Signal;
  destination: string;
  deliveredToWhatsApp: boolean;
  message: string;
  error?: string;
}

export interface MessageTemplate {
  key: 'SIGNAL' | 'WIN' | 'LOSS' | 'TEST' | string;
  name: string;
  template: string;
  enabled: boolean;
  updated_at?: string;
}

export interface TemplatePreviewResult {
  rendered: string;
  variablesUsed: Record<string, any>;
}

export interface ReminderSettings {
  enabled: boolean;
  minutesBefore: number;
  websiteUrl: string;
  template: string;
  destination: string | null;
  timezone: string;
}

export interface SessionReminderRecord {
  id: number;
  session_config_id: number | null;
  session_name: string;
  schedule_date: string;
  session_time: string;
  session_time_formatted: string;
  reminder_time: string;
  reminder_time_formatted: string;
  status: 'SENT' | 'FAILED' | 'MISSED' | 'SKIPPED' | string;
  destination: string | null;
  message: string | null;
  error: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

