import { query } from '../db/index.js';
import { logger } from './logger.js';

export interface MessageTemplate {
  key: string;
  name: string;
  template: string;
  enabled: boolean;
  updated_at?: string;
}

export const DEFAULT_TEMPLATES: Record<string, { name: string; template: string }> = {
  SIGNAL: {
    name: 'Signal Message',
    template: `🎯 WinGo 1M Signal
━━━━━━━━━━━━━━━━
📊 Period: {issueNumber}
🎲 Prediction: {prediction}
🎨 Color: {color}
📈 Confidence: {confidence}%
⏱️ Time: {time}
━━━━━━━━━━━━━━━━
⚠️ Play responsibly`,
  },
  WIN: {
    name: 'WIN Result Message',
    template: `✅ WIN!
Period: {issueNumber}
Result: {resultNumber} ({resultSize}, {resultColor})
Our Signal: {predictionSize} {predictionColor} ✅`,
  },
  LOSS: {
    name: 'LOSS Result Message',
    template: `❌ LOSS
Period: {issueNumber}
Result: {resultNumber} ({resultSize}, {resultColor})
Our Signal: {predictionSize} {predictionColor} ❌`,
  },
  TEST: {
    name: 'Test Message',
    template: `🧪 TEST MESSAGE
━━━━━━━━━━━━━━━━
📊 Period: {issueNumber}
🎲 Prediction: {prediction}
🎨 Color: {color}
📈 Confidence: {confidence}%
⏱️ Time: {time}
━━━━━━━━━━━━━━━━`,
  },
  TARGET_COMPLETE: {
    name: 'Session Target Completed',
    template: `🎯 TARGET COMPLETED!
━━━━━━━━━━━━━━━━
🏆 Target: {targetWins} WIN
✅ Wins: {wins}
❌ Losses: {losses}

📊 The session target has been successfully completed.

⏳ Session history will be sent shortly.

━━━━━━━━━━━━━━━━`,
  },
  SESSION_HISTORY: {
    name: 'Session History Summary',
    template: `📋 SESSION HISTORY
━━━━━━━━━━━━━━━━
⏰ Session: {sessionName}
🕐 Time: {startTime} → {endTime}

Total Predictions: {totalSignals}

✅ WIN: {wins}
❌ LOSS: {losses}

📈 Win Rate: {winRate}%

━━━━━━━━━━━━━━━━
🏆 Target: {targetWins} WIN
🎯 Status: {status}
━━━━━━━━━━━━━━━━

{signalsList}`,
  },
  REMINDER: {
    name: 'Pre-Session Reminder',
    template: `🔔 SESSION STARTING SOON
━━━━━━━━━━━━━━━━
💰 PREPARE YOUR FUNDS

Your next WinGo session will start in {minutes_remaining} minutes.

⏰ Session: {session_time}
🎯 Target: {target} WIN

🌐 Website:
{website_link}

Please prepare your funds and be ready.

━━━━━━━━━━━━━━━━
⚠️ Play responsibly.`,
  },
};

export interface TemplateVariables {
  issueNumber?: string | number;
  prediction?: string;
  size?: string;
  color?: string;
  confidence?: string | number;
  time?: string;
  date?: string;
  resultNumber?: string | number;
  resultSize?: string;
  resultColor?: string;
  predictionSize?: string;
  predictionColor?: string;
  status?: string;
  targetWins?: string | number;
  wins?: string | number;
  losses?: string | number;
  totalSignals?: string | number;
  winRate?: string | number;
  actual_total?: string | number;
  actual_win_count?: string | number;
  actual_loss_count?: string | number;
  actual_win_rate?: string | number;
  sessionName?: string;
  session_name?: string;
  startTime?: string;
  start_time?: string;
  endTime?: string;
  completion_time?: string;
  session_time?: string;
  sessionTime?: string;
  minutes_remaining?: string | number;
  minutesRemaining?: string | number;
  target?: string | number;
  website_link?: string;
  websiteLink?: string;
  timezone?: string;
  signalsList?: string;
  [key: string]: any;
}

export class TemplateService {
  private cache: Map<string, MessageTemplate> = new Map();
  private lastFetched = 0;
  private readonly CACHE_TTL_MS = 10000; // 10 seconds cache, invalidated immediately on write

  /**
   * Retrieves all message templates from PostgreSQL.
   */
  async getAllTemplates(): Promise<MessageTemplate[]> {
    try {
      const res = await query<MessageTemplate>(
        `SELECT key, name, template, enabled, updated_at FROM message_templates ORDER BY key ASC`
      );

      if (res.rowCount > 0) {
        this.cache.clear();
        for (const row of res.rows) {
          this.cache.set(row.key, row);
        }
        this.lastFetched = Date.now();
        return res.rows;
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, 'Failed to query message_templates, returning defaults');
    }

    return Object.entries(DEFAULT_TEMPLATES).map(([key, def]) => ({
      key,
      name: def.name,
      template: def.template,
      enabled: true,
    }));
  }

  /**
   * Retrieves a single template by key.
   */
  async getTemplate(key: string): Promise<MessageTemplate> {
    const upperKey = key.toUpperCase();
    const now = Date.now();

    if (this.cache.has(upperKey) && now - this.lastFetched < this.CACHE_TTL_MS) {
      return this.cache.get(upperKey)!;
    }

    try {
      const res = await query<MessageTemplate>(
        `SELECT key, name, template, enabled, updated_at FROM message_templates WHERE key = $1`,
        [upperKey]
      );
      if (res.rowCount > 0 && res.rows[0]) {
        const row = res.rows[0];
        this.cache.set(upperKey, row);
        return row;
      }
    } catch (err: any) {
      logger.warn({ err: err.message, key: upperKey }, 'Failed to query message template');
    }

    // Fallback to default
    const def = DEFAULT_TEMPLATES[upperKey] || {
      name: upperKey,
      template: `[${upperKey}] Period: {issueNumber}`,
    };
    return {
      key: upperKey,
      name: def.name,
      template: def.template,
      enabled: true,
    };
  }

  /**
   * Updates an existing template and persists in PostgreSQL.
   */
  async updateTemplate(
    key: string,
    template: string,
    enabled = true
  ): Promise<MessageTemplate> {
    const upperKey = key.toUpperCase();
    const def = DEFAULT_TEMPLATES[upperKey];
    const name = def?.name || upperKey;

    await query(
      `INSERT INTO message_templates (key, name, template, enabled, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (key) DO UPDATE
       SET template = EXCLUDED.template,
           enabled = EXCLUDED.enabled,
           updated_at = NOW()`,
      [upperKey, name, template, enabled]
    );

    const updated: MessageTemplate = {
      key: upperKey,
      name,
      template,
      enabled,
      updated_at: new Date().toISOString(),
    };

    this.cache.set(upperKey, updated);
    logger.info({ key: upperKey }, 'Updated message template in PostgreSQL');
    return updated;
  }

  /**
   * Resets a template to system default.
   */
  async resetTemplate(key: string): Promise<MessageTemplate> {
    const upperKey = key.toUpperCase();
    const def = DEFAULT_TEMPLATES[upperKey];
    if (!def) {
      throw new Error(`No default template defined for key: ${key}`);
    }

    return this.updateTemplate(upperKey, def.template, true);
  }

  /**
   * Interpolates variables into a template string safely without crashing.
   */
  renderString(templateString: string, variables: TemplateVariables): string {
    const now = new Date();
    const defaultTime = now.toTimeString().split(' ')[0]; // HH:MM:SS
    const defaultDate = now.toISOString().split('T')[0]; // YYYY-MM-DD

    const cleanStr = (val: any, fallback = ''): string => {
      if (val === undefined || val === null) return fallback;
      const s = String(val).trim();
      if (s === 'undefined' || s === 'null' || s === '[object Object]') return fallback;
      return s;
    };

    const sessionName = cleanStr(variables.session_name || variables.sessionName, 'Upcoming Session');
    const sessionTime = cleanStr(variables.session_time || variables.sessionTime || variables.startTime, defaultTime);
    const targetWins = cleanStr(variables.target || variables.targetWins, '10');
    const websiteLink = cleanStr(variables.website_link || variables.websiteLink, 'https://example.com');
    const tz = cleanStr(variables.timezone, 'Asia/Karachi');

    // Handle dynamic remaining time calculation
    const rawMinRem = variables.minutes_remaining !== undefined ? variables.minutes_remaining : variables.minutesRemaining;
    let minRemNum: number | null = null;
    let remainingPhrase = '30 minutes';
    let minRemVar = '30';

    if (rawMinRem !== undefined && rawMinRem !== null && String(rawMinRem).trim() !== '') {
      const parsed = Number(rawMinRem);
      if (!isNaN(parsed)) {
        minRemNum = parsed;
        if (minRemNum < 1) {
          remainingPhrase = 'less than 1 minute';
          minRemVar = 'less than 1';
        } else if (minRemNum === 1) {
          remainingPhrase = '1 minute';
          minRemVar = '1';
        } else {
          remainingPhrase = `${minRemNum} minutes`;
          minRemVar = `${minRemNum}`;
        }
      } else {
        const s = String(rawMinRem).trim();
        minRemVar = s;
        remainingPhrase = s.includes('minute') ? s : `${s} minutes`;
      }
    }

    // Adapt template string phrasing if it includes start in {minutes_remaining} minutes or legacy 30 minutes
    let processedTemplate = templateString;
    if (minRemNum !== null) {
      // Replace "start in {minutes_remaining} minutes" (or minute)
      processedTemplate = processedTemplate.replace(
        /start in \{minutes_remaining\}\s*minutes?/gi,
        `start in ${remainingPhrase}`
      );
      // Replace legacy "start in 30 minutes" if dynamic remaining time was provided
      processedTemplate = processedTemplate.replace(
        /start in 30\s*minutes/gi,
        `start in ${remainingPhrase}`
      );
    }

    // Build consolidated dictionary
    const dict: Record<string, string> = {
      issueNumber: cleanStr(variables.issueNumber),
      prediction: cleanStr(variables.prediction ?? variables.predictionSize),
      predictionSize: cleanStr(variables.predictionSize ?? variables.prediction),
      predictionColor: cleanStr(variables.predictionColor ?? variables.color),
      size: cleanStr(variables.size ?? variables.prediction ?? variables.resultSize),
      color: cleanStr(variables.color ?? variables.predictionColor ?? variables.resultColor),
      confidence: cleanStr(variables.confidence, '75'),
      time: cleanStr(variables.time, defaultTime),
      date: cleanStr(variables.date, defaultDate),
      resultNumber: cleanStr(variables.resultNumber),
      resultSize: cleanStr(variables.resultSize),
      resultColor: cleanStr(variables.resultColor),
      status: cleanStr(variables.status),
      targetWins,
      target: targetWins,
      wins: cleanStr(variables.wins, '0'),
      losses: cleanStr(variables.losses, '0'),
      totalSignals: cleanStr(variables.totalSignals, '0'),
      winRate: cleanStr(variables.winRate, '0.00'),
      actual_total: cleanStr(variables.actual_total ?? variables.totalSignals, '0'),
      actual_win_count: cleanStr(variables.actual_win_count ?? variables.wins, '0'),
      actual_loss_count: cleanStr(variables.actual_loss_count ?? variables.losses, '0'),
      actual_win_rate: cleanStr(variables.actual_win_rate ?? variables.winRate, '0.00'),
      sessionName,
      session_name: sessionName,
      session_time: sessionTime,
      sessionTime,
      startTime: cleanStr(variables.startTime, sessionTime),
      start_time: cleanStr(variables.start_time ?? variables.startTime, sessionTime),
      endTime: cleanStr(variables.endTime),
      completion_time: cleanStr(variables.completion_time ?? variables.endTime),
      minutes_remaining: minRemVar,
      minutesRemaining: minRemVar,
      website_link: websiteLink,
      websiteLink,
      timezone: tz,
      signalsList: cleanStr(variables.signalsList),
    };

    // Replace all {variableName}
    let rendered = processedTemplate.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, varName) => {
      if (dict[varName] !== undefined && dict[varName] !== '') {
        return dict[varName];
      }
      if (variables[varName] !== undefined && variables[varName] !== null) {
        const val = cleanStr(variables[varName]);
        return val;
      }
      // Return empty string or leave unchanged if unknown
      return '';
    });

    // Safeguard: Never allow "undefined", "null", or "[object Object]" to appear in final message
    rendered = rendered.replace(/\b(undefined|null|\[object Object\])\b/g, '');

    return rendered;
  }

  /**
   * Loads template from PostgreSQL and renders with given variables.
   */
  async render(key: string, variables: TemplateVariables): Promise<string> {
    const tpl = await this.getTemplate(key);
    return this.renderString(tpl.template, variables);
  }

  /**
   * Generates a realistic sample preview without sending anything.
   */
  preview(key: string, customTemplateText?: string): { rendered: string; variablesUsed: TemplateVariables } {
    const upperKey = key.toUpperCase();
    const textToRender =
      customTemplateText !== undefined
        ? customTemplateText
        : DEFAULT_TEMPLATES[upperKey]?.template || '';

    const now = new Date();
    const sampleSignalsList = `1. Period: 20260923001
   Signal: BIG GREEN
   Result: 7 BIG GREEN
   ✅ WIN

2. Period: 20260923002
   Signal: SMALL RED
   Result: 2 SMALL RED
   ✅ WIN

3. Period: 20260923003
   Signal: BIG RED
   Result: 3 SMALL GREEN
   ❌ LOSS`;

    const sampleVariables: TemplateVariables = {
      issueNumber: '202609231234',
      prediction: 'BIG',
      predictionSize: 'BIG',
      predictionColor: 'GREEN',
      size: 'BIG',
      color: 'GREEN',
      confidence: 78,
      time: now.toTimeString().split(' ')[0],
      date: now.toISOString().split('T')[0],
      resultNumber: 7,
      resultSize: 'BIG',
      resultColor: 'GREEN',
      status: upperKey === 'WIN' ? 'WIN' : upperKey === 'LOSS' ? 'LOSS' : upperKey === 'TARGET_COMPLETE' ? 'TARGET COMPLETED' : 'PENDING',
      targetWins: 10,
      target: 10,
      wins: 10,
      losses: 3,
      totalSignals: 13,
      winRate: '76.92',
      sessionName: 'Afternoon Session',
      session_name: 'Afternoon Session',
      sessionTime: '02:00 PM',
      session_time: '02:00 PM',
      startTime: '02:00 PM',
      endTime: '02:42 PM',
      website_link: 'https://example.com',
      websiteLink: 'https://example.com',
      timezone: 'Asia/Karachi',
      signalsList: sampleSignalsList,
    };

    return {
      rendered: this.renderString(textToRender, sampleVariables),
      variablesUsed: sampleVariables,
    };
  }
}

export const templateService = new TemplateService();
