import { Router, type Request, type Response } from 'express';
import { query } from '../db/index.js';

export const signalsRouter = Router();

signalsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 100);
    const status = req.query.status as string | undefined;

    let sql = 'SELECT * FROM signals';
    const params: any[] = [];

    if (status && ['PENDING', 'WIN', 'LOSS'].includes(status.toUpperCase())) {
      sql += ' WHERE status = $1';
      params.push(status.toUpperCase());
    }

    sql += ` ORDER BY id DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await query(sql, params);
    res.json({
      signals: result.rows,
      count: result.rowCount,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch signals' });
  }
});

signalsRouter.get('/latest', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await query(
      'SELECT * FROM signals ORDER BY id DESC LIMIT 1'
    );
    res.json(result.rows[0] || null);
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Failed to fetch latest signal' });
  }
});
