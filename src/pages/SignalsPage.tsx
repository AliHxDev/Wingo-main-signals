import React, { useState } from 'react';
import {
  TrendingUp,
  CheckCircle2,
  XCircle,
  Clock,
  Filter,
  Send,
} from 'lucide-react';
import type { Signal } from '../types/index.js';

interface SignalsPageProps {
  signals?: Signal[];
}

export const SignalsPage: React.FC<SignalsPageProps> = ({ signals = [] }) => {
  const [filter, setFilter] = useState<'ALL' | 'WIN' | 'LOSS' | 'PENDING'>('ALL');

  const safeSignals = Array.isArray(signals) ? signals : [];
  const filteredSignals = safeSignals.filter((s) => {
    if (filter === 'ALL') return true;
    return s.status === filter;
  });

  return (
    <div className="space-y-6">
      {/* Header & Filter Controls */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-emerald-400" />
            <span>Signal History & Settle Log</span>
          </h2>
          <p className="text-xs text-neutral-400 mt-0.5">
            Detailed chronological record of deterministic predictions and actual WinGo outcomes
          </p>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1 bg-neutral-950 p-1 rounded-xl border border-neutral-800 self-start sm:self-auto">
          {(['ALL', 'WIN', 'LOSS', 'PENDING'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                filter === tab
                  ? 'bg-neutral-800 text-white shadow-xs'
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Signals Grid / Table */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredSignals.map((sig) => (
          <div
            key={sig.id || sig.issue_number}
            className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-lg flex flex-col justify-between hover:border-neutral-700 transition-colors"
          >
            <div>
              <div className="flex items-center justify-between pb-3 border-b border-neutral-800/80 mb-3">
                <span className="text-xs font-bold text-neutral-400 font-mono">
                  #{sig.issue_number}
                </span>
                <span
                  className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    sig.status === 'WIN'
                      ? 'bg-emerald-950/80 border border-emerald-800 text-emerald-400'
                      : sig.status === 'LOSS'
                      ? 'bg-rose-950/80 border border-rose-800 text-rose-400'
                      : 'bg-amber-950/80 border border-amber-800 text-amber-400'
                  }`}
                >
                  {sig.status === 'WIN' && <CheckCircle2 className="w-3 h-3" />}
                  {sig.status === 'LOSS' && <XCircle className="w-3 h-3" />}
                  {sig.status === 'PENDING' && <Clock className="w-3 h-3" />}
                  {sig.status}
                </span>
              </div>

              {/* Prediction details */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-400 text-xs">Prediction:</span>
                  <span
                    className={`font-mono font-bold ${
                      sig.prediction === 'BIG' ? 'text-emerald-400' : 'text-amber-400'
                    }`}
                  >
                    {sig.prediction === 'BIG' ? '🔺 BIG' : '🔻 SMALL'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-400 text-xs">Color:</span>
                  <span className="font-mono font-semibold text-neutral-200">
                    {sig.predicted_color}
                  </span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-neutral-400 text-xs">Confidence:</span>
                  <span className="font-mono font-bold text-emerald-400">{sig.confidence}%</span>
                </div>

                <div className="flex items-center justify-between text-sm pt-2 border-t border-neutral-800/60">
                  <span className="text-neutral-400 text-xs">Actual Result:</span>
                  <span className="font-mono font-bold text-white">
                    {sig.actual_number !== undefined && sig.actual_number !== null
                      ? `${sig.actual_number} (${sig.actual_size}, ${sig.actual_color})`
                      : 'Awaiting draw...'}
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-3 mt-4 border-t border-neutral-800/60 flex items-center justify-between text-[11px] text-neutral-500 font-mono">
              <span className="flex items-center gap-1 truncate max-w-[160px]">
                <Send className="w-3 h-3 text-neutral-600 shrink-0" />
                {sig.sent_to ? (sig.sent_to.split('@')[0] || sig.sent_to) : 'Unknown'}
              </span>
              <span>{sig.sent_at ? new Date(sig.sent_at).toLocaleTimeString() : '---'}</span>
            </div>
          </div>
        ))}

        {filteredSignals.length === 0 && (
          <div className="col-span-full py-16 text-center text-neutral-500 bg-neutral-900 border border-neutral-800 rounded-2xl">
            <Filter className="w-8 h-8 mx-auto text-neutral-600 mb-2" />
            <p className="text-sm">No signals found matching filter "{filter}".</p>
          </div>
        )}
      </div>
    </div>
  );
};
