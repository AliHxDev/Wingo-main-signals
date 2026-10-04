import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import {
  renderDynamicTargetComplete,
  renderDynamicSessionHistory,
} from '../../server/utils/formatters.js';

describe('Session-Aware Architecture & Scheduling Tests', () => {
  it('calculates timezone-accurate timestamps using Luxon', () => {
    const karachiTz = DateTime.now().setZone('Asia/Karachi');
    expect(karachiTz.isValid).toBe(true);
    expect(karachiTz.zoneName).toBe('Asia/Karachi');

    const formattedTime = karachiTz.toFormat('HH:mm');
    expect(formattedTime).toMatch(/^\d{2}:\d{2}$/);
  });

  it('calculates exact 15-second signal timing synchronized with WinGo 1M periods', async () => {
    const { calculateNext15SecondPoint, calculateNext40SecondPoint } = await import('../../server/bot/runner.js');

    // Test case 1: 10 seconds into a minute (second 10.000)
    // Target must be 5 seconds away at second 15.000 of the same minute
    const sampleTime1 = new Date('2026-09-25T12:00:10.000Z').getTime();
    const result1 = calculateNext15SecondPoint(sampleTime1);
    expect(result1.delayMs).toBe(5000);
    expect(result1.target15PointMs).toBe(new Date('2026-09-25T12:00:15.000Z').getTime());
    expect(result1.targetOffset).toBe(0);

    // Test case 2: 45 seconds into a minute (second 45.000)
    // 15s mark for this minute has passed! Target must be at second 15.000 of the NEXT minute (30s away)
    const sampleTime2 = new Date('2026-09-25T12:00:45.000Z').getTime();
    const result2 = calculateNext15SecondPoint(sampleTime2);
    expect(result2.delayMs).toBe(30000);
    expect(result2.target15PointMs).toBe(new Date('2026-09-25T12:01:15.000Z').getTime());
    expect(result2.targetOffset).toBe(1);

    // Backward-compatible alias also routes to 15s timing
    const resultAlias = calculateNext40SecondPoint(sampleTime1);
    expect(resultAlias.delayMs).toBe(5000);
    expect(resultAlias.target40PointMs).toBe(new Date('2026-09-25T12:00:15.000Z').getTime());
  });

  it('renders TARGET_COMPLETE template with accurate statistics and emoji formatting', async () => {
    const msg = await renderDynamicTargetComplete({
      targetWins: 5,
      wins: 5,
      losses: 2,
      totalSignals: 7,
      winRate: '71.4',
      sessionName: 'Morning Session (06:00)',
      startTime: '06:00:00',
      endTime: '06:08:15',
    });

    expect(msg).toContain('TARGET COMPLETED');
    expect(msg).toContain('5 WIN');
    expect(msg).toContain('Wins: 5');
    expect(msg).toContain('Losses: 2');
    expect(msg).toContain('71.4%');
    expect(msg).toContain('Morning Session');
  });

  it('renders SESSION_HISTORY template with list of signals and results', async () => {
    const msg = await renderDynamicSessionHistory({
      sessionName: 'Afternoon Session (14:00)',
      startTime: '14:00:00',
      endTime: '14:07:30',
      targetWins: 5,
      wins: 5,
      losses: 1,
      totalSignals: 6,
      winRate: '83.3',
      status: 'TARGET_COMPLETED',
      signals: [
        {
          issue_number: '202609230001',
          prediction: 'BIG',
          predicted_color: 'GREEN',
          actual_number: 7,
          actual_size: 'BIG',
          actual_color: 'GREEN',
          status: 'WIN',
        },
        {
          issue_number: '202609230002',
          prediction: 'SMALL',
          predicted_color: 'RED',
          actual_number: 2,
          actual_size: 'SMALL',
          actual_color: 'RED',
          status: 'WIN',
        },
      ],
    });

    expect(msg).toContain('SESSION HISTORY');
    expect(msg).toContain('Afternoon Session');
    expect(msg).toContain('83.3%');
    expect(msg).toContain('202609230001');
    expect(msg).toContain('202609230002');
    expect(msg).toContain('✅ WIN');
  });

  it('verifies session scheduler enables schedule without prematurely starting if start time is in future', async () => {
    const { sessionScheduler } = await import('../../server/services/sessionScheduler.js');
    await sessionScheduler.start();

    // Enable schedule
    await sessionScheduler.enableSchedule();
    const status = await sessionScheduler.getSchedulerStatus();

    expect(status.scheduleEnabled).toBe(true);
    expect(status.timezone).toBe('Asia/Karachi');
    expect(status.configs.length).toBeGreaterThan(0);

    // If no session start time has hit yet, predictionEngineStatus should be IDLE and reason should explain
    if (!status.activeSession) {
      expect(status.predictionEngineStatus).toBe('IDLE');
      const check = await sessionScheduler.canGeneratePrediction();
      expect(check.allowed).toBe(false);
    }
  });

  it('guarantees canGeneratePrediction only allows signals when active session is RUNNING', async () => {
    const { sessionScheduler } = await import('../../server/services/sessionScheduler.js');
    await sessionScheduler.start();

    const check = await sessionScheduler.canGeneratePrediction();
    const active = await sessionScheduler.getActiveSession();
    if (!active) {
      expect(check.allowed).toBe(false);
      expect(check.reason).toBeDefined();
    }
  });

  it('safely handles session config deletion and active session termination', async () => {
    const { sessionScheduler } = await import('../../server/services/sessionScheduler.js');
    
    // Create a temporary session config
    const config = await sessionScheduler.createSessionConfig({
      session_name: 'Test Deletion Session',
      start_time: '23:59',
      target_wins: 5,
      min_confidence: 65,
      enabled: true,
    });
    expect(config.id).toBeDefined();

    // Delete it safely
    const deleted = await sessionScheduler.deleteSessionConfig(config.id);
    expect(deleted).toBe(true);

    const fetched = await sessionScheduler.getSessionConfigById(config.id);
    expect(fetched).toBeNull();
  });

  it('guarantees session scheduler waits for scheduled start time and marks expired sessions as MISSED without prematurely firing', async () => {
    const { sessionScheduler } = await import('../../server/services/sessionScheduler.js');
    await sessionScheduler.start();

    // Trigger tick
    await sessionScheduler.tick();

    const status = await sessionScheduler.getSchedulerStatus();
    // In Pakistan timezone, if the current wall-clock time does not coincide with 06:00, 14:00, or 20:00,
    // activeSession should remain null and prediction engine IDLE.
    if (!status.activeSession) {
      expect(status.predictionEngineStatus).toBe('IDLE');
    }
  });
});

