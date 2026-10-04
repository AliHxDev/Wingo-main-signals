import { Router, type Request, type Response } from 'express';
import { query } from '../db/index.js';

export const statisticsRouter = Router();

statisticsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const totalSignalsRes = await query<{ count: string }>('SELECT COUNT(*) FROM signals');
    const winsRes = await query<{ count: string }>(
      "SELECT COUNT(*) FROM signals WHERE status = 'WIN'"
    );
    const lossesRes = await query<{ count: string }>(
      "SELECT COUNT(*) FROM signals WHERE status = 'LOSS'"
    );
    const pendingRes = await query<{ count: string }>(
      "SELECT COUNT(*) FROM signals WHERE status = 'PENDING'"
    );

    const totalSignals = parseInt(totalSignalsRes.rows[0]?.count || '0', 10);
    const wins = parseInt(winsRes.rows[0]?.count || '0', 10);
    const losses = parseInt(lossesRes.rows[0]?.count || '0', 10);
    const pending = parseInt(pendingRes.rows[0]?.count || '0', 10);
    const settled = wins + losses;

    const winRate = settled > 0 ? Math.round((wins / settled) * 1000) / 10 : 0;

    // Recent 10 settled signals for streak visualization
    const recentSettledRes = await query<{ status: string; issue_number: string }>(
      "SELECT status, issue_number FROM signals WHERE status IN ('WIN', 'LOSS') ORDER BY id DESC LIMIT 10"
    );

    // Distribution by prediction size
    const bigPredRes = await query<{ count: string }>(
      "SELECT COUNT(*) FROM signals WHERE prediction = 'BIG'"
    );
    const smallPredRes = await query<{ count: string }>(
      "SELECT COUNT(*) FROM signals WHERE prediction = 'SMALL'"
    );

    const bigCount = parseInt(bigPredRes.rows[0]?.count || '0', 10);
    const smallCount = parseInt(smallPredRes.rows[0]?.count || '0', 10);

    // Delivery stats
    const deliveryStatsRes = await query<{ status: string; count: string }>(
      'SELECT status, COUNT(*) FROM delivery_logs GROUP BY status'
    );
    const deliveryStats = {
      success: 0,
      failed: 0,
    };
    for (const row of deliveryStatsRes.rows) {
      if (row.status === 'SUCCESS') deliveryStats.success = parseInt(row.count, 10);
      if (row.status === 'FAILED') deliveryStats.failed = parseInt(row.count, 10);
    }

    res.json({
      totalSignals,
      settled,
      wins,
      losses,
      pending,
      winRate,
      recentSettled: recentSettledRes.rows,
      predictionsDistribution: {
        big: bigCount,
        small: smallCount,
      },
      deliveryStats,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to compute statistics' });
  }
});
