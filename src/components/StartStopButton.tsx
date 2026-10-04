import React, { useState } from 'react';
import { Play, Square, Loader2 } from 'lucide-react';
import { api } from '../services/api.js';
import type { BotStatus } from '../types/index.js';

interface StartStopButtonProps {
  status: BotStatus | null;
  onStatusChange: (newStatus: BotStatus) => void;
  onError: (err: string) => void;
  disabled?: boolean;
}

export const StartStopButton: React.FC<StartStopButtonProps> = ({
  status,
  onStatusChange,
  onError,
  disabled = false,
}) => {
  const [loading, setLoading] = useState(false);
  const isRunning = (status?.mode === 'NORMAL' && status?.running) || (status?.running && status?.mode !== 'SESSION');

  const handleToggle = async () => {
    if (loading) return;
    setLoading(true);

    try {
      if (isRunning) {
        const res = await api.stopBot();
        onStatusChange(res.status);
      } else {
        const res = await api.startBot();
        onStatusChange(res.status);
      }
    } catch (err: any) {
      onError(err.message || 'Failed to toggle bot state');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      id="bot-toggle-btn"
      onClick={handleToggle}
      disabled={disabled || loading}
      className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all duration-200 shadow-md ${
        isRunning
          ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/30'
          : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30'
      } ${disabled || loading ? 'opacity-60 cursor-not-allowed' : 'active:scale-95'}`}
      title={isRunning ? 'Stop Normal Bot Mode' : 'Start Normal Bot Mode'}
    >
      {loading ? (
        <Loader2 className="w-4 h-4 animate-spin" />
      ) : isRunning ? (
        <Square className="w-4 h-4 fill-current" />
      ) : (
        <Play className="w-4 h-4 fill-current" />
      )}
      <span>{loading ? 'Processing...' : isRunning ? '⏹️ STOP BOT' : '▶️ START BOT'}</span>
    </button>
  );
};
