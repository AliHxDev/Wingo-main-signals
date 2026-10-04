import { describe, it, expect } from 'vitest';
import {
  apiRateLimiter,
  API_RATE_LIMIT_MAX,
  API_RATE_LIMIT_MESSAGE,
} from '../../server/middleware/rate-limiter.js';

describe('API Rate Limiter & Polling Concurrency Suite', () => {
  it('configures generous rate limit capacity of at least 1000 requests per minute', () => {
    expect(typeof apiRateLimiter).toBe('function');
    expect(API_RATE_LIMIT_MAX).toBeGreaterThanOrEqual(1000);
  });

  it('provides consistent error response payload when threshold is exceeded', () => {
    expect(API_RATE_LIMIT_MESSAGE).toBe('Too many requests. Please slow down.');
  });
});
