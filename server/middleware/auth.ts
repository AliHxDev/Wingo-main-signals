import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

export interface AuthenticatedUser {
  id: number;
  username: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function generateToken(user: AuthenticatedUser): string {
  return jwt.sign(user, config.JWT_SECRET, { expiresIn: '7d' });
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  // Check Authorization header first (case-insensitive) or cookie
  const authHeader = req.headers.authorization;
  let token: string | null = null;

  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    token = authHeader.substring(7).trim();
  } else if (req.cookies?.auth_token) {
    token = req.cookies.auth_token;
  }

  if (!token) {
    res.status(401).json({ error: 'Unauthorized: Authentication required' });
    return;
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as AuthenticatedUser;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized: Invalid or expired session' });
  }
}
