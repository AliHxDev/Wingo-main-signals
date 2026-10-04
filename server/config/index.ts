import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().optional(),
  DATABASE_SSL: z
    .string()
    .optional()
    .transform((val) => val === 'true' || val === '1'),
  ADMIN_USERNAME: z.string().default('admin'),
  ADMIN_PASSWORD: z.string().default('admin123456'),
  JWT_SECRET: z
    .string()
    .default('wingo-1m-whatsapp-secret-key-prod-random-2026'),
  DEFAULT_NEWSLETTER_JID: z.string().optional(),
  DEFAULT_CONFIDENCE_THRESHOLD: z.coerce.number().min(50).max(99).default(65),
  DEFAULT_POLLING_INTERVAL: z
    .union([z.string(), z.number()])
    .optional()
    .transform((val) => {
      if (!val) return 60;
      const num = Number(val);
      if (isNaN(num)) return 60;
      // If user passed milliseconds (e.g. 60000ms), convert to seconds (60s)
      const seconds = num >= 1000 ? Math.round(num / 1000) : num;
      return Math.min(Math.max(seconds, 10), 300);
    }),
});

export const config = envSchema.parse({
  PORT: process.env.PORT,
  NODE_ENV: process.env.NODE_ENV,
  DATABASE_URL:
    process.env.DATABASE_URL ||
    process.env.DATABASE_PRIVATE_URL ||
    process.env.DATABASE_PUBLIC_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRESQL_URL,
  DATABASE_SSL: process.env.DATABASE_SSL,
  ADMIN_USERNAME: process.env.ADMIN_USERNAME,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
  JWT_SECRET: process.env.JWT_SECRET,
  DEFAULT_NEWSLETTER_JID: process.env.DEFAULT_NEWSLETTER_JID,
  DEFAULT_CONFIDENCE_THRESHOLD: process.env.DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_POLLING_INTERVAL: process.env.DEFAULT_POLLING_INTERVAL,
});

export type Config = typeof config;
