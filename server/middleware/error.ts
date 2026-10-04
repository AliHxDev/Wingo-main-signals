import type { Request, Response, NextFunction } from 'express';
import { logger } from '../services/logger.js';
import { config } from '../config/index.js';

export function errorHandler(
  err: any,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
): void {
  const statusCode = err.status || err.statusCode || 500;
  const message = err.message || 'Internal Server Error';

  logger.error(
    {
      statusCode,
      message,
      url: req.originalUrl,
      method: req.method,
      stack: config.NODE_ENV === 'development' ? err.stack : undefined,
    },
    'API Request Error'
  );

  res.status(statusCode).json({
    error: message,
    ...(config.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
}
