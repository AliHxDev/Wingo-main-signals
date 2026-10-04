import React, { useState, useEffect } from 'react';
import {
  Clock,
  TrendingUp,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  ShieldCheck,
  Send,
  Zap,
  Activity,
  Loader2,
  RefreshCw,
  Calendar,
  Trophy,
  Timer,
  ChevronRight,
} from 'lucide-react';
import { api } from '../services/api.js';
import type { BotStatus, WhatsAppStatus, Signal, Statistics, WinGoStatus, SchedulerStatus } from '../types/index.js';

interface DashboardPageProps {
  botStatus: BotStatus | null;
  whatsAppStatus: WhatsAppStatus | null;
  activeDestination: string | null;
  signals?: Signal[];
  statistics: Statistics | null;
  onNavigateToWhatsApp: () => void;
  onNavigateToSettings: () => void;
  onNavigateToSessions?: () => void;
  onRefreshAll?: () => void;
  onNotification?: (msg: string, isError?: boolean) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  botStatus,
  whatsAppStatus,
  activeDestination,
  signals = [],
  statistics,
  onNavigateToWhatsApp,
  onNavigateToSettings,
  onNavigateToSessions,
  onRefreshAll,
  onNotification,
}) => {
  // WinGo 1M live seconds countdown (Draws every minute at :00)
  const [countdown, setCountdown] = useState(60);
  const [dispatchLoading, setDispatchLoading] = useState(false);
  const [modeActionLoading, setModeActionLoading] = useState(false);
  const [wingoStatus, setWingoStatus] = useState<WinGoStatus | null>(null);
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);

  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date();
      const seconds = now.getSeconds();
      setCountdown(60 - seconds);
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);
    return () => clearInterval(interval);
  }, []);

  // Fetch WinGo status & Session scheduler status
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const [s, sess] = await Promise.allSettled([
          api.getWingoStatus(),
          api.getSessionStatus(),
        ]);
        if (s.status === 'fulfilled') setWingoStatus(s.value);
        if (sess.status === 'fulfilled') setSchedulerStatus(sess.value);
      } catch {
        // Silent fail
      }
    };
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleStartBot = async () => {
    try {
      setModeActionLoading(true);
      await api.startBot();
      if (onNotification) onNotification('Switched to NORMAL BOT MODE');
      if (onRefreshAll) onRefreshAll();
      const sess = await api.getSessionStatus();
      setSchedulerStatus(sess);
    } catch (err: any) {
      if (onNotification) onNotification(err.message || 'Failed to start bot', true);
    } finally {
      setModeActionLoading(false);
    }
  };

  const handleStopBot = async () => {
    try {
      setModeActionLoading(true);
      await api.stopBot();
      if (onNotification) onNotification('NORMAL BOT MODE stopped');
      if (onRefreshAll) onRefreshAll();
      const sess = await api.getSessionStatus();
      setSchedulerStatus(sess);
    } catch (err: any) {
      if (onNotification) onNotification(err.message || 'Failed to stop bot', true);
    } finally {
      setModeActionLoading(false);
    }
  };

  const handleStartSessions = async () => {
    try {
      setModeActionLoading(true);
      const res = await api.startSessions();
      setSchedulerStatus(res.status);
      if (onNotification) onNotification('Switched to SESSION MODE');
      if (onRefreshAll) onRefreshAll();
    } catch (err: any) {
      if (onNotification) onNotification(err.message || 'Failed to start sessions', true);
    } finally {
      setModeActionLoading(false);
    }
  };

  const handleStopSessions = async () => {
    try {
      setModeActionLoading(true);
      const res = await api.stopSessions();
      setSchedulerStatus(res.status);
      if (onNotification) onNotification('SESSION MODE stopped');
      if (onRefreshAll) onRefreshAll();
    } catch (err: any) {
      if (onNotification) onNotification(err.message || 'Failed to stop sessions', true);
    } finally {
      setModeActionLoading(false);
    }
  };

  const handleDispatchNow = async () => {
    setDispatchLoading(true);
    try {
      const res = await api.dispatchSignalNow();
      if (onNotification) {
        onNotification(res.message, !res.deliveredToWhatsApp && !!res.error);
      }
      if (onRefreshAll) onRefreshAll();
    } catch (err: any) {
      if (onNotification) {
        onNotification(err.message || 'Failed to dispatch signal', true);
      }
    } finally {
      setDispatchLoading(false);
    }
  };

  const safeSignals = Array.isArray(signals) ? signals : [];
  const latestSignal = safeSignals[0] || null;
  const waState = whatsAppStatus?.status || 'not_paired';
  const isWaConnected = waState === 'connected';
  const isWaConnecting = waState === 'connecting';
  const isWaPairing = waState === 'pairing';
  const isWaNotPaired = waState === 'not_paired';
  const isWaLoggedOut = waState === 'logged_out';

  // Authoritative Mode State (Requirement 14)
  const currentMode: 'NORMAL' | 'SESSION' | 'STOPPED' =
    botStatus?.mode || schedulerStatus?.botMode || (botStatus?.running ? 'NORMAL' : 'STOPPED');
  const isNormalMode = currentMode === 'NORMAL';
  const isSessionMode = currentMode === 'SESSION';
  const isStoppedMode = currentMode === 'STOPPED';
  const isBotRunning = isNormalMode && (botStatus?.running ?? false);

  const isScheduleEnabled = isSessionMode;
  const isWaitingForWhatsApp =
    isSessionMode &&
    !isWaConnected &&
    (schedulerStatus?.sessionStateDisplay === 'WAITING FOR WHATSAPP' ||
      schedulerStatus?.sessionStateDisplay?.includes('Waiting for WhatsApp') ||
      schedulerStatus?.predictionEngineReason?.includes('Waiting for WhatsApp'));
  const isSessionPausedByWa =
    isSessionMode &&
    schedulerStatus?.activeSession &&
    !isWaConnected;

  return (
    <div className="space-y-6">
      {/* Operating System Mode & Mode Controls Banner (Requirement 14 & 15) */}
      <div className="p-5 sm:p-6 rounded-3xl bg-gradient-to-r from-neutral-900 via-neutral-900 to-neutral-950 border border-neutral-800 shadow-xl relative overflow-hidden">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">
          <div className="space-y-3.5 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                Operating System Mode
              </span>
              <span className="text-xs text-neutral-500">•</span>
              <span className="text-xs text-neutral-400 font-mono">
                Persistent System State
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              {/* 1. Mode Status */}
              <div className="p-3.5 rounded-2xl bg-neutral-950/80 border border-neutral-800">
                <span className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold block mb-1">
                  Mode
                </span>
                <div className="text-base font-black flex items-center gap-2">
                  {isNormalMode ? (
                    <span className="text-emerald-400 flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                      🟢 NORMAL BOT
                    </span>
                  ) : isSessionMode ? (
                    <span className="text-purple-400 flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-purple-400 animate-pulse" />
                      🟣 SESSION MODE
                    </span>
                  ) : (
                    <span className="text-neutral-400 flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-neutral-500" />
                      ⚪ STOPPED
                    </span>
                  )}
                </div>
              </div>

              {/* 2. Sessions Status */}
              <div className="p-3.5 rounded-2xl bg-neutral-950/80 border border-neutral-800">
                <span className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold block mb-1">
                  Sessions
                </span>
                <div className="text-base font-black flex items-center gap-2">
                  {isSessionMode ? (
                    <span className="text-emerald-400 flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                      🟢 ACTIVE
                    </span>
                  ) : (
                    <span className="text-neutral-400 flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-neutral-600" />
                      ⚪ INACTIVE
                    </span>
                  )}
                </div>
              </div>

              {/* 3. Prediction Engine */}
              <div className="p-3.5 rounded-2xl bg-neutral-950/80 border border-neutral-800">
                <span className="text-[11px] uppercase tracking-wider text-neutral-400 font-semibold block mb-1">
                  Prediction Engine
                </span>
                <div className="text-base font-black flex items-center gap-2">
                  {!isWaConnected && (isNormalMode || (isSessionMode && schedulerStatus?.activeSession)) ? (
                    <span className="text-amber-400 flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse" />
                      🟠 PAUSED (WA)
                    </span>
                  ) : isNormalMode && isBotRunning ? (
                    <span className="text-emerald-400 flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                      🟢 RUNNING
                    </span>
                  ) : isSessionMode && schedulerStatus?.activeSession ? (
                    <span className="text-emerald-400 flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                      🟢 RUNNING
                    </span>
                  ) : isSessionMode ? (
                    <span className="text-teal-400 flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-teal-400" />
                      ⏳ IDLE (Schedule)
                    </span>
                  ) : (
                    <span className="text-neutral-400 flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-neutral-600" />
                      ⚪ STOPPED
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons: Distinct Controls for Normal Bot and Session Mode (Requirement 15) */}
          <div className="shrink-0 flex flex-col sm:flex-row lg:flex-col gap-2.5 w-full sm:w-auto">
            {/* Normal Bot Button */}
            {isNormalMode ? (
              <button
                id="dashboard-stop-bot-btn"
                onClick={handleStopBot}
                disabled={modeActionLoading}
                className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 active:scale-95 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>⏹️ STOP BOT</span>
              </button>
            ) : (
              <button
                id="dashboard-start-bot-btn"
                onClick={handleStartBot}
                disabled={modeActionLoading}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md shadow-emerald-950/40 flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>▶️ START BOT</span>
              </button>
            )}

            {/* Session Controls Button */}
            {isSessionMode ? (
              <button
                id="dashboard-stop-sessions-btn"
                onClick={handleStopSessions}
                disabled={modeActionLoading}
                className="px-5 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 active:scale-95 text-white font-bold text-xs uppercase tracking-wider transition-all border border-neutral-700 shadow-md flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>⏹️ STOP SESSIONS</span>
              </button>
            ) : (
              <button
                id="dashboard-start-sessions-btn"
                onClick={handleStartSessions}
                disabled={modeActionLoading}
                className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 active:scale-95 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md shadow-purple-950/40 flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>▶️ START SESSIONS</span>
              </button>
            )}
          </div>
        </div>
      </div>
      {/* Engine & WhatsApp Status Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 bg-neutral-900 border border-neutral-800 rounded-2xl">
        <div className="flex items-center gap-3 flex-wrap">
          {/* WinGo Feed Indicator */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-neutral-950 border border-neutral-800 text-xs font-mono">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-neutral-400">WinGo 1M:</span>
            <span className="font-semibold text-emerald-400">
              {wingoStatus?.source === 'api' ? 'Live API Feed' : 'Resilient Generator'}
            </span>
          </div>

          {/* WhatsApp Broadcast Indicator - Real Backend State */}
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-neutral-950 border border-neutral-800 text-xs font-mono">
            <span
              className={`w-2 h-2 rounded-full ${
                isWaConnected
                  ? 'bg-emerald-400 animate-pulse'
                  : isWaConnecting || isWaPairing
                  ? 'bg-amber-400 animate-pulse'
                  : isWaNotPaired
                  ? 'bg-neutral-400'
                  : 'bg-rose-500'
              }`}
            />
            <span className="text-neutral-400">WhatsApp:</span>
            <span
              className={`font-semibold ${
                isWaConnected
                  ? 'text-emerald-400'
                  : isWaConnecting || isWaPairing
                  ? 'text-amber-400'
                  : isWaNotPaired
                  ? 'text-neutral-300'
                  : 'text-rose-400'
              }`}
            >
              {isWaConnected
                ? '🟢 CONNECTED'
                : isWaConnecting
                ? '🟠 CONNECTING'
                : isWaPairing
                ? '🟡 PAIRING'
                : isWaNotPaired
                ? '⚪ NOT PAIRED'
                : isWaLoggedOut
                ? '🔴 LOGGED OUT'
                : '🔴 DISCONNECTED'}
            </span>
          </div>

          {/* Active Channel Destination */}
          {activeDestination && (
            <div className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-neutral-950 border border-neutral-800 text-xs font-mono text-neutral-300">
              <Send className="w-3 h-3 text-emerald-400" />
              <span className="truncate max-w-[200px]">{activeDestination}</span>
            </div>
          )}
        </div>

        {/* Manual Instant Dispatch Action */}
        <button
          id="instant-dispatch-btn"
          onClick={handleDispatchNow}
          disabled={dispatchLoading}
          className="inline-flex items-center gap-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-950/40 disabled:opacity-50"
          title="Predict and broadcast current round immediately"
        >
          {dispatchLoading ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Zap className="w-3.5 h-3.5 text-amber-300" />
          )}
          <span>⚡ Dispatch Signal Now</span>
        </button>
      </div>

      {/* Daily Session Banner / Next Scheduled Session Bar */}
      {schedulerStatus && (
        <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-neutral-900 via-neutral-900 to-neutral-950 border border-neutral-800 shadow-lg flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3.5">
            <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 border ${
              schedulerStatus.activeSession
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : schedulerStatus.scheduleEnabled
                ? 'bg-teal-500/10 border-teal-500/30 text-teal-400'
                : 'bg-neutral-800 border-neutral-700 text-neutral-400'
            }`}>
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold uppercase tracking-wider text-neutral-400">
                  Daily Sessions Schedule
                </span>
                <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-md border ${
                  schedulerStatus.scheduleEnabled
                    ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                    : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                }`}>
                  {schedulerStatus.scheduleEnabled ? 'Schedule: Enabled' : 'Schedule: Paused'}
                </span>
                {schedulerStatus.activeSession ? (
                  <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-md bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 animate-pulse">
                    Live Session Active
                  </span>
                ) : (
                  <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-md bg-neutral-800 text-neutral-400">
                    Engine {schedulerStatus.predictionEngineStatus || 'IDLE'}
                  </span>
                )}
              </div>

              {schedulerStatus.activeSession ? (
                <div className="text-sm text-neutral-200 mt-1 flex flex-wrap items-center gap-2">
                  <strong className="text-white text-base">{schedulerStatus.activeSession.session_name}:</strong>
                  <span className="text-emerald-400 font-bold">{schedulerStatus.activeSession.wins} WINs</span>
                  <span className="text-neutral-500">/</span>
                  <span className="text-neutral-300">{schedulerStatus.activeSession.target_wins} Target</span>
                  <span className="text-neutral-500">•</span>
                  <span className="text-xs text-amber-300 font-medium">
                    ({schedulerStatus.remainingWins} WINs needed to complete session)
                  </span>
                </div>
              ) : schedulerStatus.nextSession ? (
                <div className="text-sm text-neutral-300 mt-1 flex flex-wrap items-center gap-2">
                  <span>Next: <strong className="text-white">{schedulerStatus.nextSession.name}</strong> at <strong className="text-emerald-400">{schedulerStatus.nextSession.startTimeFormatted || schedulerStatus.nextSession.startTime}</strong></span>
                  <span className="text-xs text-neutral-400 font-mono">
                    ({schedulerStatus.nextSession.startsInFormatted || `in ~${Math.ceil(schedulerStatus.nextSession.startsInSeconds / 60)}m`})
                  </span>
                  <span className="text-xs text-teal-400 font-medium">
                    • Target: {schedulerStatus.nextSession.targetWins || 10} WIN
                  </span>
                </div>
              ) : (
                <div className="text-sm text-neutral-400 mt-1">
                  All today's scheduled sessions completed or no active schedule.
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5 self-end md:self-center flex-wrap">
            {schedulerStatus.scheduleEnabled ? (
              <button
                onClick={async () => {
                  try {
                    const res = await api.stopSchedule();
                    setSchedulerStatus(res.status);
                    if (onNotification) onNotification('Session schedule paused');
                  } catch (e: any) {
                    if (onNotification) onNotification(e.message, true);
                  }
                }}
                className="px-3.5 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-bold transition flex items-center gap-1.5 border border-neutral-700"
              >
                <span>⏹️ Stop Schedule</span>
              </button>
            ) : (
              <button
                onClick={async () => {
                  try {
                    const res = await api.startSchedule();
                    setSchedulerStatus(res.status);
                    if (onNotification) onNotification('Session schedule enabled');
                  } catch (e: any) {
                    if (onNotification) onNotification(e.message, true);
                  }
                }}
                className="px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-emerald-500/20"
              >
                <span>▶️ START SESSIONS</span>
              </button>
            )}

            {onNavigateToSessions && (
              <button
                onClick={onNavigateToSessions}
                className="px-3.5 py-1.5 rounded-xl bg-neutral-800/80 hover:bg-neutral-700 text-neutral-200 text-xs font-semibold transition flex items-center gap-1.5 border border-neutral-700/60"
              >
                <span>Manage Sessions</span>
                <ChevronRight className="w-3.5 h-3.5 text-emerald-400" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Requirement 5: Active Session Disconnected Warning */}
      {isSessionPausedByWa && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 animate-pulse" />
            <div>
              <div className="font-bold text-white flex items-center gap-2">
                <span>Session: PAUSED</span>
                <span>•</span>
                <span className="text-rose-400">WhatsApp: DISCONNECTED</span>
                <span>•</span>
                <span className="text-amber-400">Prediction Engine: PAUSED</span>
              </div>
              <p className="text-xs text-rose-300/80 mt-0.5">
                Session "{schedulerStatus?.activeSession?.session_name}" target ({schedulerStatus?.activeSession?.wins}/{schedulerStatus?.activeSession?.target_wins} WINs) is preserved safely. Signals will resume automatically upon WhatsApp reconnection.
              </p>
            </div>
          </div>
          <button
            onClick={onNavigateToWhatsApp}
            className="px-3.5 py-1.5 rounded-xl bg-rose-500 hover:bg-rose-400 text-neutral-950 text-xs font-bold transition shrink-0"
          >
            Reconnect WhatsApp →
          </button>
        </div>
      )}

      {/* Requirement 3: Waiting for WhatsApp connection at scheduled session start */}
      {isWaitingForWhatsApp && !isSessionPausedByWa && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <div>
              <div className="font-bold text-amber-200">
                🟠 Waiting for WhatsApp connection
              </div>
              <p className="text-xs text-amber-300/80 mt-0.5">
                Session start time has arrived and schedule is ENABLED, but WhatsApp is not connected. Session will start automatically as soon as WhatsApp connects.
              </p>
            </div>
          </div>
          <button
            onClick={onNavigateToWhatsApp}
            className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 text-xs font-bold transition shrink-0"
          >
            Pair / Connect WhatsApp →
          </button>
        </div>
      )}

      {/* Warning Notice if WhatsApp isn't linked */}
      {(!isWaConnected || !activeDestination) && !isSessionPausedByWa && !isWaitingForWhatsApp && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
            <span>
              {!isWaConnected
                ? 'WhatsApp is not connected. Signals are generated in this dashboard. To broadcast to your WhatsApp Channel, pair your phone number in WhatsApp Pairing.'
                : 'WhatsApp Newsletter channel is not configured. Set your channel identifier in Settings.'}
            </span>
          </div>
          <div className="shrink-0">
            {!isWaConnected ? (
              <button
                onClick={onNavigateToWhatsApp}
                className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-semibold transition-colors"
              >
                Go to WhatsApp Pairing →
              </button>
            ) : (
              <button
                onClick={onNavigateToSettings}
                className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-semibold transition-colors"
              >
                Configure Channel →
              </button>
            )}
          </div>
        </div>
      )}

      {/* Bot Notice / Last Error info */}
      {botStatus?.lastError && isBotRunning && (
        <div className="p-3.5 rounded-xl bg-neutral-900 border border-neutral-800 text-xs text-neutral-300 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>
              <strong>Bot Status:</strong> {botStatus.lastError}
            </span>
          </div>
        </div>
      )}

      {/* Main Grid: Live Period + Latest Signal */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Live Period & Draw Countdown */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between text-neutral-400 text-xs font-semibold uppercase tracking-wider mb-2">
              <span className="flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-emerald-400" />
                WinGo 1M Next Draw
              </span>
              <span className="text-emerald-400 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                Live
              </span>
            </div>

            <div className="flex items-baseline justify-between mt-3">
              <div>
                <span className="text-5xl font-black tracking-tight text-white font-mono">
                  {countdown < 10 ? `0${countdown}` : countdown}
                </span>
                <span className="text-sm font-medium text-neutral-500 ml-1.5">seconds</span>
              </div>
              <div className="text-right">
                <p className="text-xs text-neutral-400">Tracked WinGo Period</p>
                <p className="text-sm font-bold text-neutral-200 font-mono">
                  {botStatus?.currentPeriod?.periodNumber || botStatus?.lastIssue || 'Fetching...'}
                </p>
                {botStatus?.currentPeriod && (
                  <span className={`inline-block mt-1 px-2 py-0.5 text-[10px] font-bold rounded-md uppercase border ${
                    botStatus.currentPeriod.state === 'SIGNAL_SENT'
                      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
                      : botStatus.currentPeriod.state === 'WAITING_15_SECONDS' || botStatus.currentPeriod.state === 'WAITING_40_SECONDS'
                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                      : botStatus.currentPeriod.state === 'WAITING_RESULT'
                      ? 'bg-blue-500/15 text-blue-400 border-blue-500/30'
                      : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                  }`}>
                    {botStatus.currentPeriod.state === 'WAITING_15_SECONDS'
                      ? `⏱️ ${botStatus.currentPeriod.elapsedSeconds}s / 15s`
                      : botStatus.currentPeriod.state === 'WAITING_40_SECONDS'
                      ? `⏱️ ${botStatus.currentPeriod.elapsedSeconds}s / 40s`
                      : botStatus.currentPeriod.state}
                  </span>
                )}
              </div>
            </div>

            {/* Countdown Progress Bar */}
            <div className="w-full bg-neutral-800 rounded-full h-2 mt-4 overflow-hidden">
              <div
                className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full transition-all duration-1000 ease-linear rounded-full"
                style={{ width: `${(countdown / 60) * 100}%` }}
              />
            </div>
          </div>

          <div className="pt-4 mt-4 border-t border-neutral-800/80 flex items-center justify-between text-xs text-neutral-400">
            <span>Timing: Period-Based (15s mark)</span>
            <span>Loop: {isBotRunning ? 'Auto-Running' : 'Stopped'}</span>
          </div>
        </div>

        {/* Latest Signal Card */}
        <div className="lg:col-span-2 bg-gradient-to-br from-neutral-900 to-neutral-950 border border-neutral-800 rounded-2xl p-6 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Zap className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">Latest Signal</h3>
                  <p className="text-xs text-neutral-400">
                    Period #{latestSignal?.issue_number || '---'}
                  </p>
                </div>
              </div>

              {latestSignal && (
                <div
                  className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 ${
                    latestSignal.status === 'WIN'
                      ? 'bg-emerald-950/80 border border-emerald-800 text-emerald-400'
                      : latestSignal.status === 'LOSS'
                      ? 'bg-rose-950/80 border border-rose-800 text-rose-400'
                      : latestSignal.status === 'SCHEDULED'
                      ? 'bg-blue-950/80 border border-blue-800 text-blue-400'
                      : 'bg-amber-950/80 border border-amber-800 text-amber-400'
                  }`}
                >
                  {latestSignal.status === 'WIN' && <CheckCircle2 className="w-3.5 h-3.5" />}
                  {latestSignal.status === 'LOSS' && <XCircle className="w-3.5 h-3.5" />}
                  {latestSignal.status === 'SCHEDULED' && <Timer className="w-3.5 h-3.5 animate-spin" />}
                  <span>{latestSignal.status === 'SCHEDULED' ? 'SCHEDULED (15s DELAY)' : latestSignal.status}</span>
                </div>
              )}
            </div>

            {latestSignal ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-2">
                {/* Prediction */}
                <div className="bg-neutral-950/70 border border-neutral-800 rounded-xl p-3">
                  <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                    Prediction
                  </span>
                  <div className="flex items-center gap-2 mt-1">
                    {latestSignal.prediction === 'BIG' ? (
                      <ArrowUpRight className="w-5 h-5 text-emerald-400" />
                    ) : (
                      <ArrowDownRight className="w-5 h-5 text-amber-400" />
                    )}
                    <span className="text-xl font-bold text-white font-mono">
                      {latestSignal.prediction}
                    </span>
                  </div>
                </div>

                {/* Color */}
                <div className="bg-neutral-950/70 border border-neutral-800 rounded-xl p-3">
                  <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                    Color
                  </span>
                  <div className="flex items-center gap-2 mt-1">
                    <span
                      className={`w-3.5 h-3.5 rounded-full ${
                        latestSignal.predicted_color === 'RED'
                          ? 'bg-rose-500 shadow-md shadow-rose-500/50'
                          : 'bg-emerald-500 shadow-md shadow-emerald-500/50'
                      }`}
                    />
                    <span className="text-xl font-bold text-white font-mono">
                      {latestSignal.predicted_color}
                    </span>
                  </div>
                </div>

                {/* Confidence */}
                <div className="bg-neutral-950/70 border border-neutral-800 rounded-xl p-3">
                  <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                    Confidence
                  </span>
                  <p className="text-xl font-bold text-emerald-400 font-mono mt-1">
                    {latestSignal.confidence}%
                  </p>
                </div>

                {/* Actual Result */}
                <div className="bg-neutral-950/70 border border-neutral-800 rounded-xl p-3">
                  <span className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wider">
                    Result
                  </span>
                  <p className="text-xl font-bold text-neutral-200 font-mono mt-1">
                    {latestSignal.actual_number !== undefined && latestSignal.actual_number !== null
                      ? `${latestSignal.actual_number} (${latestSignal.actual_size})`
                      : 'Pending'}
                  </p>
                </div>
              </div>
            ) : (
              <div className="py-6 text-center text-neutral-500 text-sm">
                No signals dispatched yet. Start the bot to begin automatic analysis.
              </div>
            )}
          </div>

          <div className="pt-4 mt-4 border-t border-neutral-800/80 flex items-center justify-between text-xs text-neutral-400">
            <span className="flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5 text-neutral-500" />
              Channel: {activeDestination || 'None'}
            </span>
            <span>
              Sent at: {latestSignal?.sent_at ? new Date(latestSignal.sent_at).toLocaleTimeString() : '---'}
            </span>
          </div>
        </div>
      </div>

      {/* Statistics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Win Rate */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-lg">
          <div className="flex items-center justify-between text-neutral-400 text-xs font-semibold uppercase tracking-wider">
            <span>Win Rate</span>
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-3xl font-black text-white font-mono mt-2">
            {statistics?.winRate ?? 0}%
          </p>
          <p className="text-xs text-neutral-500 mt-1">
            {statistics?.wins ?? 0} wins out of {statistics?.settled ?? 0} settled
          </p>
        </div>

        {/* Wins */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-lg">
          <div className="flex items-center justify-between text-neutral-400 text-xs font-semibold uppercase tracking-wider">
            <span>Wins</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-3xl font-black text-emerald-400 font-mono mt-2">
            {statistics?.wins ?? 0}
          </p>
          <p className="text-xs text-neutral-500 mt-1">Successfully predicted</p>
        </div>

        {/* Losses */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-lg">
          <div className="flex items-center justify-between text-neutral-400 text-xs font-semibold uppercase tracking-wider">
            <span>Losses</span>
            <XCircle className="w-4 h-4 text-rose-400" />
          </div>
          <p className="text-3xl font-black text-rose-400 font-mono mt-2">
            {statistics?.losses ?? 0}
          </p>
          <p className="text-xs text-neutral-500 mt-1">Unmatched outcomes</p>
        </div>

        {/* Delivery Success */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-lg">
          <div className="flex items-center justify-between text-neutral-400 text-xs font-semibold uppercase tracking-wider">
            <span>Broadcasts</span>
            <ShieldCheck className="w-4 h-4 text-teal-400" />
          </div>
          <p className="text-3xl font-black text-teal-300 font-mono mt-2">
            {statistics?.deliveryStats?.success ?? 0}
          </p>
          <p className="text-xs text-neutral-500 mt-1">
            {statistics?.deliveryStats?.failed ?? 0} failed attempts
          </p>
        </div>
      </div>

      {/* Recent Signals Table */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-white tracking-tight">Recent Signals & Settlements</h3>
            <p className="text-xs text-neutral-400">Live feed of deterministic WinGo 1M predictions</p>
          </div>
          <span className="text-xs text-neutral-500">Auto-refreshed</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-neutral-800 text-xs uppercase tracking-wider text-neutral-400">
                <th className="py-3 px-3">Period</th>
                <th className="py-3 px-3">Prediction</th>
                <th className="py-3 px-3">Confidence</th>
                <th className="py-3 px-3">Actual Result</th>
                <th className="py-3 px-3">Status</th>
                <th className="py-3 px-3">Dispatched Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800/60 font-mono text-xs">
              {safeSignals.slice(0, 8).map((sig) => (
                <tr key={sig.id || sig.issue_number} className="hover:bg-neutral-800/30 transition-colors">
                  <td className="py-3 px-3 font-semibold text-white">{sig.issue_number}</td>
                  <td className="py-3 px-3">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md font-bold ${
                        sig.prediction === 'BIG'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-amber-500/10 text-amber-400'
                      }`}
                    >
                      {sig.prediction === 'BIG' ? '🔺 BIG' : '🔻 SMALL'}
                      <span className="text-[10px] text-neutral-400">({sig.predicted_color})</span>
                    </span>
                  </td>
                  <td className="py-3 px-3 text-neutral-300 font-semibold">{sig.confidence}%</td>
                  <td className="py-3 px-3">
                    {sig.actual_number !== undefined && sig.actual_number !== null ? (
                      <span className="text-neutral-200">
                        {sig.actual_number} ({sig.actual_size}, {sig.actual_color})
                      </span>
                    ) : (
                      <span className="text-neutral-500 italic">Waiting result...</span>
                    )}
                  </td>
                  <td className="py-3 px-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider ${
                        sig.status === 'WIN'
                          ? 'bg-emerald-950/80 border border-emerald-800 text-emerald-400'
                          : sig.status === 'LOSS'
                          ? 'bg-rose-950/80 border border-rose-800 text-rose-400'
                          : sig.status === 'SCHEDULED'
                          ? 'bg-blue-950/80 border border-blue-800 text-blue-400'
                          : sig.status === 'CANCELLED'
                          ? 'bg-neutral-800 border border-neutral-700 text-neutral-400'
                          : 'bg-amber-950/80 border border-amber-800 text-amber-400'
                      }`}
                    >
                      {sig.status === 'WIN' && <CheckCircle2 className="w-3 h-3" />}
                      {sig.status === 'LOSS' && <XCircle className="w-3 h-3" />}
                      {sig.status === 'SCHEDULED' && <Timer className="w-3 h-3 animate-spin" />}
                      {sig.status === 'SCHEDULED' ? 'SCHEDULED (DELAY)' : sig.status}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-neutral-400">
                    {sig.sent_at ? new Date(sig.sent_at).toLocaleTimeString() : '---'}
                  </td>
                </tr>
              ))}
              {safeSignals.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-neutral-500">
                    No signals processed yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mandatory Disclaimer */}
      <div className="p-4 rounded-xl bg-neutral-900/60 border border-neutral-800 text-center text-xs text-neutral-400">
        ⚠️ <span className="font-semibold text-neutral-300">Disclaimer:</span> Predictions are
        probabilistic. Play responsibly. Never risk funds you cannot afford to lose.
      </div>
    </div>
  );
};
