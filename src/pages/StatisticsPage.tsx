import React from 'react';
import {
  BarChart3,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Clock,
  PieChart,
  ShieldCheck,
  Flame,
} from 'lucide-react';
import type { Statistics } from '../types/index.js';

interface StatisticsPageProps {
  statistics: Statistics | null;
}

export const StatisticsPage: React.FC<StatisticsPageProps> = ({ statistics }) => {
  const stats = statistics || {
    totalSignals: 0,
    settled: 0,
    wins: 0,
    losses: 0,
    pending: 0,
    winRate: 0,
    recentSettled: [],
    predictionsDistribution: { big: 0, small: 0 },
    deliveryStats: { success: 0, failed: 0 },
  };

  const totalPredictions =
    stats.predictionsDistribution.big + stats.predictionsDistribution.small;
  const bigPercent =
    totalPredictions > 0
      ? Math.round((stats.predictionsDistribution.big / totalPredictions) * 100)
      : 50;
  const smallPercent = totalPredictions > 0 ? 100 - bigPercent : 50;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl">
        <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-emerald-400" />
          <span>Performance & Analytics</span>
        </h2>
        <p className="text-xs text-neutral-400 mt-0.5">
          Real-time aggregated metrics computed directly from persistent signal records
        </p>
      </div>

      {/* Top 4 KPI Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Win Rate */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-lg">
          <div className="flex items-center justify-between text-neutral-400 text-xs font-semibold uppercase tracking-wider">
            <span>Win Rate</span>
            <TrendingUp className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-4xl font-black text-white font-mono mt-3">
            {stats.winRate}%
          </p>
          <div className="w-full bg-neutral-800 rounded-full h-1.5 mt-3 overflow-hidden">
            <div
              className="bg-emerald-500 h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min(stats.winRate, 100)}%` }}
            />
          </div>
        </div>

        {/* Wins */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-lg">
          <div className="flex items-center justify-between text-neutral-400 text-xs font-semibold uppercase tracking-wider">
            <span>Total Wins</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-4xl font-black text-emerald-400 font-mono mt-3">
            {stats.wins}
          </p>
          <p className="text-xs text-neutral-500 mt-2">
            Settled out of {stats.settled}
          </p>
        </div>

        {/* Losses */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-lg">
          <div className="flex items-center justify-between text-neutral-400 text-xs font-semibold uppercase tracking-wider">
            <span>Total Losses</span>
            <XCircle className="w-4 h-4 text-rose-400" />
          </div>
          <p className="text-4xl font-black text-rose-400 font-mono mt-3">
            {stats.losses}
          </p>
          <p className="text-xs text-neutral-500 mt-2">
            Unmatched forecasts
          </p>
        </div>

        {/* Pending */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 shadow-lg">
          <div className="flex items-center justify-between text-neutral-400 text-xs font-semibold uppercase tracking-wider">
            <span>Pending Draw</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <p className="text-4xl font-black text-amber-400 font-mono mt-3">
            {stats.pending}
          </p>
          <p className="text-xs text-neutral-500 mt-2">
            Awaiting settlement
          </p>
        </div>
      </div>

      {/* Secondary Metrics: Recent Streak & Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent 10 Outcome Streak */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <Flame className="w-4 h-4 text-amber-400" />
              <span>Recent Outcome Streak (Last 10)</span>
            </h3>
            <span className="text-xs text-neutral-400">Most recent on right</span>
          </div>

          <div className="flex items-center justify-between gap-2 p-4 bg-neutral-950 rounded-xl border border-neutral-800 overflow-x-auto">
            {stats.recentSettled.length > 0 ? (
              stats.recentSettled.slice(0, 10).reverse().map((item, index) => (
                <div
                  key={index}
                  className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold font-mono text-xs shadow-md ${
                    item.status === 'WIN'
                      ? 'bg-emerald-600 text-white shadow-emerald-900/30'
                      : 'bg-rose-600 text-white shadow-rose-900/30'
                  }`}
                  title={`Period #${item.issue_number}: ${item.status}`}
                >
                  {item.status === 'WIN' ? 'W' : 'L'}
                </div>
              ))
            ) : (
              <span className="text-neutral-500 text-xs py-2">
                No settled outcomes recorded yet.
              </span>
            )}
          </div>
        </div>

        {/* Prediction Distribution (BIG vs SMALL) */}
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <PieChart className="w-4 h-4 text-emerald-400" />
              <span>Prediction Distribution</span>
            </h3>
            <span className="text-xs text-neutral-400">{totalPredictions} total</span>
          </div>

          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-xs font-semibold text-neutral-300 mb-1">
                <span>🔺 BIG ({stats.predictionsDistribution.big})</span>
                <span>{bigPercent}%</span>
              </div>
              <div className="w-full bg-neutral-950 rounded-full h-2.5 overflow-hidden border border-neutral-800">
                <div
                  className="bg-emerald-500 h-full rounded-full"
                  style={{ width: `${bigPercent}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs font-semibold text-neutral-300 mb-1">
                <span>🔻 SMALL ({stats.predictionsDistribution.small})</span>
                <span>{smallPercent}%</span>
              </div>
              <div className="w-full bg-neutral-950 rounded-full h-2.5 overflow-hidden border border-neutral-800">
                <div
                  className="bg-amber-500 h-full rounded-full"
                  style={{ width: `${smallPercent}%` }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Broadcast Delivery Status */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl">
        <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-teal-400" />
          <span>WhatsApp Message Broadcast Reliability</span>
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 font-mono">
          <div className="p-3 bg-neutral-950 border border-neutral-800 rounded-xl">
            <span className="text-[11px] text-neutral-400 block">Delivered Messages</span>
            <span className="text-xl font-bold text-emerald-400">{stats.deliveryStats.success}</span>
          </div>
          <div className="p-3 bg-neutral-950 border border-neutral-800 rounded-xl">
            <span className="text-[11px] text-neutral-400 block">Delivery Failures</span>
            <span className="text-xl font-bold text-rose-400">{stats.deliveryStats.failed}</span>
          </div>
          <div className="p-3 bg-neutral-950 border border-neutral-800 rounded-xl col-span-2 sm:col-span-1">
            <span className="text-[11px] text-neutral-400 block">Success Ratio</span>
            <span className="text-xl font-bold text-teal-300">
              {stats.deliveryStats.success + stats.deliveryStats.failed > 0
                ? Math.round(
                    (stats.deliveryStats.success /
                      (stats.deliveryStats.success + stats.deliveryStats.failed)) *
                      100
                  )
                : 100}
              %
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
