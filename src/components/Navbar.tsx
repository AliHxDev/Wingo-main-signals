import React from 'react';
import {
  Radio,
  MessageSquare,
  Bot,
  LogIn,
  LogOut,
  LayoutDashboard,
  TrendingUp,
  BarChart3,
  Sliders,
  FileText,
  Calendar,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import { StartStopButton } from './StartStopButton.js';
import type { BotStatus, WhatsAppStatus, User } from '../types/index.js';

interface NavbarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  botStatus: BotStatus | null;
  whatsAppStatus: WhatsAppStatus | null;
  activeDestination: string | null;
  currentUser: User | null;
  onStatusChange: (status: BotStatus) => void;
  onError: (err: string) => void;
  onOpenLogin: () => void;
  onLogout: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onTabChange,
  botStatus,
  whatsAppStatus,
  activeDestination,
  currentUser,
  onStatusChange,
  onError,
  onOpenLogin,
  onLogout,
}) => {
  const waState = whatsAppStatus?.status || 'not_paired';
  const isWaConnected = waState === 'connected';
  const isWaConnecting = waState === 'connecting';
  const isWaPairing = waState === 'pairing';
  const isWaNotPaired = waState === 'not_paired';
  const isWaLoggedOut = waState === 'logged_out';
  const isBotRunning = botStatus?.running ?? false;

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'sessions', label: 'Sessions', icon: Calendar },
    { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
    { id: 'templates', label: 'Templates', icon: FileText },
    { id: 'signals', label: 'Signals', icon: TrendingUp },
    { id: 'statistics', label: 'Statistics', icon: BarChart3 },
    { id: 'settings', label: 'Settings', icon: Sliders },
  ];

  return (
    <header className="sticky top-0 z-40 bg-neutral-950/80 backdrop-blur-md border-b border-neutral-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          {/* Logo & Title */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-lg shadow-emerald-950/40">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-white text-base tracking-tight">WinGo 1M</span>
                <span className="px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Bot
                </span>
              </div>
              <p className="text-xs text-neutral-400 hidden sm:block">WhatsApp Signal Engine</p>
            </div>
          </div>

          {/* Real-time Status Chips */}
          <div className="hidden lg:flex items-center gap-3">
            {/* WhatsApp Status */}
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
                isWaConnected
                  ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400'
                  : isWaConnecting
                  ? 'bg-amber-950/40 border-amber-800/60 text-amber-400'
                  : isWaPairing
                  ? 'bg-amber-950/40 border-amber-800/60 text-amber-400'
                  : isWaNotPaired
                  ? 'bg-neutral-900 border-neutral-700 text-neutral-300'
                  : isWaLoggedOut
                  ? 'bg-rose-950/40 border-rose-800/60 text-rose-400'
                  : 'bg-rose-950/40 border-rose-800/60 text-rose-400'
              }`}
            >
              <Radio
                className={`w-3.5 h-3.5 ${
                  isWaConnected
                    ? 'text-emerald-400 animate-pulse'
                    : isWaConnecting
                    ? 'text-amber-400 animate-spin'
                    : isWaPairing
                    ? 'text-amber-400'
                    : isWaNotPaired
                    ? 'text-neutral-400'
                    : 'text-rose-400'
                }`}
              />
              <span>
                WA:{' '}
                {isWaConnected
                  ? 'Connected'
                  : isWaConnecting
                  ? 'Connecting...'
                  : isWaPairing
                  ? 'Pairing'
                  : isWaNotPaired
                  ? 'Not Paired'
                  : isWaLoggedOut
                  ? 'Logged Out'
                  : 'Disconnected'}
              </span>
            </div>

            {/* Newsletter Channel Pill */}
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium bg-neutral-900 border border-neutral-800 text-neutral-300">
              <MessageSquare className="w-3.5 h-3.5 text-neutral-400" />
              <span className="truncate max-w-[140px]">
                {activeDestination ? (activeDestination.split('@')[0] || activeDestination) + '@ch' : 'No Channel'}
              </span>
              {activeDestination ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              )}
            </div>

            {/* Bot Status Pill */}
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border ${
                isBotRunning
                  ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-400'
                  : 'bg-neutral-900 border-neutral-800 text-neutral-400'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  isBotRunning ? 'bg-emerald-400 animate-ping' : 'bg-neutral-500'
                }`}
              />
              <span>Bot: {isBotRunning ? 'Active (60s)' : 'Idle'}</span>
            </div>
          </div>

          {/* Actions & Start/Stop */}
          <div className="flex items-center gap-3">
            <StartStopButton
              status={botStatus}
              onStatusChange={onStatusChange}
              onError={onError}
              disabled={!currentUser}
            />

            {currentUser ? (
              <button
                id="admin-logout-btn"
                onClick={onLogout}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 text-neutral-300 transition-colors"
                title={`Logged in as ${currentUser.username}`}
              >
                <LogOut className="w-3.5 h-3.5 text-neutral-400" />
                <span className="hidden sm:inline">Logout</span>
              </button>
            ) : (
              <button
                id="admin-login-btn"
                onClick={onOpenLogin}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium bg-emerald-600/20 hover:bg-emerald-600/30 border border-emerald-500/30 text-emerald-300 transition-colors"
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Admin Login</span>
              </button>
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <nav className="flex space-x-1 overflow-x-auto py-2 border-t border-neutral-800/60 scrollbar-none">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                id={`tab-${item.id}`}
                onClick={() => onTabChange(item.id)}
                className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-neutral-800 text-white shadow-xs'
                    : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-900/60'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-400' : 'text-neutral-500'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
