import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar.js';
import { LoginModal } from './components/LoginModal.js';
import { LoginPage } from './pages/LoginPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { WhatsAppPage } from './pages/WhatsAppPage.js';
import { SignalsPage } from './pages/SignalsPage.js';
import { StatisticsPage } from './pages/StatisticsPage.js';
import { SettingsPage } from './pages/SettingsPage.js';
import { TemplatesPage } from './pages/TemplatesPage.js';
import { SessionsPage } from './pages/SessionsPage.js';
import { api } from './services/api.js';
import type {
  BotStatus,
  WhatsAppStatus,
  Signal,
  Statistics,
  AppSettings,
  User,
} from './types/index.js';
import { AlertCircle, CheckCircle2, X, Bot, Loader2 } from 'lucide-react';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [isLoginOpen, setIsLoginOpen] = useState(false);

  // Core Data States
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);
  const [whatsAppStatus, setWhatsAppStatus] = useState<WhatsAppStatus | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [statistics, setStatistics] = useState<Statistics | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);

  // Notification Toast
  const [notification, setNotification] = useState<{
    message: string;
    isError?: boolean;
  } | null>(null);

  const showNotification = useCallback((message: string, isError = false) => {
    setNotification({ message, isError });
    setTimeout(() => {
      setNotification((curr) => (curr?.message === message ? null : curr));
    }, 5000);
  }, []);

  // Fetch initial authentication status strictly without automatic login
  useEffect(() => {
    let isMounted = true;
    api
      .getAuthStatus()
      .then((res) => {
        if (!isMounted) return;
        if (res.authenticated && res.user) {
          setCurrentUser(res.user);
        } else {
          setCurrentUser(null);
        }
      })
      .catch(() => {
        if (isMounted) setCurrentUser(null);
      })
      .finally(() => {
        if (isMounted) setIsCheckingAuth(false);
      });

    // Listen for unauthorized events across the app to return to login screen
    const handleUnauthorized = () => {
      setCurrentUser(null);
      showNotification('Session locked or expired. Please sign in.', true);
    };

    window.addEventListener('wingo_unauthorized', handleUnauthorized);
    return () => {
      isMounted = false;
      window.removeEventListener('wingo_unauthorized', handleUnauthorized);
    };
  }, [showNotification]);

  // Polling Function to sync real-time bot and WhatsApp state
  const refreshAllData = useCallback(async (includeFull = false) => {
    try {
      const promises: Promise<any>[] = [
        api.getBotStatus(),
        api.getWhatsAppStatus(),
      ];
      if (includeFull) {
        promises.push(
          api.getSignals(undefined, 50),
          api.getStatistics(),
          api.getSettings()
        );
      }

      const results = await Promise.allSettled(promises);
      if (results[0].status === 'fulfilled') setBotStatus(results[0].value || null);
      if (results[1].status === 'fulfilled') setWhatsAppStatus(results[1].value || null);

      if (includeFull) {
        if (results[2]?.status === 'fulfilled') {
          const sigsData = results[2].value;
          setSignals(Array.isArray(sigsData?.signals) ? sigsData.signals : Array.isArray(sigsData) ? sigsData : []);
        }
        if (results[3]?.status === 'fulfilled') setStatistics(results[3].value || null);
        if (results[4]?.status === 'fulfilled') setSettings(results[4].value || null);
      }
    } catch {
      // Periodic poll error
    }
  }, []);

  // Initial load and periodic polling when authenticated
  useEffect(() => {
    if (!currentUser) return;

    // Initial full fetch upon login
    refreshAllData(true);

    // Heartbeat poll for core status badges every 5 seconds
    const heartbeatInterval = setInterval(() => {
      refreshAllData(false);
    }, 5000);

    // Telemetry & signals poll every 12 seconds
    const telemetryInterval = setInterval(() => {
      refreshAllData(true);
    }, 12000);

    return () => {
      clearInterval(heartbeatInterval);
      clearInterval(telemetryInterval);
    };
  }, [currentUser, refreshAllData]);

  const handleLogout = async () => {
    try {
      await api.logout();
      api.setToken(null);
      setCurrentUser(null);
      showNotification('Logged out successfully. Terminal locked.');
    } catch {
      api.setToken(null);
      setCurrentUser(null);
    }
  };

  // 1. Initial Verification Screen
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center text-white px-4 select-none">
        <div className="relative mb-5">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 flex items-center justify-center shadow-2xl shadow-emerald-950/80 ring-1 ring-emerald-400/40 animate-pulse">
            <Bot className="w-8 h-8 text-white" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center border-2 border-neutral-950">
            <Loader2 className="w-3 h-3 text-neutral-950 animate-spin" />
          </div>
        </div>
        <div className="text-center">
          <h2 className="text-base font-bold text-white tracking-tight">WinGo 1M VIP Engine</h2>
          <p className="text-xs text-neutral-400 mt-1 font-mono">Verifying Session Security Clearance...</p>
        </div>
      </div>
    );
  }

  // 2. Unauthenticated Gate: Show Professional Login Page First
  if (!currentUser) {
    return (
      <>
        {notification && (
          <div className="fixed top-5 right-5 z-50 max-w-md animate-in fade-in slide-in-from-top-5 duration-200">
            <div
              className={`p-4 rounded-2xl border shadow-2xl flex items-start gap-3 ${
                notification.isError
                  ? 'bg-rose-950/90 border-rose-800 text-rose-200'
                  : 'bg-emerald-950/90 border-emerald-800 text-emerald-200'
              }`}
            >
              {notification.isError ? (
                <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
              ) : (
                <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
              )}
              <div className="flex-1 text-xs font-medium leading-relaxed">
                {notification.message}
              </div>
              <button
                onClick={() => setNotification(null)}
                className="text-neutral-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
        <LoginPage
          onLoginSuccess={(user) => {
            setCurrentUser(user);
            showNotification(`Access Granted: Welcome back, ${user.username}!`);
          }}
        />
      </>
    );
  }

  // 3. Authenticated: Full VIP Bot Dashboard
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col font-sans selection:bg-emerald-500/30 selection:text-emerald-300">
      {/* Top Navigation Bar */}
      <Navbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        botStatus={botStatus}
        whatsAppStatus={whatsAppStatus}
        activeDestination={settings?.activeDestination || null}
        currentUser={currentUser}
        onStatusChange={(newStatus) => {
          setBotStatus(newStatus);
          refreshAllData();
        }}
        onError={(err) => showNotification(err, true)}
        onOpenLogin={() => setIsLoginOpen(true)}
        onLogout={handleLogout}
      />

      {/* Floating Notification Toast */}
      {notification && (
        <div className="fixed bottom-5 right-5 z-50 max-w-md animate-in fade-in slide-in-from-bottom-5 duration-200">
          <div
            className={`p-4 rounded-2xl border shadow-2xl flex items-start gap-3 ${
              notification.isError
                ? 'bg-rose-950/90 border-rose-800 text-rose-200'
                : 'bg-emerald-950/90 border-emerald-800 text-emerald-200'
            }`}
          >
            {notification.isError ? (
              <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
            ) : (
              <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
            )}
            <div className="flex-1 text-xs font-medium leading-relaxed">
              {notification.message}
            </div>
            <button
              onClick={() => setNotification(null)}
              className="text-neutral-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {activeTab === 'dashboard' && (
          <DashboardPage
            botStatus={botStatus}
            whatsAppStatus={whatsAppStatus}
            activeDestination={settings?.activeDestination || null}
            signals={signals}
            statistics={statistics}
            onNavigateToWhatsApp={() => setActiveTab('whatsapp')}
            onNavigateToSettings={() => setActiveTab('settings')}
            onNavigateToSessions={() => setActiveTab('sessions')}
            onRefreshAll={refreshAllData}
            onNotification={showNotification}
          />
        )}

        {activeTab === 'sessions' && (
          <SessionsPage
            currentUser={currentUser}
            onOpenLogin={() => setIsLoginOpen(true)}
            onNotification={showNotification}
          />
        )}

        {activeTab === 'whatsapp' && (
          <WhatsAppPage
            whatsAppStatus={whatsAppStatus}
            activeDestination={settings?.activeDestination || null}
            currentUser={currentUser}
            onOpenLogin={() => setIsLoginOpen(true)}
            onLoginSuccess={(user) => {
              setCurrentUser(user);
              refreshAllData();
            }}
            onRefreshStatus={refreshAllData}
            onNotification={showNotification}
          />
        )}

        {activeTab === 'signals' && <SignalsPage signals={signals} />}

        {activeTab === 'templates' && (
          <TemplatesPage
            settings={settings}
            whatsAppStatus={whatsAppStatus}
            onNotification={showNotification}
          />
        )}

        {activeTab === 'statistics' && <StatisticsPage statistics={statistics} />}

        {activeTab === 'settings' && (
          <SettingsPage
            settings={settings}
            onRefreshSettings={refreshAllData}
            onNotification={showNotification}
          />
        )}
      </main>

      {/* Admin Login Modal (for in-page re-authentication if token refreshed) */}
      <LoginModal
        isOpen={isLoginOpen}
        onClose={() => setIsLoginOpen(false)}
        onSuccess={(user) => {
          setCurrentUser(user);
          showNotification(`Authenticated as ${user.username}!`);
          refreshAllData();
        }}
      />
    </div>
  );
};

export default App;
