import type {
  User,
  BotStatus,
  WhatsAppStatus,
  Signal,
  Statistics,
  AppSettings,
  WinGoStatus,
  DispatchResult,
  MessageTemplate,
  TemplatePreviewResult,
} from '../types/index.js';

class ApiService {
  private token: string | null = null;

  constructor() {
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        this.token = localStorage.getItem('wingo_auth_token');
      } catch {
        this.token = null;
      }
    }
  }

  public getToken(): string | null {
    if (!this.token && typeof window !== 'undefined' && window.localStorage) {
      try {
        this.token = localStorage.getItem('wingo_auth_token');
      } catch {
        this.token = null;
      }
    }
    return this.token;
  }

  public setToken(token: string | null): void {
    this.token = token;
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        if (token) {
          localStorage.setItem('wingo_auth_token', token);
        } else {
          localStorage.removeItem('wingo_auth_token');
        }
      } catch {
        // Ignore localStorage errors
      }
    }
  }

  private inFlightRequests: Map<string, Promise<any>> = new Map();

  private async request<T>(endpoint: string, options: RequestInit = {}, retryOn401 = true): Promise<T> {
    const method = (options.method || 'GET').toUpperCase();
    const isGet = method === 'GET';

    // For in-flight GET requests to identical endpoints, reuse pending Promise
    if (isGet && this.inFlightRequests.has(endpoint)) {
      return this.inFlightRequests.get(endpoint) as Promise<T>;
    }

    const requestPromise = this.executeRequest<T>(endpoint, options, retryOn401);

    if (isGet) {
      this.inFlightRequests.set(endpoint, requestPromise);
      requestPromise.finally(() => {
        this.inFlightRequests.delete(endpoint);
      });
    }

    return requestPromise;
  }

  private async executeRequest<T>(endpoint: string, options: RequestInit = {}, retryOn401 = true): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    const token = this.getToken();
    if (token && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(endpoint, {
      ...options,
      headers,
      credentials: 'include', // Include HTTP-only cookie if available
    });

    // If unauthorized and retry is permitted, attempt silent auto-login and retry once
    if (
      res.status === 401 &&
      retryOn401 &&
      endpoint !== '/api/auth/login' &&
      endpoint !== '/api/auth/auto-login' &&
      endpoint !== '/api/auth/logout'
    ) {
      try {
        const autoRes = await this.autoLogin();
        if (autoRes?.token) {
          return this.request<T>(endpoint, options, false);
        }
      } catch {
        // Auto-login failed, continue to standard error throw
      }
    }

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || `Request failed with status ${res.status}`);
    }

    return data as T;
  }

  // Auth
  async login(credentials: { username: string; password: string }): Promise<{ user: User; token: string }> {
    const res = await this.request<{ user: User; token: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(credentials),
    }, false);

    if (res.token) {
      this.setToken(res.token);
    }
    return res;
  }

  async autoLogin(): Promise<{ user: User; token: string }> {
    const res = await this.request<{ user: User; token: string }>('/api/auth/auto-login', {
      method: 'POST',
    }, false);

    if (res.token) {
      this.setToken(res.token);
    }
    return res;
  }

  async logout(): Promise<void> {
    try {
      await this.request('/api/auth/logout', { method: 'POST' }, false);
    } finally {
      this.setToken(null);
    }
  }

  async getAuthStatus(): Promise<{ authenticated: boolean; user?: User }> {
    try {
      const res = await this.request<{ authenticated: boolean; user?: User }>('/api/auth/status', {}, false);
      if (!res.authenticated && this.token) {
        this.setToken(null);
      }
      return res;
    } catch {
      return { authenticated: false };
    }
  }

  // WhatsApp
  async getWhatsAppStatus(): Promise<WhatsAppStatus> {
    return this.request('/api/whatsapp/status');
  }

  async pairWhatsApp(phoneNumber: string): Promise<{ pairingCode: string; message: string }> {
    return this.request('/api/whatsapp/pair', {
      method: 'POST',
      body: JSON.stringify({ phoneNumber }),
    });
  }

  async reconnectWhatsApp(): Promise<{ message: string }> {
    return this.request('/api/whatsapp/reconnect', { method: 'POST' });
  }

  async logoutWhatsApp(): Promise<void> {
    await this.request('/api/whatsapp/logout', { method: 'POST' });
  }

  async sendTestMessage(): Promise<{ destination: string; message: string }> {
    return this.request('/api/whatsapp/test-message', { method: 'POST' });
  }

  // Bot
  async getBotStatus(): Promise<BotStatus> {
    return this.request('/api/bot/status');
  }

  async getWingoStatus(): Promise<WinGoStatus> {
    return this.request('/api/bot/wingo-status');
  }

  async dispatchSignalNow(): Promise<DispatchResult> {
    return this.request('/api/bot/dispatch-now', { method: 'POST' });
  }

  async startBot(): Promise<{ status: BotStatus; message: string }> {
    return this.request('/api/bot/start', { method: 'POST' });
  }

  async stopBot(): Promise<{ status: BotStatus; message: string }> {
    return this.request('/api/bot/stop', { method: 'POST' });
  }

  // Signals
  async getSignals(status?: string, limit = 50): Promise<{ signals: Signal[]; count: number }> {
    const params = new URLSearchParams();
    if (status) params.append('status', status);
    params.append('limit', limit.toString());
    return this.request(`/api/signals?${params.toString()}`);
  }

  async getLatestSignal(): Promise<Signal | null> {
    return this.request('/api/signals/latest');
  }

  // Statistics
  async getStatistics(): Promise<Statistics> {
    return this.request('/api/statistics');
  }

  // Settings
  async getSettings(): Promise<AppSettings> {
    return this.request('/api/settings');
  }

  async updateSettings(settings: Partial<AppSettings>): Promise<{ success: boolean; message: string }> {
    return this.request('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
  }

  async saveChannel(newsletterJid: string): Promise<{ success: boolean; activeDestination: string; message: string }> {
    return this.request('/api/settings/channel', {
      method: 'POST',
      body: JSON.stringify({ newsletterJid }),
    });
  }

  async resolveChannelLink(link: string): Promise<{ success: boolean; jid: string; name?: string }> {
    return this.request('/api/settings/resolve-channel', {
      method: 'POST',
      body: JSON.stringify({ link }),
    });
  }

  async testWingoFeed(url?: string): Promise<{ success: boolean; status: WinGoStatus; count: number; sample: any[] }> {
    return this.request('/api/settings/test-wingo', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
  }

  // Environment & Runtime Database Management
  async getEnvironment(): Promise<{
    success: boolean;
    database: {
      isRealPostgres: boolean;
      type: string;
      connected: boolean;
      hasUrlConfigured: boolean;
      maskedUrl: string;
    };
    environment: Array<{
      key: string;
      label: string;
      value: string;
      rawConfigured: boolean;
      description: string;
      sensitive: boolean;
    }>;
    rawEnv: Record<string, string>;
  }> {
    return this.request('/api/settings/environment');
  }

  async updateDatabaseConnection(
    databaseUrl: string,
    ssl: boolean = true
  ): Promise<{ success: boolean; message: string; isRealPostgres: boolean }> {
    return this.request('/api/settings/database-connection', {
      method: 'POST',
      body: JSON.stringify({ databaseUrl, ssl }),
    });
  }

  async updateEnvironment(updates: Record<string, string>): Promise<{
    success: boolean;
    message: string;
    updated: string[];
  }> {
    return this.request('/api/settings/environment', {
      method: 'POST',
      body: JSON.stringify({ updates }),
    });
  }

  // Templates
  async getTemplates(): Promise<{ templates: MessageTemplate[] }> {
    return this.request('/api/templates');
  }

  async updateTemplate(
    key: string,
    template: string,
    enabled?: boolean
  ): Promise<{ success: boolean; message: string; template: MessageTemplate }> {
    return this.request(`/api/templates/${encodeURIComponent(key)}`, {
      method: 'PUT',
      body: JSON.stringify({ template, enabled }),
    });
  }

  async resetTemplate(
    key: string
  ): Promise<{ success: boolean; message: string; template: MessageTemplate }> {
    return this.request(`/api/templates/${encodeURIComponent(key)}/reset`, {
      method: 'POST',
    });
  }

  async previewTemplate(
    key: string,
    templateText?: string
  ): Promise<TemplatePreviewResult> {
    return this.request('/api/templates/preview', {
      method: 'POST',
      body: JSON.stringify({ key, templateText }),
    });
  }

  async sendTestTemplateMessage(): Promise<{ success: boolean; destination: string; messageId?: string; message: string }> {
    return this.request('/api/templates/send-test', {
      method: 'POST',
    });
  }

  // Sessions
  async getSessionStatus(): Promise<import('../types/index.js').SchedulerStatus> {
    return this.request('/api/sessions/status');
  }

  async getSessionConfigs(): Promise<import('../types/index.js').SessionConfig[]> {
    return this.request('/api/sessions/configs');
  }

  async createSessionConfig(
    data: Partial<import('../types/index.js').SessionConfig>
  ): Promise<{ success: boolean; config: import('../types/index.js').SessionConfig }> {
    return this.request('/api/sessions/configs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSessionConfig(
    id: number,
    data: Partial<import('../types/index.js').SessionConfig>
  ): Promise<{ success: boolean; config: import('../types/index.js').SessionConfig }> {
    return this.request(`/api/sessions/configs/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async toggleSessionConfig(
    id: number
  ): Promise<{ success: boolean; config: import('../types/index.js').SessionConfig }> {
    return this.request(`/api/sessions/configs/${id}/toggle`, {
      method: 'POST',
    });
  }

  async deleteSessionConfig(
    id: number
  ): Promise<{ success: boolean; message: string }> {
    return this.request(`/api/sessions/configs/${id}`, {
      method: 'DELETE',
    });
  }

  async getSessionHistory(params?: {
    range?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
  }): Promise<import('../types/index.js').BotSession[]> {
    const q = new URLSearchParams();
    if (params?.range) q.set('range', params.range);
    if (params?.startDate) q.set('startDate', params.startDate);
    if (params?.endDate) q.set('endDate', params.endDate);
    if (params?.status) q.set('status', params.status);
    const qs = q.toString() ? `?${q.toString()}` : '';
    return this.request(`/api/sessions/history${qs}`);
  }

  async getSessionDetails(
    id: number
  ): Promise<{ session: import('../types/index.js').BotSession; signals: Signal[] }> {
    return this.request(`/api/sessions/${id}`);
  }

  async startSessions(): Promise<{ success: boolean; scheduleEnabled: boolean; message: string; status: import('../types/index.js').SchedulerStatus }> {
    return this.request('/api/sessions/start-sessions', {
      method: 'POST',
    });
  }

  async stopSessions(): Promise<{ success: boolean; scheduleEnabled: boolean; message: string; status: import('../types/index.js').SchedulerStatus }> {
    return this.request('/api/sessions/stop-sessions', {
      method: 'POST',
    });
  }

  async startSchedule(): Promise<{ success: boolean; scheduleEnabled: boolean; message: string; status: import('../types/index.js').SchedulerStatus }> {
    return this.startSessions();
  }

  async stopSchedule(): Promise<{ success: boolean; scheduleEnabled: boolean; message: string; status: import('../types/index.js').SchedulerStatus }> {
    return this.stopSessions();
  }

  async toggleSchedule(
    enabled?: boolean
  ): Promise<{ success: boolean; scheduleEnabled: boolean; message: string; status?: import('../types/index.js').SchedulerStatus }> {
    return this.request('/api/sessions/toggle-schedule', {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    });
  }

  async startSessionNow(
    configId?: number
  ): Promise<{ success: boolean; message: string; session: import('../types/index.js').BotSession }> {
    return this.request('/api/sessions/start-now', {
      method: 'POST',
      body: JSON.stringify({ configId }),
    });
  }

  async stopSession(): Promise<{ success: boolean; message: string }> {
    return this.request('/api/sessions/stop', {
      method: 'POST',
    });
  }

  async startManualSession(
    configId?: number
  ): Promise<{ success: boolean; message: string; session: import('../types/index.js').BotSession }> {
    return this.request('/api/sessions/start-manual', {
      method: 'POST',
      body: JSON.stringify({ configId }),
    });
  }

  async stopManualSession(): Promise<{ success: boolean; message: string }> {
    return this.request('/api/sessions/stop-manual', {
      method: 'POST',
    });
  }

  async completeSessionTarget(): Promise<{ success: boolean; message: string }> {
    return this.request('/api/sessions/complete-target', {
      method: 'POST',
    });
  }

  async broadcastSessionHistory(params?: {
    sessionId?: number;
    filter?: string;
  }): Promise<{ success: boolean; message: string; renderedMessage: string }> {
    return this.request('/api/sessions/broadcast-history', {
      method: 'POST',
      body: JSON.stringify(params || {}),
    });
  }

  // Pre-Session Reminders
  async getReminderSettings(): Promise<import('../types/index.js').ReminderSettings> {
    return this.request('/api/reminders/settings');
  }

  async updateReminderSettings(data: {
    enabled?: boolean;
    minutesBefore?: number;
    websiteUrl?: string;
    template?: string;
  }): Promise<{ success: boolean; message: string; settings: import('../types/index.js').ReminderSettings }> {
    return this.request('/api/reminders/settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async resetReminderTemplate(): Promise<{ success: boolean; message: string; settings: import('../types/index.js').ReminderSettings }> {
    return this.request('/api/reminders/reset-template', {
      method: 'POST',
    });
  }

  async sendTestReminder(): Promise<{
    success: boolean;
    destination: string;
    messageId?: string;
    renderedMessage: string;
    message: string;
  }> {
    return this.request('/api/reminders/send-test', {
      method: 'POST',
    });
  }

  async getReminderHistory(limit = 50): Promise<import('../types/index.js').SessionReminderRecord[]> {
    return this.request(`/api/reminders/history?limit=${limit}`);
  }

  // System Diagnostics & Health (Render + Supabase Status)
  async getHealth(): Promise<{
    status: string;
    timestamp: string;
    uptimeSeconds: number;
    database: { connected: boolean; type: string; isRealPostgres: boolean };
    whatsapp: { status: string; isRegistered: boolean; phoneNumber?: string };
    bot: { running: boolean; mode: string; lastIssue?: string };
    platform: { isRender: boolean; externalUrl: string | null };
  }> {
    return this.request('/health');
  }
}

export const api = new ApiService();

