import rateLimit from 'express-rate-limit';

const isTest = process.env.NODE_ENV === 'test';

// Common key generator for proxy environments
const proxyKeyGenerator = (req: any): string => {
  const authHeader = req.headers['authorization'];
  const authKey = authHeader ? authHeader.slice(-16) : '';
  const clientIp =
    req.ip ||
    (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
    (req.headers['forwarded'] as string)?.split(';')[0]?.replace(/^for=/i, '')?.trim() ||
    req.socket?.remoteAddress ||
    '127.0.0.1';
  return authKey ? `${clientIp}:${authKey}` : clientIp;
};

// Rate limiter for authentication login endpoint (prevent brute force)
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  keyGenerator: proxyKeyGenerator,
  validate: {
    xForwardedForHeader: false,
    forwardedHeader: false,
    default: false,
  },
  message: { error: 'Too many login attempts. Please try again after 15 minutes.' },
});

// Rate limiter for test message endpoint
export const testMessageRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // max 10 test messages per minute
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => isTest,
  keyGenerator: proxyKeyGenerator,
  validate: {
    xForwardedForHeader: false,
    forwardedHeader: false,
    default: false,
  },
  message: { error: 'Test message rate limit reached. Please wait a moment before trying again.' },
});

export const API_RATE_LIMIT_MESSAGE = 'Too many requests. Please slow down.';
export const API_RATE_LIMIT_MAX = 1000;

// General API rate limiter (configured with generous capacity for live polling dashboard)
export const apiRateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: API_RATE_LIMIT_MAX, // 1000 requests per minute to easily accommodate real-time telemetry polling
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    if (isTest) return true;
    if (req.path === '/health' || req.path === '/api/health') return true;
    return false;
  },
  keyGenerator: proxyKeyGenerator,
  validate: {
    xForwardedForHeader: false,
    forwardedHeader: false,
    default: false,
  },
  message: { error: API_RATE_LIMIT_MESSAGE },
});

