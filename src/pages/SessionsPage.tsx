import React, { useState, useEffect, useCallback } from 'react';
import {
  Clock,
  Play,
  Square,
  CheckCircle2,
  Calendar,
  Plus,
  Edit2,
  Trash2,
  RefreshCw,
  Send,
  Timer,
  Trophy,
  History,
  AlertTriangle,
  ChevronRight,
  Sliders,
  Check,
  X,
  Activity,
  Zap,
  Power,
  Info,
  Flame,
  Loader2,
  Bell,
} from 'lucide-react';
import { api } from '../services/api.js';
import type {
  SchedulerStatus,
  SessionConfig,
  BotSession,
  Signal,
  User,
} from '../types/index.js';

interface SessionsPageProps {
  currentUser: User | null;
  onOpenLogin: () => void;
  onNotification: (msg: string, isError?: boolean) => void;
}

export const SessionsPage: React.FC<SessionsPageProps> = ({
  currentUser,
  onOpenLogin,
  onNotification,
}) => {
  const [schedulerStatus, setSchedulerStatus] = useState<SchedulerStatus | null>(null);
  const [configs, setConfigs] = useState<SessionConfig[]>([]);
  const [history, setHistory] = useState<BotSession[]>([]);
  const [historyFilter, setHistoryFilter] = useState<'today' | 'yesterday' | 'last7' | 'last30' | 'all'>('today');
  const [isLoading, setIsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // Edit / Create Config Modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingConfig, setEditingConfig] = useState<SessionConfig | null>(null);
  const [deleteConfirmConfig, setDeleteConfirmConfig] = useState<SessionConfig | null>(null);
  const [formData, setFormData] = useState({
    session_name: '',
    start_time: '06:00',
    target_wins: 10,
    min_confidence: 65,
    enabled: true,
  });

  // Selected session for viewing details/signals
  const [selectedSession, setSelectedSession] = useState<BotSession | null>(null);
  const [sessionSignals, setSessionSignals] = useState<Signal[]>([]);
  const [signalsLoading, setSignalsLoading] = useState(false);

  // Next session countdown tick
  const [nextCountdownSeconds, setNextCountdownSeconds] = useState<number | null>(null);

  const format12h = (time24?: string | null): string => {
    if (!time24) return '';
    const parts = time24.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parseInt(parts[1] || '0', 10);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h12 = hours % 12 || 12;
    return `${h12.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  };

  const getReminderTimeFormatted = (time24?: string): string => {
    if (!time24) return '';
    const parts = time24.split(':');
    const h = parseInt(parts[0], 10);
    const m = parseInt(parts[1] || '0', 10);
    if (isNaN(h) || isNaN(m)) return '';
    let remM = m - 30;
    let remH = h;
    if (remM < 0) {
      remM += 60;
      remH = (remH - 1 + 24) % 24;
    }
    const rem24 = `${remH.toString().padStart(2, '0')}:${remM.toString().padStart(2, '0')}`;
    return format12h(rem24);
  };

  const loadData = useCallback(async (manual?: boolean | React.MouseEvent) => {
    const isManual = manual === true;
    try {
      if (isManual) setIsLoading(true);
      const [statusRes, configsRes, historyRes] = await Promise.all([
        api.getSessionStatus(),
        api.getSessionConfigs(),
        api.getSessionHistory({ range: historyFilter }),
      ]);
      setSchedulerStatus(statusRes);
      setConfigs(configsRes);
      setHistory(historyRes);
      if (statusRes?.nextSession?.startsInSeconds !== undefined && statusRes.nextSession.startsInSeconds !== null) {
        setNextCountdownSeconds(statusRes.nextSession.startsInSeconds);
      } else {
        setNextCountdownSeconds(null);
      }
      if (isManual) {
        onNotification('Session data refreshed');
      }
    } catch (err: any) {
      if (isManual) {
        onNotification(err.message || 'Failed to load session information', true);
      }
    } finally {
      if (isManual) setIsLoading(false);
    }
  }, [historyFilter, onNotification]);

  // Load configs & history on mount and when filter changes
  useEffect(() => {
    loadData(false);
  }, [loadData]);

  // Lightweight background polling: ONLY fetch dynamic session status every 5 seconds
  // Does not re-fetch static configs or history, and does not show intrusive error popups on polling glitches
  useEffect(() => {
    let mounted = true;
    const interval = setInterval(async () => {
      try {
        const statusRes = await api.getSessionStatus();
        if (!mounted) return;
        setSchedulerStatus(statusRes);
        if (statusRes?.nextSession?.startsInSeconds !== undefined && statusRes.nextSession.startsInSeconds !== null) {
          setNextCountdownSeconds(statusRes.nextSession.startsInSeconds);
        } else {
          setNextCountdownSeconds(null);
        }
      } catch {
        // Silently ignore background poll errors to prevent spamming notifications
      }
    }, 5000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Local seconds countdown decrement
  useEffect(() => {
    if (nextCountdownSeconds === null || nextCountdownSeconds <= 0) return;
    const t = setInterval(() => {
      setNextCountdownSeconds((prev) => (prev && prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(t);
  }, [nextCountdownSeconds]);

  const formatCountdown = (secs: number) => {
    if (secs <= 0) return 'Starting now...';
    const hours = Math.floor(secs / 3600);
    const mins = Math.floor((secs % 3600) / 60);
    const remSecs = secs % 60;
    if (hours > 0) {
      return `${hours}h ${mins.toString().padStart(2, '0')}m ${remSecs.toString().padStart(2, '0')}s`;
    }
    return `${mins.toString().padStart(2, '0')}m ${remSecs.toString().padStart(2, '0')}s`;
  };

  /**
   * Primary Button: START SESSIONS / STOP SESSIONS
   * Enables the automatic session schedule and activates the background scheduler.
   */
  const handleStartSchedule = async () => {
    if (!currentUser) {
      onOpenLogin();
      return;
    }
    try {
      setActionLoading(true);
      const res = await api.startSchedule();
      setSchedulerStatus(res.status);
      onNotification(res.message || 'Automatic session schedule ENABLED');
      await loadData();
    } catch (err: any) {
      onNotification(err.message || 'Failed to start session schedule', true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleStopSchedule = async () => {
    if (!currentUser) {
      onOpenLogin();
      return;
    }
    try {
      setActionLoading(true);
      const res = await api.stopSchedule();
      setSchedulerStatus(res.status);
      onNotification(res.message || 'Automatic session schedule PAUSED');
      await loadData();
    } catch (err: any) {
      onNotification(err.message || 'Failed to stop session schedule', true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleStartManual = async (configId?: number) => {
    if (!currentUser) {
      onOpenLogin();
      return;
    }
    try {
      setActionLoading(true);
      const res = await api.startManualSession(configId);
      onNotification(res.message || 'Session started immediately');
      await loadData();
    } catch (err: any) {
      onNotification(err.message || 'Failed to start session', true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleStopManual = async () => {
    if (!currentUser) {
      onOpenLogin();
      return;
    }
    try {
      setActionLoading(true);
      const res = await api.stopManualSession();
      onNotification(res.message || 'Active session stopped');
      await loadData();
    } catch (err: any) {
      onNotification(err.message || 'Failed to stop session', true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCompleteTarget = async () => {
    if (!currentUser) {
      onOpenLogin();
      return;
    }
    try {
      setActionLoading(true);
      const res = await api.completeSessionTarget();
      onNotification(res.message || 'Session target marked completed');
      await loadData();
    } catch (err: any) {
      onNotification(err.message || 'Failed to complete session target', true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleBroadcastHistory = async () => {
    if (!currentUser) {
      onOpenLogin();
      return;
    }
    try {
      setActionLoading(true);
      const res = await api.broadcastSessionHistory({ filter: historyFilter });
      onNotification(res.message || 'Session summary report broadcast to WhatsApp!');
    } catch (err: any) {
      onNotification(err.message || 'Failed to broadcast history', true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleConfig = async (id: number) => {
    if (!currentUser) {
      onOpenLogin();
      return;
    }
    try {
      await api.toggleSessionConfig(id);
      await loadData();
      onNotification('Session schedule updated');
    } catch (err: any) {
      onNotification(err.message || 'Failed to toggle session', true);
    }
  };

  const handleDeleteClick = (cfg: SessionConfig) => {
    if (!currentUser) {
      onOpenLogin();
      return;
    }
    setDeleteConfirmConfig(cfg);
  };

  const handleConfirmDelete = async (id: number) => {
    if (!currentUser) {
      onOpenLogin();
      return;
    }
    try {
      setActionLoading(true);
      // Remove from dashboard immediately
      setConfigs((prev) => prev.filter((c) => c.id !== id));
      setDeleteConfirmConfig(null);

      // Call backend DELETE endpoint
      await api.deleteSessionConfig(id);
      onNotification('Session configuration deleted successfully');
      
      // Refresh session list from backend
      await loadData();
    } catch (err: any) {
      onNotification(err.message || 'Failed to delete session', true);
      await loadData();
    } finally {
      setActionLoading(false);
    }
  };

  const handleOpenCreateModal = () => {
    if (!currentUser) {
      onOpenLogin();
      return;
    }
    setEditingConfig(null);
    setFormData({
      session_name: '',
      start_time: '06:00',
      target_wins: 10,
      min_confidence: 65,
      enabled: true,
    });
    setIsModalOpen(true);
  };

  const handleOpenEditModal = (cfg: SessionConfig) => {
    if (!currentUser) {
      onOpenLogin();
      return;
    }
    setEditingConfig(cfg);
    setFormData({
      session_name: cfg.session_name,
      start_time: cfg.start_time,
      target_wins: cfg.target_wins,
      min_confidence: cfg.min_confidence,
      enabled: cfg.enabled,
    });
    setIsModalOpen(true);
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentUser) {
      onOpenLogin();
      return;
    }
    try {
      setActionLoading(true);
      if (editingConfig) {
        await api.updateSessionConfig(editingConfig.id, formData);
        onNotification('Session schedule updated successfully');
      } else {
        await api.createSessionConfig(formData);
        onNotification('New session schedule created');
      }
      setIsModalOpen(false);
      await loadData();
    } catch (err: any) {
      onNotification(err.message || 'Failed to save session configuration', true);
    } finally {
      setActionLoading(false);
    }
  };

  const handleViewSessionSignals = async (session: BotSession) => {
    try {
      setSelectedSession(session);
      setSignalsLoading(true);
      const res = await api.getSessionDetails(session.id);
      if (res?.session) {
        setSelectedSession(res.session);
      }
      setSessionSignals(res?.signals || []);
    } catch (err: any) {
      onNotification(err.message || 'Failed to load session signals', true);
    } finally {
      setSignalsLoading(false);
    }
  };

  const isScheduleEnabled = schedulerStatus?.scheduleEnabled ?? false;
  const activeSession = schedulerStatus?.activeSession;
  const currentSession = schedulerStatus?.currentSession;
  const nextSession = schedulerStatus?.nextSession;
  const targetWins = activeSession?.target_wins || 10;
  const currentWins = activeSession?.wins || 0;
  const targetProgress = Math.min(100, Math.round((currentWins / targetWins) * 100));

  return (
    <div className="space-y-8 max-w-7xl mx-auto pb-16">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
            <Calendar className="w-7 h-7 text-emerald-400" />
            WinGo 1M Session Scheduler
          </h1>
          <p className="text-sm text-neutral-400 mt-1">
            Server-side persistent scheduler. Runs 24/7 in Node.js independent of browser or device.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => loadData(true)}
            disabled={isLoading}
            className="px-3.5 py-2 rounded-xl bg-neutral-900 border border-neutral-800 text-neutral-300 hover:text-white hover:border-neutral-700 text-sm font-medium transition flex items-center gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
            Refresh
          </button>

          <button
            onClick={handleBroadcastHistory}
            disabled={actionLoading}
            className="px-3.5 py-2 rounded-xl bg-emerald-950/60 border border-emerald-800 text-emerald-300 hover:bg-emerald-900/60 text-sm font-medium transition flex items-center gap-2"
          >
            <Send className="w-4 h-4" />
            Send Report to WA
          </button>

          <button
            onClick={handleOpenCreateModal}
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-sm font-semibold transition flex items-center gap-2 shadow-lg shadow-emerald-500/20"
          >
            <Plus className="w-4 h-4" />
            Add Session
          </button>
        </div>
      </div>

      {/* CORE CONTROL BANNER: START SESSIONS / STOP SESSIONS */}
      <div className="rounded-3xl bg-gradient-to-r from-neutral-900 via-neutral-900 to-neutral-950 border border-neutral-800 p-6 md:p-8 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative z-10">
          <div className="space-y-3 max-w-2xl">
            <div className="flex flex-wrap items-center gap-3">
              <span
                className={`inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider border ${
                  isScheduleEnabled
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    isScheduleEnabled ? 'bg-emerald-400 animate-ping' : 'bg-neutral-500'
                  }`}
                />
                Schedule: {isScheduleEnabled ? 'ENABLED (24/7 Background)' : 'PAUSED'}
              </span>

              {/* WhatsApp Readiness Badge */}
              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono border ${
                  schedulerStatus?.whatsAppReady
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    schedulerStatus?.whatsAppReady ? 'bg-emerald-400' : 'bg-rose-500'
                  }`}
                />
                WhatsApp: {schedulerStatus?.whatsAppReady ? 'READY' : 'NOT READY'}
              </span>

              <span
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-mono border ${
                  schedulerStatus?.predictionEngineStatus === 'RUNNING'
                    ? 'bg-teal-500/10 text-teal-400 border-teal-500/30'
                    : schedulerStatus?.predictionEngineStatus === 'PAUSED'
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : 'bg-neutral-900 text-neutral-400 border-neutral-800'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                Prediction Engine: {schedulerStatus?.predictionEngineStatus || 'IDLE'}
              </span>

              <span className="text-xs text-neutral-400 font-mono">
                TZ: <strong className="text-neutral-200">{schedulerStatus?.timezone || 'Asia/Karachi'}</strong> ({schedulerStatus?.currentTime || ''})
              </span>
            </div>

            <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              {isScheduleEnabled
                ? activeSession
                  ? `Active Session: ${activeSession.session_name} (${activeSession.wins}/${activeSession.target_wins} WINs)`
                  : nextSession
                  ? `Next Session: ${nextSession.name} at ${nextSession.startTimeFormatted}`
                  : 'Automatic Schedule is Active'
                : 'Automated Session Schedule is Paused'}
            </h2>

            <p className="text-sm text-neutral-300 leading-relaxed">
              {isScheduleEnabled ? (
                activeSession ? (
                  <span>
                    The <strong className="text-emerald-400">{activeSession.session_name}</strong> session is actively predicting. It will continue indefinitely until reaching its target of <strong className="text-white">{activeSession.target_wins} WINs</strong>. When reached, predictions stop immediately and the bot waits for the next session.
                  </span>
                ) : nextSession ? (
                  <span>
                    The server is waiting for <strong className="text-emerald-400">{nextSession.name}</strong> to start at <strong className="text-white">{nextSession.startTimeFormatted}</strong> ({nextSession.startTime} Asia/Karachi). Prediction engine will automatically enable when the start time arrives.
                  </span>
                ) : (
                  <span>
                    All configured sessions for today have reached their WIN targets. The server will resume automatically tomorrow at the earliest scheduled start time.
                  </span>
                )
              ) : (
                <span>
                  Click <strong className="text-emerald-400">▶️ START SESSIONS</strong> to enable the automatic schedule. The server will wait until the next configured session start time, start it automatically, generate predictions until the target WIN is reached, and cycle continuously 24/7.
                </span>
              )}
            </p>

            {schedulerStatus?.predictionEngineReason && (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-neutral-950/80 border border-neutral-800 text-xs text-neutral-400 font-mono">
                <Info className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
                <span>{schedulerStatus.predictionEngineReason}</span>
              </div>
            )}
          </div>

          {/* Primary Action Button */}
          <div className="shrink-0 flex flex-col sm:flex-row lg:flex-col items-stretch gap-3 w-full sm:w-auto">
            {isScheduleEnabled ? (
              <button
                id="stop-sessions-btn"
                onClick={handleStopSchedule}
                disabled={actionLoading}
                className="px-8 py-4 rounded-2xl bg-neutral-800 hover:bg-neutral-700 active:scale-95 text-white font-bold text-base transition-all shadow-xl flex items-center justify-center gap-3 border border-neutral-700 cursor-pointer"
              >
                <Square className="w-5 h-5 fill-current text-rose-400" />
                <span>⏹️ STOP SESSIONS</span>
              </button>
            ) : (
              <button
                id="start-sessions-btn"
                onClick={handleStartSchedule}
                disabled={actionLoading}
                className="px-8 py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-400 hover:to-teal-400 active:scale-95 text-neutral-950 font-black text-base transition-all shadow-xl shadow-emerald-500/25 flex items-center justify-center gap-3 cursor-pointer"
              >
                <Play className="w-5 h-5 fill-current" />
                <span>▶️ START SESSIONS</span>
              </button>
            )}

            <div className="text-[11px] text-center text-neutral-400">
              {isScheduleEnabled
                ? 'Click to pause automatic schedule & stop predictions'
                : 'Enables 24/7 automated server-side schedule'}
            </div>
          </div>
        </div>
      </div>

      {/* Real-Time Live Status: Active Session + Next Session Countdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Active Running Session or Standby Status */}
        <div className="lg:col-span-2 rounded-2xl bg-neutral-900/90 border border-neutral-800 p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span
                  className={`w-3 h-3 rounded-full ${
                    activeSession ? 'bg-emerald-400 animate-ping' : 'bg-neutral-600'
                  }`}
                />
                <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
                  {activeSession ? 'Current Active Session' : 'Current Session Status'}
                </span>
              </div>

              <div className="flex items-center gap-2 text-xs text-neutral-400 bg-neutral-950 px-3 py-1 rounded-lg border border-neutral-800">
                <Clock className="w-3.5 h-3.5 text-emerald-400" />
                <span>Timezone: <strong className="text-neutral-200">{schedulerStatus?.timezone || 'Asia/Karachi'}</strong></span>
              </div>
            </div>

            {activeSession ? (
              <div className="space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-2xl font-bold text-white tracking-tight flex items-center gap-3">
                      {activeSession.session_name}
                      <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                        RUNNING
                      </span>
                    </h3>
                    <p className="text-xs text-neutral-400 mt-1">
                      Started: {activeSession.started_at ? new Date(activeSession.started_at).toLocaleTimeString() : activeSession.start_time} • Runs until {activeSession.target_wins} WINs (No end time cutoff)
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleCompleteTarget}
                      disabled={actionLoading}
                      className="px-3.5 py-2 rounded-xl bg-teal-950/70 border border-teal-800 text-teal-300 hover:bg-teal-900/70 text-xs font-semibold transition flex items-center gap-1.5"
                      title="Force complete target and send announcement"
                    >
                      <Trophy className="w-3.5 h-3.5" />
                      Complete Target
                    </button>
                    <button
                      onClick={handleStopManual}
                      disabled={actionLoading}
                      className="px-3.5 py-2 rounded-xl bg-rose-950/70 border border-rose-800 text-rose-300 hover:bg-rose-900/70 text-xs font-semibold transition flex items-center gap-1.5"
                    >
                      <Square className="w-3.5 h-3.5" />
                      Stop Session
                    </button>
                  </div>
                </div>

                {/* Live Progress Bar & Target Tracking */}
                <div className="bg-neutral-950 p-4 rounded-xl border border-neutral-800/80">
                  <div className="flex items-center justify-between text-sm mb-2">
                    <span className="text-neutral-300 flex items-center gap-2">
                      <Trophy className="w-4 h-4 text-amber-400" />
                      Target Progress: <strong className="text-white">{currentWins} of {targetWins} WINs</strong>
                    </span>
                    <span className="font-mono text-emerald-400 font-bold">{targetProgress}%</span>
                  </div>
                  <div className="w-full bg-neutral-800 h-3 rounded-full overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-full transition-all duration-500"
                      style={{ width: `${targetProgress}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-3 text-xs text-neutral-400 flex-wrap gap-2">
                    <span>Score: <strong className="text-emerald-400">{activeSession.wins}W</strong> - <strong className="text-rose-400">{activeSession.losses}L</strong></span>
                    <span>Win Rate: <strong className="text-white">{activeSession.win_rate}%</strong></span>
                    <span>Total Signals: <strong className="text-white">{activeSession.total_signals}</strong></span>
                    <span>Remaining: <strong className="text-amber-400">{Math.max(0, targetWins - currentWins)} WINs to go</strong></span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-6 flex flex-col items-center justify-center text-center">
                <div className="w-14 h-14 rounded-2xl bg-neutral-800/60 flex items-center justify-center text-neutral-400 mb-3 border border-neutral-700/50">
                  <Clock className="w-7 h-7 text-neutral-400" />
                </div>
                <h3 className="text-lg font-semibold text-white">
                  {currentSession && currentSession.status === 'TARGET_COMPLETED'
                    ? `Session "${currentSession.session_name}" reached target of ${currentSession.target_wins} WINs!`
                    : 'No session is actively generating predictions'}
                </h3>
                <p className="text-sm text-neutral-400 max-w-md mt-1 mb-4">
                  {nextSession
                    ? `Waiting for scheduled start time: ${nextSession.name} (${nextSession.startTimeFormatted}). Signals will begin automatically.`
                    : 'Enable the automatic schedule or click Run Now on any session config below to start immediately.'}
                </p>
                {configs.length > 0 && (
                  <button
                    onClick={() => handleStartManual(configs[0].id)}
                    disabled={actionLoading}
                    className="px-5 py-2.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-sm font-semibold transition flex items-center gap-2 border border-neutral-700"
                  >
                    <Play className="w-4 h-4 fill-current text-emerald-400" />
                    Run "{configs[0].session_name}" Now (Manual Override)
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-neutral-800/80 mt-4 text-xs text-neutral-400 flex flex-wrap items-center justify-between gap-2">
            <span>Server Execution: <strong className="text-emerald-400">Node.js Persistent Background</strong></span>
            <span>Signals: <strong className="text-neutral-200">Fixed 15s timing</strong></span>
            <span>Settlement: <strong className="text-neutral-200">Immediate on draw</strong></span>
          </div>
        </div>

        {/* Right: Next Scheduled Session Countdown */}
        <div className="rounded-2xl bg-neutral-900/90 border border-neutral-800 p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-3">
              <Timer className="w-4 h-4 text-teal-400" />
              Next Scheduled Session
            </div>

            {nextSession ? (
              <div className="space-y-4">
                <div>
                  <h3 className="text-xl font-bold text-white">{nextSession.name}</h3>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    Starts at <strong className="text-emerald-400">{nextSession.startTimeFormatted || format12h(nextSession.startTime)}</strong> ({nextSession.startTime} 24h)
                  </p>
                  <p className="text-xs text-neutral-400 mt-0.5">
                    Target: <strong className="text-white">{nextSession.targetWins || 10} WINs</strong> (indefinite duration)
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-emerald-950/30 border border-emerald-800/50 text-center">
                  <div className="text-xs text-emerald-400 font-medium mb-1">Time Remaining</div>
                  <div className="text-3xl font-extrabold text-white font-mono tracking-tight">
                    {nextCountdownSeconds !== null ? formatCountdown(nextCountdownSeconds) : 'Calculating...'}
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-8 text-center text-neutral-500 text-sm">
                No upcoming scheduled sessions configured or all today's sessions reached target.
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-neutral-800/80 mt-4 text-xs text-neutral-400 flex items-center justify-between">
            <span>Schedule Mode: <strong className="text-white">{isScheduleEnabled ? 'Automatic' : 'Manual'}</strong></span>
            <span>Configs: <strong className="text-emerald-400">{configs.filter((c) => c.enabled).length} Enabled</strong></span>
          </div>
        </div>
      </div>

      {/* Configured Sessions List */}
      <div className="rounded-2xl bg-neutral-900/80 border border-neutral-800 overflow-hidden">
        <div className="p-6 border-b border-neutral-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Clock className="w-5 h-5 text-emerald-400" />
              Configured Sessions
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              Each session starts at its configured start time and runs indefinitely until its WIN TARGET is reached.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-xs text-neutral-400 bg-neutral-950 px-3 py-1.5 rounded-lg border border-neutral-800">
              Rule: <strong className="text-emerald-400">NO SESSION END TIME</strong>
            </span>
          </div>
        </div>

        <div className="divide-y divide-neutral-800/60">
          {configs.length === 0 ? (
            <div className="p-8 text-center text-neutral-500 text-sm">
              No session schedules configured yet. Click "Add Session" above to create one.
            </div>
          ) : (
            configs.map((cfg) => {
              const isCurrent = activeSession?.session_config_id === cfg.id;
              return (
                <div
                  key={cfg.id}
                  className={`p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 transition ${
                    isCurrent ? 'bg-emerald-950/20 border-l-4 border-l-emerald-500' : 'hover:bg-neutral-800/20'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div className="w-16 h-14 rounded-xl bg-neutral-950 border border-neutral-800 flex flex-col items-center justify-center font-mono shrink-0 shadow-inner">
                      <span className="text-xs text-white font-bold">{format12h(cfg.start_time).split(' ')[0]}</span>
                      <span className="text-[10px] text-emerald-400 font-bold">{format12h(cfg.start_time).split(' ')[1]}</span>
                    </div>

                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-base font-bold text-white">{cfg.session_name}</h4>
                        {isCurrent && (
                          <span className="px-2 py-0.5 text-[10px] font-bold rounded-md uppercase bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                            Active Now
                          </span>
                        )}
                        <span
                          className={`px-2 py-0.5 text-[10px] font-bold rounded-md uppercase border ${
                            cfg.enabled
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                              : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                          }`}
                        >
                          {cfg.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-neutral-400">
                        <span>Target: <strong className="text-white font-semibold">{cfg.target_wins} WIN</strong></span>
                        <span>•</span>
                        <span>Duration: <strong className="text-teal-400">Until {cfg.target_wins} WIN reached</strong></span>
                        <span>•</span>
                        <span>Timing: <strong className="text-emerald-400">Exact 15s (WinGo sync)</strong></span>
                        <span>•</span>
                        <span className="text-amber-400 font-mono flex items-center gap-1">
                          <Bell className="w-3 h-3 text-amber-400 shrink-0" />
                          <span>Reminder: <strong>{getReminderTimeFormatted(cfg.start_time)}</strong> (30m before)</span>
                        </span>
                        <span>•</span>
                        <span>Min Confidence: <strong className="text-white">{cfg.min_confidence}%</strong></span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-end md:self-center">
                    <button
                      onClick={() => handleStartManual(cfg.id)}
                      disabled={actionLoading}
                      className="px-3 py-1.5 rounded-lg bg-emerald-950/60 border border-emerald-800/70 text-emerald-300 hover:bg-emerald-900/60 text-xs font-semibold transition flex items-center gap-1.5"
                      title="Run this session immediately (manual override)"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      Run Now
                    </button>

                    <button
                      onClick={() => handleToggleConfig(cfg.id)}
                      className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs font-medium transition"
                    >
                      {cfg.enabled ? 'Disable' : 'Enable'}
                    </button>

                    <button
                      onClick={() => handleOpenEditModal(cfg)}
                      className="p-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white transition"
                      title="Edit session"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>

                    <button
                      onClick={() => handleDeleteClick(cfg)}
                      className="p-1.5 rounded-lg bg-neutral-800 hover:bg-rose-950 text-neutral-400 hover:text-rose-300 transition"
                      title="Delete session"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Session Run History */}
      <div className="rounded-2xl bg-neutral-900/80 border border-neutral-800 overflow-hidden">
        <div className="p-6 border-b border-neutral-800 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <History className="w-5 h-5 text-emerald-400" />
              Session Execution Log
            </h2>
            <p className="text-xs text-neutral-400 mt-0.5">
              Historical record of all sessions executed by the server-side scheduler
            </p>
          </div>

          <div className="flex items-center gap-2">
            {(['today', 'yesterday', 'last7', 'last30', 'all'] as const).map((filter) => (
              <button
                key={filter}
                onClick={() => setHistoryFilter(filter)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition ${
                  historyFilter === filter
                    ? 'bg-emerald-500 text-neutral-950 font-bold'
                    : 'bg-neutral-800 text-neutral-400 hover:text-white'
                }`}
              >
                {filter === 'last7' ? '7 Days' : filter === 'last30' ? '30 Days' : filter}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto">
          {history.length === 0 ? (
            <div className="p-10 text-center text-neutral-500 text-sm">
              No session execution records found for the selected time range.
            </div>
          ) : (
            <table className="w-full text-left text-sm text-neutral-300">
              <thead className="bg-neutral-950/60 text-xs uppercase text-neutral-400 border-b border-neutral-800">
                <tr>
                  <th className="px-6 py-3.5 font-semibold">Session</th>
                  <th className="px-6 py-3.5 font-semibold">Date / Start</th>
                  <th className="px-6 py-3.5 font-semibold">Status</th>
                  <th className="px-6 py-3.5 font-semibold">Score (W / L)</th>
                  <th className="px-6 py-3.5 font-semibold">Win Rate</th>
                  <th className="px-6 py-3.5 font-semibold">Signals</th>
                  <th className="px-6 py-3.5 font-semibold text-right">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/40">
                {history.map((sess) => (
                  <tr key={sess.id} className="hover:bg-neutral-800/20 transition">
                    <td className="px-6 py-4 font-semibold text-white">
                      {sess.session_name}
                      <span className="text-xs text-neutral-500 block">Target: {sess.target_wins} WIN</span>
                    </td>
                    <td className="px-6 py-4 text-xs">
                      <span className="text-neutral-300 block font-mono">{sess.schedule_date || sess.date}</span>
                      <span className="text-neutral-500 block">
                        {sess.started_at ? new Date(sess.started_at).toLocaleTimeString() : format12h(sess.start_time)}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <span
                        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold uppercase ${
                          sess.status === 'RUNNING'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : sess.status === 'TARGET_COMPLETED'
                            ? 'bg-teal-500/20 text-teal-300 border border-teal-500/30'
                            : 'bg-neutral-800 text-neutral-400 border border-neutral-700'
                        }`}
                      >
                        {sess.status === 'TARGET_COMPLETED' ? 'Target Reached' : sess.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-semibold text-xs">
                        <span className="text-emerald-400">{sess.wins} WIN</span>
                        <span className="text-neutral-600 mx-1">/</span>
                        <span className="text-rose-400">{sess.losses} LOSS</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-mono font-bold text-white text-xs">{sess.win_rate}%</span>
                    </td>
                    <td className="px-6 py-4 text-xs font-mono text-neutral-400">
                      {sess.total_signals}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        onClick={() => handleViewSessionSignals(sess)}
                        className="px-3 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-xs font-medium text-neutral-200 transition"
                      >
                        View Signals
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Create / Edit Session Modal (NO END TIME) */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/80 backdrop-blur-sm">
          <div className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-neutral-800 pb-4 mb-4">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Calendar className="w-5 h-5 text-emerald-400" />
                {editingConfig ? 'Edit Scheduled Session' : 'Create New Scheduled Session'}
              </h3>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-white transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveConfig} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
                  Session Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Morning, Afternoon, Night"
                  value={formData.session_name}
                  onChange={(e) => setFormData({ ...formData, session_name: e.target.value })}
                  className="w-full px-4 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-white text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
                    Start Time (24h)
                  </label>
                  <input
                    type="time"
                    required
                    value={formData.start_time}
                    onChange={(e) => setFormData({ ...formData, start_time: e.target.value })}
                    className="w-full px-3 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-white text-sm font-mono focus:outline-none focus:border-emerald-500"
                  />
                  <span className="text-[11px] text-emerald-400 mt-1 block">
                    Starts at {format12h(formData.start_time)}
                  </span>
                </div>

                <div>
                  <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
                    Target WINs
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={50}
                    required
                    value={formData.target_wins}
                    onChange={(e) => setFormData({ ...formData, target_wins: parseInt(e.target.value, 10) || 10 })}
                    className="w-full px-3 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-white text-sm focus:outline-none focus:border-emerald-500"
                  />
                  <span className="text-[11px] text-neutral-500 mt-1 block">Auto-stop target</span>
                </div>
              </div>

              {/* Explicit Clarification Notice */}
              <div className="p-3 rounded-xl bg-teal-950/40 border border-teal-800/50 text-xs text-teal-300 flex items-start gap-2">
                <Info className="w-4 h-4 text-teal-400 shrink-0 mt-0.5" />
                <span>
                  <strong>No Session End Time:</strong> This session will run indefinitely until its configured target of {formData.target_wins} WINs is achieved. As soon as {formData.target_wins} WIN is reached, prediction stops immediately and the scheduler waits for the next session.
                </span>
              </div>

              {/* Fixed 15s Timing Notice */}
              <div className="p-3 rounded-xl bg-emerald-950/20 border border-emerald-500/30 text-xs text-neutral-300 flex items-start gap-2">
                <Info className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <span>
                  <strong>Fixed 15-Second Timing:</strong> Every signal for this session is dispatched at exactly 15 seconds into each WinGo 1M issue. Configurable or randomized delays have been permanently removed.
                </span>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
                  Min AI Confidence Threshold (%)
                </label>
                <input
                  type="number"
                  min={50}
                  max={95}
                  value={formData.min_confidence}
                  onChange={(e) => setFormData({ ...formData, min_confidence: parseInt(e.target.value, 10) || 65 })}
                  className="w-full px-4 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-white text-sm focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="enabledCheck"
                  checked={formData.enabled}
                  onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                  className="w-4 h-4 text-emerald-500 bg-neutral-950 border-neutral-800 rounded"
                />
                <label htmlFor="enabledCheck" className="text-sm text-neutral-300">
                  Enable this session in daily schedule
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-neutral-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-sm font-medium transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={actionLoading}
                  className="px-5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-neutral-950 text-sm font-semibold transition"
                >
                  {editingConfig ? 'Save Changes' : 'Create Session'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* View Session Signals Breakdown Modal */}
      {selectedSession && (() => {
        const modalResolved = sessionSignals.filter((s) => s.status === 'WIN' || s.status === 'LOSS');
        const modalWins = modalResolved.filter((s) => s.status === 'WIN').length;
        const modalLosses = modalResolved.filter((s) => s.status === 'LOSS').length;
        const modalTotal = modalWins + modalLosses;
        const modalWinRate = modalTotal > 0 ? ((modalWins / modalTotal) * 100).toFixed(1) : '0.0';

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-950/80 backdrop-blur-sm">
            <div className="bg-neutral-900 border border-neutral-800 rounded-2xl max-w-3xl w-full max-h-[85vh] flex flex-col p-6 shadow-2xl">
              <div className="flex items-center justify-between border-b border-neutral-800 pb-4">
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-emerald-400" />
                    {selectedSession.session_name} — Signals Breakdown
                  </h3>
                  <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-300 mt-1">
                    <span>Target: <strong className="text-white">{selectedSession.target_wins} WIN</strong></span>
                    <span className="text-neutral-600">•</span>
                    <span>Total Predictions: <strong className="text-white font-mono">{modalTotal}</strong></span>
                    <span className="text-neutral-600">•</span>
                    <span className="text-emerald-400 font-semibold">WIN: {modalWins}</span>
                    <span className="text-neutral-600">•</span>
                    <span className="text-rose-400 font-semibold">LOSS: {modalLosses}</span>
                    <span className="text-neutral-600">•</span>
                    <span className="text-teal-300 font-mono font-semibold">Win Rate: {modalWinRate}%</span>
                  </div>
                </div>
                <button
                  onClick={() => setSelectedSession(null)}
                  className="p-1 rounded-lg hover:bg-neutral-800 text-neutral-400 hover:text-white transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

            <div className="overflow-y-auto flex-1 py-4">
              {signalsLoading ? (
                <div className="py-12 text-center text-neutral-400 text-sm">Loading signals...</div>
              ) : sessionSignals.length === 0 ? (
                <div className="py-12 text-center text-neutral-500 text-sm">
                  No signals recorded under this session.
                </div>
              ) : (
                <div className="space-y-3">
                  {sessionSignals.map((sig, idx) => (
                    <div
                      key={sig.id || idx}
                      className="p-3.5 rounded-xl bg-neutral-950/80 border border-neutral-800 flex items-center justify-between text-xs"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-neutral-200">
                            Issue #{sig.issue_number}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded font-bold uppercase text-[10px] ${
                              sig.prediction === 'BIG'
                                ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                                : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                            }`}
                          >
                            {sig.prediction}
                          </span>
                          <span className="text-neutral-400">Confidence: {sig.confidence}%</span>
                        </div>
                        <div className="text-[11px] text-neutral-500">
                          Dispatched: {sig.sent_at ? new Date(sig.sent_at).toLocaleTimeString() : 'N/A'}
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        {sig.actual_number !== undefined && sig.actual_number !== null && (
                          <div className="text-right">
                            <div className="text-[11px] text-neutral-400">
                              Result: <strong className="text-white">{sig.actual_number} ({sig.actual_size})</strong>
                            </div>
                          </div>
                        )}
                        <span
                          className={`px-2.5 py-1 rounded-md font-bold uppercase text-xs ${
                            sig.status === 'WIN'
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : sig.status === 'LOSS'
                              ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                              : 'bg-neutral-800 text-neutral-400'
                          }`}
                        >
                          {sig.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-4 border-t border-neutral-800 flex justify-end">
              <button
                onClick={() => setSelectedSession(null)}
                className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-sm font-medium transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Delete Confirmation Modal (Requirement 9) */}
      {deleteConfirmConfig && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
          <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-rose-500/10 text-rose-400">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">Delete this session?</h3>
                <p className="text-xs text-neutral-400">
                  Are you sure you want to delete session &quot;{deleteConfirmConfig.session_name}&quot;?
                </p>
              </div>
            </div>

            <p className="text-xs text-neutral-400 bg-neutral-950/60 p-3 rounded-xl border border-neutral-800">
              This action will remove the scheduled session configuration. Historical execution logs and statistics will be preserved safely.
            </p>

            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setDeleteConfirmConfig(null)}
                disabled={actionLoading}
                className="px-4 py-2 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-sm font-semibold transition"
              >
                CANCEL
              </button>
              <button
                type="button"
                onClick={() => handleConfirmDelete(deleteConfirmConfig.id)}
                disabled={actionLoading}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold transition flex items-center gap-2 shadow-lg shadow-rose-950/40"
              >
                {actionLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                DELETE
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
