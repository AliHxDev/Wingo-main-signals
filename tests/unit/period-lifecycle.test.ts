import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PeriodLifecycleManager,
  getPeriodStartTimeFromIssue,
} from '../../server/bot/periodLifecycle.js';

describe('WinGo Period-Based Signal System Tests', () => {
  let manager: PeriodLifecycleManager;

  beforeEach(() => {
    manager = new PeriodLifecycleManager();
  });

  afterEach(() => {
    manager.reset();
  });

  it('calculates exact period start and 15-second elapsed target from WinGo period number', () => {
    // Period: 20260925100010491
    // Year: 2026, Month: 09, Day: 25, Period index: 491
    // (491 - 1) * 60,000ms = 490 minutes = 8 hours and 10 minutes
    const periodNumber = '20260925100010491';
    const periodStart = getPeriodStartTimeFromIssue(periodNumber);
    const expectedStart = Date.UTC(2026, 8, 25, 8, 10, 0, 0);

    expect(periodStart).toBe(expectedStart);

    // Target 15s is exactly 15 seconds into THIS specific period
    const target15 = periodStart + 15000;
    expect(target15).toBe(expectedStart + 15000);
  });

  it('tracks period lifecycle independently through DETECTED -> WAITING_15_SECONDS', async () => {
    const periodNumber = '20260925100010491';
    const periodStart = getPeriodStartTimeFromIssue(periodNumber);
    // Discover 5 seconds into the period (< 15s)
    const now = periodStart + 5000;

    const state = await manager.onPeriodDetected(periodNumber, now);

    expect(state.periodNumber).toBe(periodNumber);
    expect(state.periodStart).toBe(periodStart);
    expect(state.elapsedSeconds).toBe(5);
    expect(state.state).toBe('WAITING_15_SECONDS');
    expect(state.signalScheduled).toBe(true);
    expect(state.signalSent).toBe(false);
  });

  it('enforces late-period policy: skips stale signals if period discovered after 15 seconds', async () => {
    const periodNumber = '20260925100010491';
    const periodStart = getPeriodStartTimeFromIssue(periodNumber);
    // Discover 20 seconds into the period (> 15s)
    const now = periodStart + 20000;

    const state = await manager.onPeriodDetected(periodNumber, now);

    expect(state.periodNumber).toBe(periodNumber);
    expect(state.elapsedSeconds).toBe(20);
    expect(state.state).toBe('SKIPPED_LATE');
    expect(state.signalScheduled).toBe(false);
    expect(state.signalSent).toBe(false);
    expect(state.skippedReason).toContain('Discovered late');
  });

  it('isolates period transitions: new period cancels previous timer and starts fresh lifecycle', async () => {
    const period1 = '20260925100010491';
    const start1 = getPeriodStartTimeFromIssue(period1);
    const state1 = await manager.onPeriodDetected(period1, start1 + 5000);

    expect(state1.periodNumber).toBe(period1);
    expect(state1.state).toBe('WAITING_15_SECONDS');

    // Next period arrives
    const period2 = '20260925100010492';
    const start2 = getPeriodStartTimeFromIssue(period2);
    const state2 = await manager.onPeriodDetected(period2, start2 + 2000);

    expect(state2.periodNumber).toBe(period2);
    expect(state2.periodStart).toBe(start2);
    expect(state2.elapsedSeconds).toBe(2);
    expect(state2.state).toBe('WAITING_15_SECONDS');

    // Previous period state was archived and finalized
    const prevArchived = manager.getPeriodState(period1);
    expect(prevArchived).not.toBeNull();
    expect(prevArchived?.periodNumber).toBe(period1);
  });

  it('validates period before trigger and blocks execution if validation fails', async () => {
    const periodNumber = '20260925100010491';
    const periodStart = getPeriodStartTimeFromIssue(periodNumber);
    await manager.onPeriodDetected(periodNumber, periodStart + 5000);

    const triggerSpy = vi.fn();
    manager.registerSignalTriggerCallback(triggerSpy);

    // Mismatched period number should fail validation
    const successMismatch = await manager.triggerSignalForPeriod('20260925100099999', periodStart + 15000, periodStart + 15000);
    expect(successMismatch).toBe(false);
    expect(triggerSpy).not.toHaveBeenCalled();
  });

  it('executes trigger at 15s mark, transitions state to SIGNAL_SENT, and attaches period number', async () => {
    const periodNumber = '20260925100010491';
    const periodStart = getPeriodStartTimeFromIssue(periodNumber);
    const target15PointMs = periodStart + 15000;

    await manager.onPeriodDetected(periodNumber, periodStart + 5000);

    let executedPeriod: string | null = null;
    manager.registerSignalTriggerCallback(async (state) => {
      executedPeriod = state.periodNumber;
    });

    const triggered = await manager.triggerSignalForPeriod(periodNumber, target15PointMs, target15PointMs);

    expect(triggered).toBe(true);
    expect(executedPeriod).toBe(periodNumber);

    const currentState = manager.getCurrentPeriod();
    expect(currentState?.signalSent).toBe(true);
    expect(currentState?.state).toBe('WAITING_RESULT');
  });

  it('enforces duplicate protection: period cannot receive a second signal', async () => {
    const periodNumber = '20260925100010491';
    const periodStart = getPeriodStartTimeFromIssue(periodNumber);
    const target15PointMs = periodStart + 15000;

    await manager.onPeriodDetected(periodNumber, periodStart + 5000);

    const triggerSpy = vi.fn();
    manager.registerSignalTriggerCallback(triggerSpy);

    // First trigger succeeds
    const firstTrigger = await manager.triggerSignalForPeriod(periodNumber, target15PointMs, target15PointMs);
    expect(firstTrigger).toBe(true);
    expect(triggerSpy).toHaveBeenCalledTimes(1);

    // Second trigger MUST be blocked by duplicate protection
    const secondTrigger = await manager.triggerSignalForPeriod(periodNumber, target15PointMs, target15PointMs);
    expect(secondTrigger).toBe(false);
    expect(triggerSpy).toHaveBeenCalledTimes(1);
  });

  it('settles result immediately and updates state to WIN or LOSS', async () => {
    const periodNumber = '20260925100010491';
    const periodStart = getPeriodStartTimeFromIssue(periodNumber);
    const target15PointMs = periodStart + 15000;

    await manager.onPeriodDetected(periodNumber, periodStart + 5000);
    await manager.triggerSignalForPeriod(periodNumber, target15PointMs, target15PointMs);

    // Settle as WIN
    manager.onPeriodSettled(periodNumber, 'WIN', 7, 'BIG');

    const state = manager.getCurrentPeriod();
    expect(state?.signalResult).toBe('WIN');
    expect(state?.state).toBe('WIN');
    expect(state?.completedAt).toBeGreaterThan(0);
  });
});
