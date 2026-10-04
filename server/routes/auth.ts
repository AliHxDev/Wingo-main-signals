import { Router, type Request, type Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import { query } from '../db/index.js';
import { generateToken } from '../middleware/auth.js';
import { loginRateLimiter } from '../middleware/rate-limiter.js';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

export const authRouter = Router();

const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

authRouter.post('/login', loginRateLimiter, async (req: Request, res: Response): Promise<void> => {
  try {
    const parseResult = loginSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.issues[0]?.message || 'Invalid input' });
      return;
    }

    const { username, password } = parseResult.data;

    const userRes = await query<{ id: number; username: string; password_hash: string }>(
      'SELECT id, username, password_hash FROM users WHERE username = $1',
      [username]
    );

    if (userRes.rowCount === 0 || !userRes.rows[0]) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    const user = userRes.rows[0];
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      res.status(401).json({ error: 'Invalid username or password' });
      return;
    }

    const token = generateToken({ id: user.id, username: user.username });

    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https' || config.NODE_ENV === 'production';

    // Set secure HTTP-only cookie with iframe compatibility
    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: isHttps,
      sameSite: isHttps ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    res.json({
      success: true,
      user: { id: user.id, username: user.username },
      token,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Login failed' });
  }
});

authRouter.post('/auto-login', async (req: Request, res: Response): Promise<void> => {
  try {
    const userRes = await query<{ id: number; username: string; password_hash: string }>(
      'SELECT id, username, password_hash FROM users WHERE username = $1',
      [config.ADMIN_USERNAME]
    );

    if (userRes.rowCount === 0 || !userRes.rows[0]) {
      res.status(401).json({ error: 'Default admin user not found' });
      return;
    }

    const user = userRes.rows[0];
    const isPasswordValid = await bcrypt.compare(config.ADMIN_PASSWORD, user.password_hash);
    if (!isPasswordValid) {
      res.status(401).json({ error: 'Admin credentials have been changed. Manual sign-in required.' });
      return;
    }

    const token = generateToken({ id: user.id, username: user.username });
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https' || config.NODE_ENV === 'production';

    res.cookie('auth_token', token, {
      httpOnly: true,
      secure: isHttps,
      sameSite: isHttps ? 'none' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      user: { id: user.id, username: user.username },
      token,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || 'Auto-login failed' });
  }
});

authRouter.post('/logout', (req: Request, res: Response): void => {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https' || config.NODE_ENV === 'production';
  res.clearCookie('auth_token', {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'none' : 'lax',
  });
  res.json({ success: true, message: 'Logged out successfully' });
});

authRouter.get('/status', (req: Request, res: Response): void => {
  const authHeader = req.headers.authorization;
  let token: string | null = null;

  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.cookies?.auth_token) {
    token = req.cookies.auth_token;
  }

  if (!token) {
    res.json({ authenticated: false });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as { id: number; username: string };
    res.json({
      authenticated: true,
      user: { id: decoded.id, username: decoded.username },
    });
  } catch {
    res.json({ authenticated: false });
  }
});
