import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from './components/Navbar.js';
import { LoginModal } from './components/LoginModal.js';
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
import { AlertCircle, CheckCircle2, X } from 'lucide-react';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
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

  // Fetch initial authentication status with fallback auto-login
  useEffect(() => {
    api
      .getAuthStatus()
      .then(async (res) => {
        if (res.authenticated && res.user) {
          setCurrentUser(res.user);
        } else {
          try {
            const autoRes = await api.autoLogin();
            if (autoRes?.user) {
              setCurrentUser(autoRes.user);
            }
          } catch {
            // Admin password might have been customized, ignore silent failure
          }
        }
      })
      .catch(() => {});
  }, []);

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

  // Initial load and periodic polling
  useEffect(() => {
    // Initial full fetch
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
  }, [refreshAllData]);

  const handleLogout = async () => {
    try {
      await api.logout();
      setCurrentUser(null);
      showNotification('Logged out successfully.');
    } catch {
      setCurrentUser(null);
    }
  };

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
              className="text-neutral-400 hover:text-white transition-colors"
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

      {/* Admin Login Modal */}
      <LoginModal
        isOpen={isLoginOpen}
        onClose={() => setIsLoginOpen(false)}
        onSuccess={(user) => {
          setCurrentUser(user);
          showNotification(`Welcome back, ${user.username}!`);
          refreshAllData();
        }}
      />
    </div>
  );
};

export default App;
