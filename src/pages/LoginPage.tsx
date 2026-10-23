import React, { useState, useEffect } from 'react';
import {
  Lock,
  User,
  AlertCircle,
  Loader2,
  Eye,
  EyeOff,
  ShieldCheck,
  Bot,
  Radio,
  Clock,
  Sparkles,
  KeyRound,
} from 'lucide-react';
import { api } from '../services/api.js';
import type { User as UserType } from '../types/index.js';

interface LoginPageProps {
  onLoginSuccess: (user: UserType) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [currentTime, setCurrentTime] = useState<string>('');

  useEffect(() => {
    // Update live Pakistan time indicator
    const updateTime = () => {
      try {
        const now = new Date();
        const formatted = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Karachi',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: true,
        }).format(now);
        setCurrentTime(`${formatted} PKT`);
      } catch {
        setCurrentTime(new Date().toLocaleTimeString());
      }
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('Please provide both username and password.');
      return;
    }

    setError(null);
    setLoading(true);

    try {
      const res = await api.login({ username: username.trim(), password });
      if (res?.user) {
        onLoginSuccess(res.user);
      } else {
        throw new Error('Authentication succeeded but user profile was not returned.');
      }
    } catch (err: any) {
      setError(err.message || 'Invalid username or password. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  const handleAutofill = () => {
    setUsername('admin');
    setPassword('admin123456');
    setError(null);
  };

  return (
    <div className="min-h-screen w-full bg-neutral-950 flex flex-col justify-between relative overflow-hidden select-none">
      {/* Dynamic Background Glowing Accents */}
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-emerald-600/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full bg-teal-600/10 blur-[140px] pointer-events-none" />
      <div className="absolute top-[40%] right-[20%] w-[350px] h-[350px] rounded-full bg-emerald-950/20 blur-[100px] pointer-events-none" />

      {/* Top Brand Bar */}
      <header className="relative z-10 w-full max-w-7xl mx-auto px-6 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center text-white shadow-lg shadow-emerald-950/40 ring-1 ring-emerald-400/30">
            <Bot className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-white text-base tracking-tight">WinGo 1M</span>
              <span className="px-2 py-0.5 text-[10px] uppercase font-bold tracking-wider rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                VIP Portal
              </span>
            </div>
            <p className="text-xs text-neutral-400">Institutional WhatsApp Signal Automation</p>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-neutral-900/90 border border-neutral-800 text-neutral-300">
            <Clock className="w-3.5 h-3.5 text-emerald-400" />
            <span className="font-mono">{currentTime || 'Asia/Karachi'}</span>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-950/40 border border-emerald-800/60 text-emerald-400 font-medium">
            <Radio className="w-3 h-3 text-emerald-400 animate-pulse" />
            <span>24/7 Engine Live</span>
          </div>
        </div>
      </header>

      {/* Center Authentication Card */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-md">
          {/* Main Card */}
          <div className="bg-neutral-900/80 backdrop-blur-xl border border-neutral-800/80 rounded-2xl p-7 sm:p-8 shadow-2xl shadow-black/80 ring-1 ring-white/5">
            {/* Header / Shield Icon */}
            <div className="text-center mb-6">
              <div className="inline-flex p-3 rounded-2xl bg-gradient-to-b from-emerald-500/20 to-teal-500/5 border border-emerald-500/30 text-emerald-400 mb-3 shadow-inner">
                <ShieldCheck className="w-7 h-7" />
              </div>
              <h1 className="text-2xl font-bold text-white tracking-tight">
                VIP System Access
              </h1>
              <p className="text-xs text-neutral-400 mt-1">
                Enter your administrative credentials to unlock the dashboard
              </p>
            </div>

            {/* Error Banner */}
            {error && (
              <div className="mb-5 p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-start gap-2.5 animate-in fade-in duration-200">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400 mt-0.5" />
                <span className="leading-relaxed font-medium">{error}</span>
              </div>
            )}

            {/* Login Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Username Field */}
              <div>
                <label
                  htmlFor="login-username"
                  className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400 mb-1.5"
                >
                  Administrator Username
                </label>
                <div className="relative">
                  <User className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="login-username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    required
                    autoComplete="username"
                    className="w-full pl-10 pr-4 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-white text-sm placeholder:text-neutral-600 focus:outline-hidden focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all font-medium"
                    placeholder="admin"
                  />
                </div>
              </div>

              {/* Password Field */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="login-password"
                    className="block text-[11px] font-semibold uppercase tracking-wider text-neutral-400"
                  >
                    Security Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="text-[11px] text-neutral-400 hover:text-neutral-200 flex items-center gap-1 transition-colors"
                  >
                    {showPassword ? (
                      <>
                        <EyeOff className="w-3 h-3" />
                        <span>Hide</span>
                      </>
                    ) : (
                      <>
                        <Eye className="w-3 h-3" />
                        <span>Show</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    className="w-full pl-10 pr-10 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-white text-sm placeholder:text-neutral-600 focus:outline-hidden focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all font-mono"
                    placeholder="••••••••••••"
                  />
                  <KeyRound className="w-4 h-4 text-neutral-600 absolute right-3.5 top-1/2 -translate-y-1/2" />
                </div>
              </div>

              {/* Remember Me & Autofill Row */}
              <div className="flex items-center justify-between pt-1 text-xs">
                <label className="flex items-center gap-2 cursor-pointer text-neutral-400 hover:text-neutral-300">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-3.5 h-3.5 rounded-sm bg-neutral-950 border-neutral-800 text-emerald-500 focus:ring-0 focus:ring-offset-0"
                  />
                  <span>Remember this browser</span>
                </label>

                <button
                  type="button"
                  onClick={handleAutofill}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  <Sparkles className="w-3 h-3" />
                  <span>Autofill Defaults</span>
                </button>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                id="login-submit-btn"
                disabled={loading}
                className="w-full mt-2 py-3 px-4 rounded-xl font-semibold text-sm text-neutral-950 bg-emerald-400 hover:bg-emerald-300 active:scale-[0.99] transition-all duration-150 shadow-lg shadow-emerald-950/60 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-neutral-950" />
                    <span>Verifying Security Clearance...</span>
                  </>
                ) : (
                  <>
                    <Lock className="w-4 h-4 text-neutral-950" />
                    <span>Unlock Bot Dashboard</span>
                  </>
                )}
              </button>
            </form>

            {/* Helper Credential Info Box */}
            <div className="mt-6 pt-5 border-t border-neutral-800/80 flex items-center justify-between text-xs text-neutral-400">
              <span className="text-[11px] text-neutral-500">
                Default Credentials: <code className="text-emerald-400 font-mono">admin</code> / <code className="text-emerald-400 font-mono">admin123456</code>
              </span>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-md bg-neutral-800/80 text-neutral-300">
                SHA-256
              </span>
            </div>
          </div>

          {/* Security Features Sub-Bar */}
          <div className="mt-4 px-2 flex items-center justify-between text-[11px] text-neutral-500">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
              <span>Session Encrypted & Protected</span>
            </div>
            <span>Auto-Logout on Token Expiry</span>
          </div>
        </div>
      </main>

      {/* Footer Info */}
      <footer className="relative z-10 w-full max-w-7xl mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between text-xs text-neutral-500 gap-2">
        <p>© 2026 WinGo 1M VIP System • Real-Time Automated Prediction Network</p>
        <p className="font-mono text-[11px] text-neutral-600">
          Karachi Standard Time (UTC+5) • 1-Minute Period Engine
        </p>
      </footer>
    </div>
  );
};

export default LoginPage;
