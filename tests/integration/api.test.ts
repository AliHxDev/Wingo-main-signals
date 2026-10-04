import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { initDatabase, query } from '../../server/db/index.js';
import { config } from '../../server/config/index.js';
import { healthRouter } from '../../server/routes/health.js';
import { authRouter } from '../../server/routes/auth.js';
import { settingsRouter } from '../../server/routes/settings.js';
import { signalsRouter } from '../../server/routes/signals.js';
import { statisticsRouter } from '../../server/routes/statistics.js';
import { whatsAppRouter } from '../../server/routes/whatsapp.js';
import { botRouter } from '../../server/routes/bot.js';
import { sessionsRouter } from '../../server/routes/sessions.js';

describe('Express API Integration Tests', () => {
  let app: express.Express;
  let adminToken: string;

  beforeAll(async () => {
    // Initialize in-memory database and seed admin user & settings
    await initDatabase();

    app = express();
    app.use(express.json());
    app.use(cookieParser());

    app.use('/api/health', healthRouter);
    app.use('/api/auth', authRouter);
    app.use('/api/settings', settingsRouter);
    app.use('/api/signals', signalsRouter);
    app.use('/api/statistics', statisticsRouter);
    app.use('/api/whatsapp', whatsAppRouter);
    app.use('/api/bot', botRouter);
    app.use('/api/sessions', sessionsRouter);
  });

  it('GET /api/health returns 200 with system status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.database.connected).toBe(true);
  });

  it('POST /api/auth/login authenticates admin user and returns token', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: config.ADMIN_USERNAME, password: config.ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.username).toBe(config.ADMIN_USERNAME);
    expect(res.body.token).toBeDefined();

    adminToken = res.body.token;
  });

  it('POST /api/auth/auto-login allows automatic admin session initialization', async () => {
    const res = await request(app).post('/api/auth/auto-login');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.user.username).toBe(config.ADMIN_USERNAME);
    expect(res.body.token).toBeDefined();
  });

  it('POST /api/whatsapp/pair requires authentication', async () => {
    const unauthorizedRes = await request(app)
      .post('/api/whatsapp/pair')
      .send({ phoneNumber: '1234567890' });

    expect(unauthorizedRes.status).toBe(401);
    expect(unauthorizedRes.body.error).toContain('Unauthorized');
  });

  it('GET /api/settings returns settings', async () => {
    const res = await request(app).get('/api/settings');
    expect(res.status).toBe(200);
    expect(res.body.confidenceThreshold).toBeDefined();
    expect(res.body.pollingInterval).toBeDefined();
  });

  it('PUT /api/settings requires auth and updates newsletter JID', async () => {
    // Without auth
    const unauthorizedRes = await request(app)
      .put('/api/settings')
      .send({ newsletterJid: '120363411395110604@newsletter' });
    expect(unauthorizedRes.status).toBe(401);

    // With auth
    const res = await request(app)
      .put('/api/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        newsletterJid: '120363411395110604@newsletter',
        confidenceThreshold: 70,
        pollingInterval: 60,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.activeDestination).toBe('120363411395110604@newsletter');
  });

  it('POST /api/signals can store and retrieve signals and calculate statistics', async () => {
    // Insert mock signal into DB
    await query(
      `INSERT INTO signals (issue_number, prediction, predicted_color, confidence, status, sent_to, actual_number, actual_size, actual_color, sent_at, settled_at)
       VALUES ('202609210001', 'BIG', 'GREEN', 80, 'WIN', '120363411395110604@newsletter', 7, 'BIG', 'GREEN', NOW(), NOW()),
              ('202609210002', 'SMALL', 'RED', 75, 'LOSS', '120363411395110604@newsletter', 8, 'BIG', 'RED', NOW(), NOW());`
    );

    const sigRes = await request(app).get('/api/signals');
    expect(sigRes.status).toBe(200);
    expect(sigRes.body.count).toBeGreaterThanOrEqual(2);

    const statsRes = await request(app).get('/api/statistics');
    expect(statsRes.status).toBe(200);
    expect(statsRes.body.totalSignals).toBeGreaterThanOrEqual(2);
    expect(statsRes.body.wins).toBeGreaterThanOrEqual(1);
    expect(statsRes.body.losses).toBeGreaterThanOrEqual(1);
    expect(statsRes.body.winRate).toBeGreaterThan(0);
  });

  it('GET /api/whatsapp/status returns connection state', async () => {
    const res = await request(app).get('/api/whatsapp/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();
  });

  it('GET /api/bot/status returns current bot loop status', async () => {
    const res = await request(app).get('/api/bot/status');
    expect(res.status).toBe(200);
    expect(res.body.running).toBe(false);
  });

  it('handles Session CRUD and real backend DELETE with PostgreSQL persistence', async () => {
    // 1. List initial configs
    const listRes = await request(app).get('/api/sessions/configs');
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);

    // 2. Create new session without random delay fields
    const createRes = await request(app)
      .post('/api/sessions/configs')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        session_name: 'VIP Evening Test',
        start_time: '19:30',
        target_wins: 8,
        min_confidence: 70,
        enabled: true,
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body.success).toBe(true);
    expect(createRes.body.config.session_name).toBe('VIP Evening Test');
    const createdId = createRes.body.config.id;

    // 3. Update session config
    const updateRes = await request(app)
      .put(`/api/sessions/configs/${createdId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        session_name: 'VIP Evening Test (Updated)',
        start_time: '19:45',
        target_wins: 12,
        min_confidence: 75,
        enabled: true,
      });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.success).toBe(true);
    expect(updateRes.body.config.session_name).toBe('VIP Evening Test (Updated)');
    expect(updateRes.body.config.target_wins).toBe(12);

    // 4. Real backend DELETE endpoint
    const deleteRes = await request(app)
      .delete(`/api/sessions/configs/${createdId}`)
      .set('Authorization', `Bearer ${adminToken}`);

    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.success).toBe(true);
    expect(deleteRes.body.message).toContain('deleted');

    // 5. Confirm session is gone from PostgreSQL
    const verifyListRes = await request(app).get('/api/sessions/configs');
    const remaining = verifyListRes.body.find((c: any) => c.id === createdId);
    expect(remaining).toBeUndefined();
  });
});
