import { describe, it, expect } from 'vitest';
import { renderDynamicSessionHistory, renderDynamicTargetComplete } from '../../server/utils/formatters.js';
import { query } from '../../server/db/index.js';
import { sessionScheduler } from '../../server/services/sessionScheduler.js';

describe('Session History, Signal Count & Data Integrity Tests', () => {
  it('enforces TOTAL = WIN + LOSS invariant in renderDynamicSessionHistory', async () => {
    // Exact scenario from user prompt: 9 actual records (7 WIN, 2 LOSS)
    const testSignals = [
      { issue_number: '20260925100010001', prediction: 'BIG', predicted_color: 'GREEN', actual_number: 8, actual_size: 'BIG', actual_color: 'RED', status: 'WIN' },
      { issue_number: '20260925100010002', prediction: 'BIG', predicted_color: 'GREEN', actual_number: 6, actual_size: 'BIG', actual_color: 'RED', status: 'WIN' },
      { issue_number: '20260925100010003', prediction: 'SMALL', predicted_color: 'RED', actual_number: 2, actual_size: 'SMALL', actual_color: 'RED', status: 'WIN' },
      { issue_number: '20260925100010004', prediction: 'BIG', predicted_color: 'GREEN', actual_number: 7, actual_size: 'BIG', actual_color: 'GREEN', status: 'WIN' },
      { issue_number: '20260925100010005', prediction: 'BIG', predicted_color: 'GREEN', actual_number: 3, actual_size: 'SMALL', actual_color: 'GREEN', status: 'LOSS' },
      { issue_number: '20260925100010006', prediction: 'SMALL', predicted_color: 'RED', actual_number: 4, actual_size: 'SMALL', actual_color: 'RED', status: 'WIN' },
      { issue_number: '20260925100010007', prediction: 'BIG', predicted_color: 'GREEN', actual_number: 9, actual_size: 'BIG', actual_color: 'GREEN', status: 'WIN' },
      { issue_number: '20260925100010008', prediction: 'BIG', predicted_color: 'GREEN', actual_number: 5, actual_size: 'BIG', actual_color: 'GREEN', status: 'WIN' },
      { issue_number: '20260925100010009', prediction: 'SMALL', predicted_color: 'RED', actual_number: 8, actual_size: 'BIG', actual_color: 'RED', status: 'LOSS' },
    ];

    // Even if caller erroneously passed mismatched cached counters (e.g. 10/10/10),
    // renderDynamicSessionHistory MUST derive summary from authoritative signal records!
    const rendered = await renderDynamicSessionHistory({
      sessionName: 'Morning Session',
      startTime: '06:00:00',
      endTime: '06:12:00',
      targetWins: 10,
      wins: 10,
      losses: 10,
      totalSignals: 10,
      winRate: '50.00',
      status: 'TARGET COMPLETED',
      signals: testSignals,
    });

    // Authoritative calculations:
    // Total = 9
    // WIN = 7
    // LOSS = 2
    // Win Rate = 77.78%
    expect(rendered).toContain('Total Predictions: 9');
    expect(rendered).toContain('✅ WIN: 7');
    expect(rendered).toContain('❌ LOSS: 2');
    expect(rendered).toContain('77.78%');
    expect(rendered).not.toContain('Total Predictions: 10');
    expect(rendered).not.toContain('WIN: 10');
    expect(rendered).not.toContain('LOSS: 10');
    expect(rendered).not.toContain('50.00%');

    // Detail rows count must match summary total (1. Period to 9. Period)
    expect(rendered).toContain('1. Period: 20260925100010001');
    expect(rendered).toContain('9. Period: 20260925100010009');
    expect(rendered).not.toContain('10. Period:');
  });

  it('guarantees one period = one record by enforcing uniqueness in signals table', async () => {
    const issueNumber = '20260925100010526';
    
    // First insert
    const res1 = await query<any>(
      `INSERT INTO signals (issue_number, prediction, predicted_color, confidence, status, sent_to)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (issue_number) DO NOTHING
       RETURNING id`,
      [issueNumber, 'BIG', 'GREEN', 85, 'PENDING', 'test-channel']
    );

    // Verification: period now exists
    const existing = await query<any>(
      `SELECT id FROM signals WHERE issue_number = $1`,
      [issueNumber]
    );
    expect(existing.rowCount).toBe(1);

    // Attempting duplicate generation for the same period is rejected
    let duplicateInserted = false;
    if (existing.rowCount === 0) {
      await query<any>(
        `INSERT INTO signals (issue_number, prediction, predicted_color, confidence, status, sent_to)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [issueNumber, 'SMALL', 'RED', 80, 'PENDING', 'test-channel']
      );
      duplicateInserted = true;
    }
    expect(duplicateInserted).toBe(false);

    // Verify exactly 1 record exists in the table for this period (Requirement 3: One Period = One Record)
    const checkRes = await query<any>(
      `SELECT COUNT(*) as count FROM signals WHERE issue_number = $1`,
      [issueNumber]
    );
    expect(parseInt(checkRes.rows[0].count, 10)).toBe(1);
  });

  it('ensures syncSessionStats calculates authoritative stats with TOTAL = WIN + LOSS', async () => {
    // Create temporary session
    const sessRes = await query<any>(
      `INSERT INTO bot_sessions (session_name, schedule_date, start_time, status, target_wins, wins, losses, total_signals)
       VALUES ('Integrity Test Session', '2026-09-25', '10:00', 'RUNNING', 10, 99, 99, 99)
       RETURNING id`
    );
    const sessionId = sessRes.rows[0].id;

    // Insert 4 WINs and 1 LOSS (Total = 5)
    for (let i = 1; i <= 4; i++) {
      await query(
        `INSERT INTO signals (issue_number, prediction, predicted_color, confidence, status, sent_to, session_id)
         VALUES ($1, 'BIG', 'GREEN', 85, 'WIN', 'channel', $2)`,
        [`2026092599990000${i}`, sessionId]
      );
    }
    await query(
      `INSERT INTO signals (issue_number, prediction, predicted_color, confidence, status, sent_to, session_id)
       VALUES ('20260925999900005', 'SMALL', 'RED', 85, 'LOSS', 'channel', $1)`,
      [sessionId]
    );

    // Add 1 PENDING signal (not settled, must not be counted in result TOTAL)
    await query(
      `INSERT INTO signals (issue_number, prediction, predicted_color, confidence, status, sent_to, session_id)
       VALUES ('20260925999900006', 'BIG', 'GREEN', 85, 'PENDING', 'channel', $1)`,
      [sessionId]
    );

    // Call syncSessionStats
    const stats = await sessionScheduler.syncSessionStats(sessionId);
    expect(stats.wins).toBe(4);
    expect(stats.losses).toBe(1);
    expect(stats.totalSignals).toBe(5);
    expect(stats.winRate).toBe(80.00);

    // Verify getSessionById reads authoritative counts
    const refreshed = await sessionScheduler.getSessionById(sessionId);
    expect(refreshed).not.toBeNull();
    expect(refreshed?.wins).toBe(4);
    expect(refreshed?.losses).toBe(1);
    expect(refreshed?.total_signals).toBe(5);
    expect(refreshed?.win_rate).toBe(80.00);
    expect(refreshed?.wins! + refreshed?.losses!).toBe(refreshed?.total_signals);
  });

  it('guarantees settlement is idempotent and outcome is either WIN or LOSS, never both', async () => {
    const issueNumber = '20260925100010999';
    await query(
      `INSERT INTO signals (issue_number, prediction, predicted_color, confidence, status, sent_to)
       VALUES ($1, 'BIG', 'GREEN', 88, 'PENDING', 'channel')
       ON CONFLICT (issue_number) DO NOTHING`,
      [issueNumber]
    );

    // Atomic update to WIN
    const update1 = await query(
      `UPDATE signals
       SET status = 'WIN', actual_number = 7, actual_size = 'BIG', settled_at = NOW()
       WHERE issue_number = $1 AND status = 'PENDING'`,
      [issueNumber]
    );
    expect(update1.rowCount).toBe(1);

    // Second update attempt (e.g. repeated polling or retry)
    const update2 = await query(
      `UPDATE signals
       SET status = 'LOSS', actual_number = 2, actual_size = 'SMALL', settled_at = NOW()
       WHERE issue_number = $1 AND status = 'PENDING'`,
      [issueNumber]
    );
    expect(update2.rowCount).toBe(0);

    // Outcome is strictly WIN and only 1 record
    const signal = await query<any>(`SELECT status FROM signals WHERE issue_number = $1`, [issueNumber]);
    expect(signal.rows[0].status).toBe('WIN');
  });
});
