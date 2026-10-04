import React, { useState, useEffect } from 'react';
import {
  Smartphone,
  KeyRound,
  RefreshCw,
  LogOut,
  Send,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  Loader2,
  ShieldAlert,
  QrCode,
  Trash2,
  MessageSquare,
  Save,
} from 'lucide-react';
import { api } from '../services/api.js';
import { copyTextToClipboard } from '../utils/clipboard.js';
import type { WhatsAppStatus, User } from '../types/index.js';

interface WhatsAppPageProps {
  whatsAppStatus: WhatsAppStatus | null;
  activeDestination: string | null;
  currentUser?: User | null;
  onOpenLogin?: () => void;
  onLoginSuccess?: (user: User) => void;
  onRefreshStatus: () => void;
  onNotification: (msg: string, isError?: boolean) => void;
}

export const WhatsAppPage: React.FC<WhatsAppPageProps> = ({
  whatsAppStatus,
  activeDestination,
  currentUser,
  onOpenLogin,
  onLoginSuccess,
  onRefreshStatus,
  onNotification,
}) => {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [channelJidInput, setChannelJidInput] = useState(activeDestination || '');
  const [savingChannel, setSavingChannel] = useState(false);
  const [linkMode, setLinkMode] = useState<'qr' | 'code'>('qr');
  const [pairingLoading, setPairingLoading] = useState(false);
  const [reconnectLoading, setReconnectLoading] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [testLoading, setTestLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [autoLoggingIn, setAutoLoggingIn] = useState(false);

  useEffect(() => {
    if (activeDestination) {
      setChannelJidInput(activeDestination);
    }
  }, [activeDestination]);

  const isConnected = whatsAppStatus?.status === 'connected';
  const isPairing = whatsAppStatus?.status === 'pairing';
  const pairingCode = whatsAppStatus?.pairingCode;
  const qrCodeData = whatsAppStatus?.qrCode;

  // Auto-poll WhatsApp status every 3.5s while waiting for pairing verification
  useEffect(() => {
    if (!isConnected && (pairingCode || isPairing || whatsAppStatus?.status === 'connecting')) {
      const pollTimer = setInterval(() => {
        onRefreshStatus();
      }, 3500);
      return () => clearInterval(pollTimer);
    }
  }, [isConnected, pairingCode, isPairing, whatsAppStatus?.status, onRefreshStatus]);

  const handleQuickLogin = async () => {
    setAutoLoggingIn(true);
    try {
      const res = await api.autoLogin();
      if (res?.user && onLoginSuccess) {
        onLoginSuccess(res.user);
        onNotification(`Authenticated successfully as ${res.user.username}`);
      }
    } catch {
      if (onOpenLogin) onOpenLogin();
    } finally {
      setAutoLoggingIn(false);
    }
  };

  const handleGeneratePairingCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber.trim()) {
      onNotification('Please enter a valid phone number with country code.', true);
      return;
    }

    setPairingLoading(true);
    try {
      // Ensure authenticated before requesting pairing code
      if (!currentUser && !api.getToken()) {
        try {
          const autoRes = await api.autoLogin();
          if (autoRes?.user && onLoginSuccess) {
            onLoginSuccess(autoRes.user);
          }
        } catch {
          onNotification('Admin authentication required. Please sign in as Admin.', true);
          if (onOpenLogin) onOpenLogin();
          setPairingLoading(false);
          return;
        }
      }

      const res = await api.pairWhatsApp(phoneNumber.trim());
      onNotification(`Pairing code generated: ${res.pairingCode}`);
      onRefreshStatus();
    } catch (err: any) {
      if (err.message && err.message.includes('Unauthorized')) {
        onNotification('Admin authentication required. Please sign in to pair WhatsApp.', true);
        if (onOpenLogin) onOpenLogin();
      } else {
        onNotification(err.message || 'Failed to generate pairing code', true);
      }
    } finally {
      setPairingLoading(false);
    }
  };

  const handleCopyCode = async () => {
    if (!pairingCode) return;
    try {
      const success = await copyTextToClipboard(pairingCode);
      setCopied(true);
      if (success) {
        onNotification(`Pairing code "${pairingCode}" copied to clipboard!`);
      } else {
        onNotification(`Pairing code: ${pairingCode} (selected for copying)`);
      }
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(true);
      onNotification(`Pairing code: ${pairingCode}`);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleReconnect = async () => {
    setReconnectLoading(true);
    try {
      await api.reconnectWhatsApp();
      onNotification('WhatsApp reconnection initiated.');
      onRefreshStatus();
    } catch (err: any) {
      onNotification(err.message || 'Reconnect failed', true);
    } finally {
      setReconnectLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!window.confirm('Are you sure you want to disconnect and log out of WhatsApp?')) return;
    setLogoutLoading(true);
    try {
      await api.logoutWhatsApp();
      onNotification('WhatsApp session logged out.');
      onRefreshStatus();
    } catch (err: any) {
      onNotification(err.message || 'Logout failed', true);
    } finally {
      setLogoutLoading(false);
    }
  };

  const handleSendTestMessage = async () => {
    setTestLoading(true);
    try {
      const res = await api.sendTestMessage();
      onNotification(res.message);
    } catch (err: any) {
      onNotification(err.message || 'Test message failed', true);
    } finally {
      setTestLoading(false);
    }
  };

  const handleSaveChannel = async () => {
    const trimmed = channelJidInput.trim();
    if (!trimmed) {
      onNotification('Please enter a WhatsApp Channel JID ending in @newsletter', true);
      return;
    }
    if (!trimmed.endsWith('@newsletter')) {
      onNotification('Invalid JID. WhatsApp Channel destination must end with @newsletter', true);
      return;
    }
    setSavingChannel(true);
    try {
      const res = await api.saveChannel(trimmed);
      onNotification(res.message || `Channel destination saved: ${trimmed}`);
      onRefreshStatus();
    } catch (err: any) {
      onNotification(err.message || 'Failed to save channel destination', true);
    } finally {
      setSavingChannel(false);
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header & Status Card */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`p-3 rounded-2xl border ${
                isConnected
                  ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                  : isPairing
                  ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                  : 'bg-neutral-800 border-neutral-700 text-neutral-400'
              }`}
            >
              <Smartphone className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white tracking-tight">WhatsApp Connection</h2>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider ${
                    isConnected
                      ? 'bg-emerald-950/80 border border-emerald-800 text-emerald-400'
                      : isPairing
                      ? 'bg-amber-950/80 border border-amber-800 text-amber-400'
                      : 'bg-neutral-800 text-neutral-400'
                  }`}
                >
                  {whatsAppStatus?.status || 'disconnected'}
                </span>
              </div>
              <p className="text-xs text-neutral-400 mt-0.5">
                {isConnected
                  ? `Authenticated session (${whatsAppStatus?.phoneNumber || 'Active Device'})`
                  : 'Requires phone number pairing code authentication (no QR code needed)'}
              </p>
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleReconnect}
              disabled={reconnectLoading}
              className="inline-flex items-center gap-1.5 px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-xl text-xs font-medium border border-neutral-700 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${reconnectLoading ? 'animate-spin' : ''}`} />
              <span>Reconnect</span>
            </button>
            {isConnected && (
              <button
                onClick={handleLogout}
                disabled={logoutLoading}
                className="inline-flex items-center gap-1.5 px-3 py-2 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 rounded-xl text-xs font-medium border border-rose-500/30 transition-colors disabled:opacity-50"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Logout</span>
              </button>
            )}
          </div>
        </div>

        {whatsAppStatus?.lastError && !isConnected && (
          <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 shrink-0 text-amber-400" />
              <span>
                <strong>Connection Notice:</strong>{' '}
                {whatsAppStatus.lastError.includes('Connection Closed')
                  ? 'The temporary pairing socket timed out or was closed by WhatsApp servers. Click "Generate Pairing Code" to instantly issue a fresh pairing code.'
                  : whatsAppStatus.lastError}
              </span>
            </div>
            <button
              onClick={handleReconnect}
              disabled={reconnectLoading}
              className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs rounded-lg font-semibold shrink-0 transition-colors"
            >
              Retry Connection
            </button>
          </div>
        )}
      </div>

      {/* WhatsApp Device Pairing Section */}
      {!isConnected ? (
        <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl">
          <div className="max-w-xl">
            {/* Header and Toggle */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
              <div>
                <div className="flex items-center gap-2 text-white font-bold text-base mb-1">
                  <Smartphone className="w-4 h-4 text-emerald-400" />
                  <span>Link WhatsApp Device</span>
                </div>
                <p className="text-xs text-neutral-400">
                  Choose how you want to link your WhatsApp account to the automated signal bot.
                </p>
              </div>

              {/* Mode Selector */}
              <div className="flex items-center p-1 bg-neutral-950 border border-neutral-800 rounded-xl self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setLinkMode('qr')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    linkMode === 'qr'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>Scan QR Code</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLinkMode('code')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                    linkMode === 'code'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-neutral-400 hover:text-white'
                  }`}
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Phone Number Code</span>
                </button>
              </div>
            </div>

            {/* Auth status indicator / Quick Login */}
            {!currentUser ? (
              <div className="mb-5 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-amber-200 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Admin session required to initiate WhatsApp device pairing.</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleQuickLogin}
                    disabled={autoLoggingIn}
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-neutral-950 font-bold text-xs rounded-lg transition-all shadow-xs flex items-center gap-1.5"
                  >
                    {autoLoggingIn && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    <span>1-Click Admin Sign In</span>
                  </button>
                  <button
                    type="button"
                    onClick={onOpenLogin}
                    className="px-2.5 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs rounded-lg border border-neutral-700 transition-colors"
                  >
                    Custom Credentials
                  </button>
                </div>
              </div>
            ) : (
              <div className="mb-4 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Authorized as Administrator ({currentUser.username})</span>
              </div>
            )}

            {/* TAB 1: QR CODE */}
            {linkMode === 'qr' && (
              <div className="space-y-4">
                <div className="p-6 bg-neutral-950 border border-neutral-800 rounded-2xl text-center">
                  {qrCodeData ? (
                    <div className="space-y-4">
                      <div className="inline-block p-4 bg-white rounded-2xl shadow-2xl">
                        <img
                          src={qrCodeData}
                          alt="WhatsApp QR Code"
                          className="w-56 h-56 mx-auto rounded-lg object-contain"
                        />
                      </div>
                      <div className="flex items-center justify-center gap-2 text-xs text-emerald-400 font-medium">
                        <span className="relative flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                        </span>
                        <span>Live QR code active — scan with your phone camera</span>
                      </div>
                    </div>
                  ) : (
                    <div className="py-8 space-y-4">
                      <div className="w-16 h-16 mx-auto rounded-2xl bg-neutral-900 border border-neutral-800 flex items-center justify-center text-emerald-400">
                        <QrCode className="w-8 h-8" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold text-white mb-1">Instant QR Code Pairing</h4>
                        <p className="text-xs text-neutral-400 max-w-sm mx-auto">
                          Scan directly with WhatsApp on your phone for instant, 100% reliable connection.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleReconnect}
                        disabled={reconnectLoading}
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-semibold transition-all shadow-md active:scale-95 disabled:opacity-50"
                      >
                        {reconnectLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4" />
                        )}
                        <span>Show WhatsApp QR Code</span>
                      </button>
                    </div>
                  )}

                  <div className="space-y-1.5 text-xs text-neutral-400 mt-4 border-t border-neutral-800/80 pt-4 text-left">
                    <p className="font-semibold text-neutral-300">How to link with QR Code:</p>
                    <p>1. Open WhatsApp on your phone.</p>
                    <p>2. Tap <strong>Settings</strong> (or three dots) &gt; <strong>Linked Devices</strong>.</p>
                    <p>3. Tap <strong>Link a Device</strong> and point your camera at this QR code.</p>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: PHONE NUMBER PAIRING CODE */}
            {linkMode === 'code' && (
              <div className="space-y-4">
                <form onSubmit={handleGeneratePairingCode} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-400 mb-1.5">
                      Phone Number (with Country Code)
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="wa-phone-input"
                        type="tel"
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        placeholder="e.g. 923001234567"
                        disabled={pairingLoading}
                        className="flex-1 px-4 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-white text-sm font-mono focus:outline-hidden focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
                      />
                      <button
                        id="generate-pairing-code-btn"
                        type="submit"
                        disabled={pairingLoading}
                        className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-semibold transition-all shadow-md active:scale-95 disabled:opacity-50 whitespace-nowrap"
                      >
                        {pairingLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                        <span>Generate Pairing Code</span>
                      </button>
                    </div>
                  </div>
                </form>

                {/* Display Generated Pairing Code */}
                {pairingCode && (
                  <div className="p-6 rounded-2xl bg-neutral-950 border-2 border-emerald-500/50 shadow-2xl relative overflow-hidden">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                        <KeyRound className="w-4 h-4" />
                        <span>Your WhatsApp Pairing Code</span>
                      </span>
                      <span className="text-[11px] font-medium text-emerald-400 bg-emerald-950/80 border border-emerald-800/60 px-2.5 py-0.5 rounded-full">
                        Tap code or button to copy
                      </span>
                    </div>

                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 my-3">
                      <div
                        onClick={handleCopyCode}
                        title="Click anywhere to copy pairing code"
                        className="flex-1 px-6 py-4 bg-neutral-900 hover:bg-neutral-850 hover:border-emerald-500/60 border border-neutral-800 rounded-xl text-3xl sm:text-4xl font-black font-mono tracking-widest text-emerald-300 select-all shadow-lg text-center cursor-pointer transition-all flex items-center justify-center group active:scale-[0.99]"
                      >
                        <span className="group-hover:text-emerald-200 transition-colors">{pairingCode}</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleCopyCode}
                        className={`inline-flex items-center justify-center gap-2.5 px-6 py-4 rounded-xl text-sm font-bold tracking-wide transition-all shadow-md active:scale-95 cursor-pointer ${
                          copied
                            ? 'bg-emerald-500 text-neutral-950 border border-emerald-400'
                            : 'bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500/40'
                        }`}
                        title="Copy pairing code to clipboard"
                      >
                        {copied ? (
                          <>
                            <Check className="w-5 h-5 text-neutral-950 stroke-[3]" />
                            <span>COPIED!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-5 h-5" />
                            <span>COPY CODE</span>
                          </>
                        )}
                      </button>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-emerald-300 mb-3 bg-emerald-950/60 border border-emerald-800/40 px-3.5 py-2.5 rounded-xl">
                      <span className="relative flex h-2.5 w-2.5 shrink-0">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                      </span>
                      <span>Active socket waiting — enter this code in WhatsApp on your phone now. Dashboard will connect automatically!</span>
                    </div>

                    <div className="space-y-1.5 text-xs text-neutral-400 mt-4 border-t border-neutral-800/80 pt-4">
                      <p className="font-semibold text-neutral-200">How to enter code on WhatsApp:</p>
                      <p>1. Open WhatsApp on your smartphone.</p>
                      <p>2. Go to <strong>Settings</strong> &gt; <strong>Linked Devices</strong>.</p>
                      <p>3. Tap <strong>Link a Device</strong>, then select <strong>Link with phone number instead</strong> at the bottom.</p>
                      <p>4. Enter the code above. The bot will automatically authenticate and remain active.</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Clear Session / Reset Button */}
            <div className="mt-6 pt-4 border-t border-neutral-800/60 flex items-center justify-between">
              <span className="text-xs text-neutral-500">Having linking issues?</span>
              <button
                type="button"
                onClick={handleLogout}
                disabled={logoutLoading}
                className="text-xs text-red-400/80 hover:text-red-300 flex items-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Reset WhatsApp Session Cache</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* Connected Status Detail */
        <div className="bg-emerald-950/20 border border-emerald-800/40 rounded-2xl p-6 shadow-xl flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            <div>
              <h3 className="text-sm font-bold text-white">WhatsApp Session is Active</h3>
              <p className="text-xs text-neutral-400">
                Credentials are secure and persisted in local storage. The bot is ready to broadcast signals.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Target WhatsApp Channel Configuration Card */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl space-y-4">
        <div>
          <h3 className="text-base font-bold text-white flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-emerald-400" />
            <span>Target WhatsApp Channel Destination</span>
          </h3>
          <p className="text-xs text-neutral-400 mt-1">
            Configure the WhatsApp Newsletter Channel where all signals, WIN alerts, and session summaries are broadcasted.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            id="wa-page-newsletter-input"
            type="text"
            value={channelJidInput}
            onChange={(e) => setChannelJidInput(e.target.value)}
            placeholder="120363411395110604@newsletter"
            className="flex-1 px-4 py-2.5 bg-neutral-950 border border-neutral-800 rounded-xl text-white font-mono text-sm focus:outline-hidden focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-colors"
          />
          <button
            id="wa-page-save-channel-btn"
            type="button"
            onClick={handleSaveChannel}
            disabled={savingChannel || !channelJidInput.trim()}
            className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all shadow-md active:scale-95 disabled:opacity-50 shrink-0"
          >
            {savingChannel ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            <span>Save Channel</span>
          </button>
        </div>

        {activeDestination ? (
          <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-400 text-xs flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>Active Target: <strong className="font-mono">{activeDestination}</strong></span>
            </div>
            <span className="text-[11px] bg-emerald-500/20 px-2 py-0.5 rounded-md font-semibold">Ready to Broadcast</span>
          </div>
        ) : (
          <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>Enter your Channel ID ending in <code className="font-mono text-amber-300">@newsletter</code> and click <strong>Save Channel</strong>.</span>
          </div>
        )}
      </div>

      {/* Test Message Section */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 shadow-xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-white flex items-center gap-2">
              <Send className="w-4 h-4 text-emerald-400" />
              <span>Send Test Message to Active Newsletter</span>
            </h3>
            <p className="text-xs text-neutral-400 mt-1">
              Dispatches a test message exclusively to the configured Newsletter channel (
              <span className="font-mono text-emerald-400">{activeDestination || 'Not configured'}</span>
              ).
            </p>
          </div>

          <button
            id="send-test-message-btn"
            onClick={handleSendTestMessage}
            disabled={testLoading || !isConnected || !activeDestination}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl text-sm font-semibold border border-neutral-700 transition-all shadow-md active:scale-95 disabled:opacity-50 whitespace-nowrap"
          >
            {testLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            <span>Send Test Message</span>
          </button>
        </div>
      </div>
    </div>
  );
};
