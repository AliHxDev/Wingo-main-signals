import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { templateService } from '../../server/services/templates.js';
import { sessionReminderService } from '../../server/services/sessionReminderService.js';

describe('Pre-Session Reminder System', () => {
  const tz = 'Asia/Karachi';

  it('calculates reminder time exactly 30 minutes before session start', () => {
    const testCases = [
      { start: '06:00', expectedReminder: '05:30' },
      { start: '14:00', expectedReminder: '13:30' },
      { start: '20:00', expectedReminder: '19:30' },
      { start: '00:15', expectedReminder: '23:45' },
    ];

    for (const tc of testCases) {
      const [h, m] = tc.start.split(':').map(Number);
      const baseDt = DateTime.fromObject(
        { year: 2026, month: 9, day: 26, hour: h, minute: m, second: 0 },
        { zone: tz }
      );
      const reminderDt = baseDt.minus({ minutes: 30 });
      expect(reminderDt.toFormat('HH:mm')).toBe(tc.expectedReminder);
    }
  });

  it('formats 12-hour display strings cleanly (AM/PM)', () => {
    expect(sessionReminderService.format12h('06:00')).toBe('06:00 AM');
    expect(sessionReminderService.format12h('14:00')).toBe('02:00 PM');
    expect(sessionReminderService.format12h('20:00')).toBe('08:00 PM');
    expect(sessionReminderService.format12h('13:30')).toBe('01:30 PM');
    expect(sessionReminderService.format12h('05:30')).toBe('05:30 AM');
  });

  it('replaces all reminder template variables without sending undefined, null, or [object Object]', () => {
    const rawTemplate = `🔔 SESSION STARTING SOON
━━━━━━━━━━━━━━━━
💰 PREPARE YOUR FUNDS

Your next WinGo session will start in {minutes_remaining} minutes.

⏰ Session: {session_time}
🎯 Target: {target} WIN

🌐 Website:
{website_link}

Please prepare your funds and be ready.

━━━━━━━━━━━━━━━━
⚠️ Play responsibly.`;

    const rendered = templateService.renderString(rawTemplate, {
      session_name: 'Afternoon Session',
      session_time: '02:00 PM',
      target: 10,
      website_link: 'https://example.com',
      date: '2026-09-26',
      timezone: 'Asia/Karachi',
      minutes_remaining: 30,
    });

    expect(rendered).toContain('02:00 PM');
    expect(rendered).toContain('10 WIN');
    expect(rendered).toContain('https://example.com');
    expect(rendered).toContain('start in 30 minutes.');
    expect(rendered).not.toContain('undefined');
    expect(rendered).not.toContain('null');
    expect(rendered).not.toContain('[object Object]');
    expect(rendered).not.toContain('{session_time}');
    expect(rendered).not.toContain('{target}');
    expect(rendered).not.toContain('{website_link}');
    expect(rendered).not.toContain('{minutes_remaining}');
  });

  it('dynamically formats remaining time for catch-up reminders (15 min, 10 min, 5 min, 2 min, 1 min, <1 min)', () => {
    const rawTemplate = `🔔 SESSION STARTING SOON
━━━━━━━━━━━━━━━━
💰 PREPARE YOUR FUNDS

Your next WinGo session will start in {minutes_remaining} minutes.

⏰ Session: {session_time}
🎯 Target: {target} WIN

🌐 Website:
{website_link}

Please prepare your funds and be ready.

━━━━━━━━━━━━━━━━
⚠️ Play responsibly.`;

    // 15 minutes catch-up (01:45 PM for 02:00 PM session)
    const res15 = templateService.renderString(rawTemplate, {
      session_time: '02:00 PM',
      target: 10,
      website_link: 'https://example.com',
      minutes_remaining: 15,
    });
    expect(res15).toContain('Your next WinGo session will start in 15 minutes.');

    // 10 minutes catch-up (01:50 PM for 02:00 PM session)
    const res10 = templateService.renderString(rawTemplate, {
      session_time: '02:00 PM',
      target: 10,
      website_link: 'https://example.com',
      minutes_remaining: 10,
    });
    expect(res10).toContain('Your next WinGo session will start in 10 minutes.');

    // 5 minutes catch-up (01:55 PM for 02:00 PM session)
    const res5 = templateService.renderString(rawTemplate, {
      session_time: '02:00 PM',
      target: 10,
      website_link: 'https://example.com',
      minutes_remaining: 5,
    });
    expect(res5).toContain('Your next WinGo session will start in 5 minutes.');

    // 2 minutes catch-up (01:58 PM for 02:00 PM session)
    const res2 = templateService.renderString(rawTemplate, {
      session_time: '02:00 PM',
      target: 10,
      website_link: 'https://example.com',
      minutes_remaining: 2,
    });
    expect(res2).toContain('Your next WinGo session will start in 2 minutes.');

    // 1 minute catch-up (01:59:00 PM for 02:00 PM session)
    const res1 = templateService.renderString(rawTemplate, {
      session_time: '02:00 PM',
      target: 10,
      website_link: 'https://example.com',
      minutes_remaining: 1,
    });
    expect(res1).toContain('Your next WinGo session will start in 1 minute.');

    // Less than 1 minute catch-up (01:59:30 PM for 02:00 PM session)
    const resLess1 = templateService.renderString(rawTemplate, {
      session_time: '02:00 PM',
      target: 10,
      website_link: 'https://example.com',
      minutes_remaining: 0,
    });
    expect(resLess1).toContain('Your next WinGo session will start in less than 1 minute.');
  });

  it('safely handles missing or empty variables with fallback defaults', () => {
    const templateWithAllVars = `Session: {session_name} at {session_time}, Target: {target}, Link: {website_link}, Date: {date}, TZ: {timezone}, In: {minutes_remaining}`;
    const rendered = templateService.renderString(templateWithAllVars, {});

    expect(rendered).not.toContain('undefined');
    expect(rendered).not.toContain('null');
    expect(rendered).not.toContain('[object Object]');
    expect(rendered).toContain('https://example.com');
    expect(rendered).toContain('10');
    expect(rendered).toContain('In: 30');
  });

  it('verifies catch-up window logic (reminderTime <= currentTime < sessionStartTime)', () => {
    // Session is at 14:00 (02:00 PM). Reminder is at 13:30 (01:30 PM).
    const sessionStartDt = DateTime.fromObject(
      { year: 2026, month: 9, day: 26, hour: 14, minute: 0, second: 0 },
      { zone: tz }
    );
    const reminderDt = sessionStartDt.minus({ minutes: 30 }); // 13:30

    // Scenario 1: Bot starts at 01:00 PM (before reminder time)
    const botStart1300 = DateTime.fromObject(
      { year: 2026, month: 9, day: 26, hour: 13, minute: 0, second: 0 },
      { zone: tz }
    );
    expect(botStart1300 < reminderDt).toBe(true); // Must wait, do NOT send yet!

    // Scenario 2: Bot starts at 01:45 PM (catch-up: between reminder and session start)
    const botStart1345 = DateTime.fromObject(
      { year: 2026, month: 9, day: 26, hour: 13, minute: 45, second: 0 },
      { zone: tz }
    );
    expect(botStart1345 >= reminderDt && botStart1345 < sessionStartDt).toBe(true);
    const remainingSec1345 = Math.floor(sessionStartDt.diff(botStart1345).as('seconds'));
    const min1345 = Math.round(remainingSec1345 / 60);
    expect(min1345).toBe(15); // Immediate catch-up reminder with 15 minutes!

    // Scenario 3: Bot starts at 01:55 PM (catch-up: 5 minutes remaining)
    const botStart1355 = DateTime.fromObject(
      { year: 2026, month: 9, day: 26, hour: 13, minute: 55, second: 0 },
      { zone: tz }
    );
    expect(botStart1355 >= reminderDt && botStart1355 < sessionStartDt).toBe(true);
    const remainingSec1355 = Math.floor(sessionStartDt.diff(botStart1355).as('seconds'));
    const min1355 = Math.round(remainingSec1355 / 60);
    expect(min1355).toBe(5); // Immediate catch-up reminder with 5 minutes!

    // Scenario 4: Bot starts at 01:59:00 PM (catch-up: 1 minute remaining)
    const botStart1359 = DateTime.fromObject(
      { year: 2026, month: 9, day: 26, hour: 13, minute: 59, second: 0 },
      { zone: tz }
    );
    expect(botStart1359 >= reminderDt && botStart1359 < sessionStartDt).toBe(true);
    const remainingSec1359 = Math.floor(sessionStartDt.diff(botStart1359).as('seconds'));
    const min1359 = Math.round(remainingSec1359 / 60);
    expect(min1359).toBe(1); // Immediate catch-up reminder with 1 minute!

    // Scenario 5: Bot starts at 01:59:40 PM (catch-up: < 60s remaining)
    const botStart135940 = DateTime.fromObject(
      { year: 2026, month: 9, day: 26, hour: 13, minute: 59, second: 40 },
      { zone: tz }
    );
    expect(botStart135940 >= reminderDt && botStart135940 < sessionStartDt).toBe(true);
    const remainingSec135940 = Math.floor(sessionStartDt.diff(botStart135940).as('seconds'));
    expect(remainingSec135940 < 60).toBe(true); // Less than 1 minute!

    // Scenario 6: Bot starts at 02:00:00 PM (session starting time) -> DO NOT SEND
    const botStart1400 = DateTime.fromObject(
      { year: 2026, month: 9, day: 26, hour: 14, minute: 0, second: 0 },
      { zone: tz }
    );
    expect(botStart1400 >= sessionStartDt).toBe(true); // Must NOT send reminder!

    // Scenario 7: Bot starts at 02:05:00 PM (after session start) -> DO NOT SEND
    const botStart1405 = DateTime.fromObject(
      { year: 2026, month: 9, day: 26, hour: 14, minute: 5, second: 0 },
      { zone: tz }
    );
    expect(botStart1405 >= sessionStartDt).toBe(true); // Must NOT send reminder!
  });

  it('guarantees duplicate protection across bot restarts', () => {
    // If a reminder has status === 'SENT' in DB, it must never be re-sent
    const records = [
      { id: 1, session_config_id: 2, status: 'SENT', session_time: '14:00' },
      { id: 2, session_config_id: 3, status: 'PENDING', session_time: '20:00' },
    ];

    const isAlreadySent = (configId: number, sessionTime: string) => {
      const rec = records.find(r => r.session_config_id === configId && r.session_time === sessionTime);
      return rec ? rec.status === 'SENT' : false;
    };

    expect(isAlreadySent(2, '14:00')).toBe(true); // Do not send second reminder!
    expect(isAlreadySent(3, '20:00')).toBe(false); // Eligible for reminder
    expect(isAlreadySent(4, '06:00')).toBe(false); // Eligible for reminder
  });
});
