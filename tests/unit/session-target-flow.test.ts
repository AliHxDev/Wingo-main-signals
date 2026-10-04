import { describe, it, expect, vi, beforeEach } from 'vitest';
import { query } from '../../server/db/index.js';
import { sessionScheduler } from '../../server/services/sessionScheduler.js';
import { whatsAppManager } from '../../server/whatsapp/client.js';
import { renderDynamicSessionHistory, renderDynamicTargetComplete } from '../../server/utils/formatters.js';

describe('Session Target Completion, Timing, Idempotency & History Flow Tests', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
  });

  // Test 1: Target = 10, 10 WIN, 0 LOSS => Expected: 10 WIN, 0 LOSS, 10 total
  it('Test 1: Target = 10 with 10 WIN and 0 LOSS produces 10 total and 100% win rate', async () => {
    const sessRes = await query<any>(
      `INSERT INTO bot_sessions (session_name, schedule_date, start_time, status, target_wins)
       VALUES ('Test Session 1', '2026-09-29', '09:00', 'RUNNING', 10)
       RETURNING id`
    );
    const sessionId = sessRes.rows[0].id;

    for (let i = 1; i <= 10; i++) {
      await query(
        `INSERT INTO signals (issue_number, prediction, predicted_color, confidence, status, sent_to, session_id)
         VALUES ($1, 'BIG', 'GREEN', 85, 'WIN', 'channel', $2)`,
        [`202609291000100${i.toString().padStart(2, '0')}`, sessionId]
      );
    }

    const stats = await sessionScheduler.syncSessionStats(sessionId);
    expect(stats.wins).toBe(10);
    expect(stats.losses).toBe(0);
    expect(stats.totalSignals).toBe(10);
    expect(stats.totalSignals).toBe(stats.wins + stats.losses);
    expect(stats.winRate).toBe(100.00);

    const refreshed = await sessionScheduler.getSessionById(sessionId);
    expect(refreshed?.wins).toBe(10);
    expect(refreshed?.losses).toBe(0);
    expect(refreshed?.total_signals).toBe(10);
  });

  // Test 2: Target = 10, 10 WIN, 5 LOSS => Expected: 10 WIN, 5 LOSS, 15 total. Session completes only on 10th WIN.
  it('Test 2: Target = 10 with 10 WIN and 5 LOSS produces 15 total, never counts LOSS towards target', async () => {
    const sessRes = await query<any>(
      `INSERT INTO bot_sessions (session_name, schedule_date, start_time, status, target_wins)
       VALUES ('Test Session 2', '2026-09-29', '10:00', 'RUNNING', 10)
       RETURNING id`
    );
    const sessionId = sessRes.rows[0].id;

    // 10 WINs
    for (let i = 1; i <= 10; i++) {
      await query(
        `INSERT INTO signals (issue_number, prediction, predicted_color, confidence, status, sent_to, session_id)
         VALUES ($1, 'BIG', 'GREEN', 80, 'WIN', 'channel', $2)`,
        [`202609292000200${i.toString().padStart(2, '0')}`, sessionId]
      );
    }
    // 5 LOSSes
    for (let i = 1; i <= 5; i++) {
      await query(
        `INSERT INTO signals (issue_number, prediction, predicted_color, confidence, status, sent_to, session_id)
         VALUES ($1, 'SMALL', 'RED', 80, 'LOSS', 'channel', $2)`,
        [`202609292000201${i.toString().padStart(2, '0')}`, sessionId]
      );
    }

    const stats = await sessionScheduler.syncSessionStats(sessionId);
    expect(stats.wins).toBe(10);
    expect(stats.losses).toBe(5);
    expect(stats.totalSignals).toBe(15);
    expect(stats.totalSignals).toBe(stats.wins + stats.losses);
    expect(stats.winRate).toBe(66.67);
  });

  // Test 3: Target = 10, 9 WIN, 5 LOSS. Next result = LOSS => Session remains active (RUNNING)
  it('Test 3: Target = 10, 9 WIN, 5 LOSS + Next result = LOSS => Session remains RUNNING', async () => {
    const sessRes = await query<any>(
      `INSERT INTO bot_sessions (session_name, schedule_date, start_time, status, target_wins)
       VALUES ('Test Session 3', '2026-09-29', '11:00', 'RUNNING', 10)
       RETURNING id`
    );
    const sessionId = sessRes.rows[0].id;

    // 9 WINs
    for (let i = 1; i <= 9; i++) {
      await query(
        `INSERT INTO signals (issue_number, prediction, predicted_color, confidence, status, sent_to, session_id)
         VALUES ($1, 'BIG', 'GREEN', 80, 'WIN', 'channel', $2)`,
        [`202609293000300${i.toString().padStart(2, '0')}`, sessionId]
      );
    }
    // 5 LOSSes
    for (let i = 1; i <= 5; i++) {
      await query(
        `INSERT INTO signals (issue_number, prediction, predicted_color, confidence, status, sent_to, session_id)
         VALUES ($1, 'SMALL', 'RED', 80, 'LOSS', 'channel', $2)`,
        [`202609293000301${i.toString().padStart(2, '0')}`, sessionId]
      );
    }

    // Now insert next signal which results in LOSS
    const nextIssue = '20260929300030999';
    await query(
      `INSERT INTO signals (issue_number, prediction, predicted_color, confidence, status, sent_to, session_id)
       VALUES ($1, 'BIG', 'GREEN', 85, 'LOSS', 'channel', $2)`,
      [nextIssue, sessionId]
    );

    await sessionScheduler.syncSessionStats(sessionId);
    const sess = await sessionScheduler.getSessionById(sessionId);
    expect(sess?.wins).toBe(9);
    expect(sess?.losses).toBe(6);
    expect(sess?.total_signals).toBe(15);

    // Attempting completion without reaching 10 WINs must return false and remain RUNNING
    const completed = await sessionScheduler.completeSessionTarget(sessionId, false);
    expect(completed).toBe(false);

    const refreshed = await sessionScheduler.getSessionById(sessionId);
    expect(refreshed?.status).toBe('RUNNING');
  });

  // Test 4: Target = 10, 9 WIN, 5 LOSS. Next result = WIN => Target completes
  it('Test 4: Target = 10, 9 WIN, 5 LOSS + Next result = WIN => Target completes atomically', async () => {
    const sessRes = await query<any>(
      `INSERT INTO bot_sessions (session_name, schedule_date, start_time, status, target_wins)
       VALUES ('Test Session 4', '2026-09-29', '12:00', 'RUNNING', 10)
       RETURNING id`
    );
    const sessionId = sessRes.rows[0].id;

    // 9 WINs
    for (let i = 1; i <= 9; i++) {
      await query(
        `INSERT INTO signals (issue_number, prediction, predicted_color, confidence, status, sent_to, session_id)
         VALUES ($1, 'BIG', 'GREEN', 80, 'WIN', 'channel', $2)`,
        [`202609294000400${i.toString().padStart(2, '0')}`, sessionId]
      );
    }
    // 5 LOSSes
    for (let i = 1; i <= 5; i++) {
      await query(
        `INSERT INTO signals (issue_number, prediction, predicted_color, confidence, status, sent_to, session_id)
         VALUES ($1, 'SMALL', 'RED', 80, 'LOSS', 'channel', $2)`,
        [`202609294000401${i.toString().padStart(2, '0')}`, sessionId]
      );
    }

    // Now 10th WIN arrives!
    await query(
      `INSERT INTO signals (issue_number, prediction, predicted_color, confidence, status, sent_to, session_id)
       VALUES ('20260929400040999', 'BIG', 'GREEN', 85, 'WIN', 'channel', $1)`,
      [sessionId]
    );

    const completed = await sessionScheduler.completeSessionTarget(sessionId, false);
    expect(completed).toBe(true);

    const refreshed = await sessionScheduler.getSessionById(sessionId);
    expect(refreshed?.status).toBe('TARGET_COMPLETED');
    expect(refreshed?.wins).toBe(10);
    expect(refreshed?.losses).toBe(5);
    expect(refreshed?.total_signals).toBe(15);
    expect(refreshed?.target_completion_status).toBe('PENDING');
    expect(refreshed?.target_completion_scheduled_for).toBeDefined();
  });

  // Test 5: Target completion timing: T+0 target reached, T+20 target-completion msg, T+40 history msg
  it('Test 5: Timing sequence: T+0 target reached, T+20 target-completion msg, T+40 history msg', async () => {
    const sendSpy = vi.spyOn(whatsAppManager, 'sendMessage').mockResolvedValue({
      success: true,
      messageId: 'msg-test-5',
      destination: '120363411395110604@newsletter',
    });
    vi.spyOn(whatsAppManager, 'isReady').mockResolvedValue({
      ready: true,
      destination: '120363411395110604@newsletter',
    });
    vi.spyOn(whatsAppManager, 'getStatus').mockReturnValue({
      status: 'connected',
      reconnectAttempts: 0,
      sessionReady: true,
    } as any);

    const sessRes = await query<any>(
      `INSERT INTO bot_sessions (session_name, schedule_date, start_time, status, target_wins, wins, losses, total_signals)
       VALUES ('Test Timing Session', '2026-09-29', '13:00', 'RUNNING', 10, 10, 2, 12)
       RETURNING id`
    );
    const sessionId = sessRes.rows[0].id;

    // Complete target at T+0
    await sessionScheduler.completeSessionTarget(sessionId, true);

    // Before 20 seconds, deliverTargetCompletionMessage must not send
    const earlyDeliver = await sessionScheduler.deliverTargetCompletionMessage(sessionId);
    expect(earlyDeliver).toBe(false);
    expect(sendSpy).not.toHaveBeenCalled();

    // Fast-forward DB target_completion_scheduled_for to past
    await query(
      `UPDATE bot_sessions SET target_completion_scheduled_for = NOW() - INTERVAL '1 second' WHERE id = $1`,
      [sessionId]
    );

    // At T+20, TARGET_COMPLETE message is delivered
    const targetDelivered = await sessionScheduler.deliverTargetCompletionMessage(sessionId);
    expect(targetDelivered).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    const afterTarget = await sessionScheduler.getSessionById(sessionId);
    expect(afterTarget?.target_completion_status).toBe('SENT');
    expect(afterTarget?.history_scheduled_for).toBeDefined();

    // Attempting history message immediately (before another 20s) must hold
    const earlyHistory = await sessionScheduler.deliverSessionHistoryMessage(sessionId);
    expect(earlyHistory).toBe(false);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    // Fast-forward history_scheduled_for to past (T+40)
    await query(
      `UPDATE bot_sessions SET history_scheduled_for = NOW() - INTERVAL '1 second' WHERE id = $1`,
      [sessionId]
    );

    // At T+40, SESSION_HISTORY message is delivered
    const historyDelivered = await sessionScheduler.deliverSessionHistoryMessage(sessionId);
    expect(historyDelivered).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(2);

    const afterHistory = await sessionScheduler.getSessionById(sessionId);
    expect(afterHistory?.history_message_status).toBe('SENT');
  });

  // Test 6: Restart 10 seconds after target completion => No duplicate target-completion message
  it('Test 6: Server restart 10 seconds after target completion preserves remaining delay without duplicate', async () => {
    const sendSpy = vi.spyOn(whatsAppManager, 'sendMessage').mockResolvedValue({
      success: true,
      messageId: 'msg-test-6',
      destination: 'channel@newsletter',
    });
    vi.spyOn(whatsAppManager, 'isReady').mockResolvedValue({
      ready: true,
      destination: 'channel@newsletter',
    });
    vi.spyOn(whatsAppManager, 'getStatus').mockReturnValue({
      status: 'connected',
      reconnectAttempts: 0,
      sessionReady: true,
    } as any);

    // Session completed 10 seconds ago (10s left on 20s timer)
    const sessRes = await query<any>(
      `INSERT INTO bot_sessions (
         session_name, schedule_date, start_time, status, target_wins, wins, losses, total_signals,
         completed_at, target_completion_status, target_completion_scheduled_for
       ) VALUES (
         'Restart Test 1', '2026-09-29', '14:00', 'TARGET_COMPLETED', 10, 10, 1, 11,
         NOW() - INTERVAL '10 seconds', 'PENDING', NOW() + INTERVAL '10 seconds'
       ) RETURNING id`
    );
    const sessionId = sessRes.rows[0].id;

    // Simulate startup recovery running
    await sessionScheduler.recoverOnStartup();

    // Since 10s remaining, message must not be sent yet
    expect(sendSpy).not.toHaveBeenCalled();

    // Fast-forward remaining 10s to simulate timer firing
    await query(
      `UPDATE bot_sessions SET target_completion_scheduled_for = NOW() - INTERVAL '1 second' WHERE id = $1`,
      [sessionId]
    );
    await sessionScheduler.deliverTargetCompletionMessage(sessionId);

    // Message sent once
    expect(sendSpy).toHaveBeenCalledTimes(1);

    // Second recovery or tick call must NOT resend
    await sessionScheduler.processPendingTargetCompletions();
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  // Test 7: Restart after target-completion message but before history => Only history sent after remaining delay
  it('Test 7: Server restart after target-completion message only sends history after remaining delay', async () => {
    const sendSpy = vi.spyOn(whatsAppManager, 'sendMessage').mockResolvedValue({
      success: true,
      messageId: 'msg-test-7',
      destination: 'channel@newsletter',
    });
    vi.spyOn(whatsAppManager, 'isReady').mockResolvedValue({
      ready: true,
      destination: 'channel@newsletter',
    });
    vi.spyOn(whatsAppManager, 'getStatus').mockReturnValue({
      status: 'connected',
      reconnectAttempts: 0,
      sessionReady: true,
    } as any);

    // Target completion was sent 10 seconds ago, history scheduled in 10 seconds
    const sessRes = await query<any>(
      `INSERT INTO bot_sessions (
         session_name, schedule_date, start_time, status, target_wins, wins, losses, total_signals,
         target_completion_status, target_completion_sent_at,
         history_message_status, history_scheduled_for
       ) VALUES (
         'Restart Test 2', '2026-09-29', '15:00', 'TARGET_COMPLETED', 10, 10, 2, 12,
         'SENT', NOW() - INTERVAL '10 seconds',
         'PENDING', NOW() + INTERVAL '10 seconds'
       ) RETURNING id`
    );
    const sessionId = sessRes.rows[0].id;

    // Startup recovery check
    await sessionScheduler.recoverOnStartup();
    // History must not be sent yet because 10 seconds remain
    expect(sendSpy).not.toHaveBeenCalled();

    // Fast forward remaining delay
    await query(
      `UPDATE bot_sessions SET history_scheduled_for = NOW() - INTERVAL '1 second' WHERE id = $1`,
      [sessionId]
    );
    await sessionScheduler.deliverSessionHistoryMessage(sessionId);

    // Only history is sent (1 call, never target-completion again)
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  // Test 8: Duplicate WinGo result => WIN/LOSS count changes only once
  it('Test 8: Duplicate result processing evaluates WIN/LOSS exactly once', async () => {
    const issueNumber = '20260929888880001';
    await query(
      `INSERT INTO signals (issue_number, prediction, predicted_color, confidence, status, sent_to)
       VALUES ($1, 'BIG', 'GREEN', 85, 'PENDING', 'channel')
       ON CONFLICT (issue_number) DO NOTHING`,
      [issueNumber]
    );

    // First result settlement
    const res1 = await query(
      `UPDATE signals SET status = 'WIN', actual_number = 7, actual_size = 'BIG', settled_at = NOW()
       WHERE issue_number = $1 AND status = 'PENDING'`,
      [issueNumber]
    );
    expect(res1.rowCount).toBe(1);

    // Duplicate result settlement (e.g. repeated API poll or concurrent worker)
    const res2 = await query(
      `UPDATE signals SET status = 'WIN', actual_number = 7, actual_size = 'BIG', settled_at = NOW()
       WHERE issue_number = $1 AND status = 'PENDING'`,
      [issueNumber]
    );
    expect(res2.rowCount).toBe(0);

    // Attempting to flip to LOSS is also rejected
    const res3 = await query(
      `UPDATE signals SET status = 'LOSS', actual_number = 2, actual_size = 'SMALL', settled_at = NOW()
       WHERE issue_number = $1 AND status = 'PENDING'`,
      [issueNumber]
    );
    expect(res3.rowCount).toBe(0);

    const sig = await query<any>(`SELECT status FROM signals WHERE issue_number = $1`, [issueNumber]);
    expect(sig.rows[0].status).toBe('WIN');
  });

  // Test 9: Duplicate scheduler execution => Only one completion flow
  it('Test 9: Concurrent/duplicate calls to completeSessionTarget execute only once', async () => {
    const sessRes = await query<any>(
      `INSERT INTO bot_sessions (session_name, schedule_date, start_time, status, target_wins, wins, losses, total_signals)
       VALUES ('Concurrent Test', '2026-09-29', '16:00', 'RUNNING', 10, 10, 3, 13)
       RETURNING id`
    );
    const sessionId = sessRes.rows[0].id;

    // Insert 10 WIN signals so syncSessionStats verifies target wins
    for (let i = 1; i <= 10; i++) {
      await query(
        `INSERT INTO signals (issue_number, prediction, predicted_color, confidence, status, sent_to, session_id)
         VALUES ($1, 'BIG', 'GREEN', 85, 'WIN', 'channel', $2)`,
        [`202609299900990${i.toString().padStart(2, '0')}`, sessionId]
      );
    }

    // Call completeSessionTarget concurrently 5 times
    const results = await Promise.all([
      sessionScheduler.completeSessionTarget(sessionId),
      sessionScheduler.completeSessionTarget(sessionId),
      sessionScheduler.completeSessionTarget(sessionId),
      sessionScheduler.completeSessionTarget(sessionId),
      sessionScheduler.completeSessionTarget(sessionId),
    ]);

    // Exactly one call must succeed in transitioning the session status
    const succeededCount = results.filter((r) => r === true).length;
    expect(succeededCount).toBe(1);

    const check = await sessionScheduler.getSessionById(sessionId);
    expect(check?.status).toBe('TARGET_COMPLETED');
  });

  // Test 10: WhatsApp temporarily disconnected => No crash and no duplicate successful messages
  it('Test 10: WhatsApp disconnect keeps state in PENDING/FAILED and delivers safely upon reconnection', async () => {
    const sendSpy = vi.spyOn(whatsAppManager, 'sendMessage');

    // Simulate WhatsApp disconnected
    vi.spyOn(whatsAppManager, 'isReady').mockResolvedValue({
      ready: false,
      reason: 'WhatsApp socket disconnected',
    });
    vi.spyOn(whatsAppManager, 'getStatus').mockReturnValue({
      status: 'disconnected',
      reconnectAttempts: 2,
      sessionReady: false,
    } as any);

    const sessRes = await query<any>(
      `INSERT INTO bot_sessions (
         session_name, schedule_date, start_time, status, target_wins, wins, losses, total_signals,
         target_completion_status, target_completion_scheduled_for
       ) VALUES (
         'Disconnect Test', '2026-09-29', '17:00', 'TARGET_COMPLETED', 10, 10, 2, 12,
         'PENDING', NOW() - INTERVAL '1 second'
       ) RETURNING id`
    );
    const sessionId = sessRes.rows[0].id;

    // Delivery while disconnected: must NOT crash and must return false
    const deliveredWhileOffline = await sessionScheduler.deliverTargetCompletionMessage(sessionId);
    expect(deliveredWhileOffline).toBe(false);
    expect(sendSpy).not.toHaveBeenCalled();

    // Session remains in PENDING/FAILED state
    let check = await sessionScheduler.getSessionById(sessionId);
    expect(check?.target_completion_status).not.toBe('SENT');

    // Now WhatsApp reconnects!
    vi.spyOn(whatsAppManager, 'isReady').mockResolvedValue({
      ready: true,
      destination: 'channel@newsletter',
    });
    vi.spyOn(whatsAppManager, 'getStatus').mockReturnValue({
      status: 'connected',
      reconnectAttempts: 0,
      sessionReady: true,
    } as any);
    sendSpy.mockResolvedValue({
      success: true,
      messageId: 'msg-reconnected',
      destination: 'channel@newsletter',
    });

    const deliveredAfterReconnect = await sessionScheduler.deliverTargetCompletionMessage(sessionId);
    expect(deliveredAfterReconnect).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);

    check = await sessionScheduler.getSessionById(sessionId);
    expect(check?.target_completion_status).toBe('SENT');

    // Calling again does not duplicate
    const secondCall = await sessionScheduler.deliverTargetCompletionMessage(sessionId);
    expect(secondCall).toBe(true);
    expect(sendSpy).toHaveBeenCalledTimes(1);
  });
});
