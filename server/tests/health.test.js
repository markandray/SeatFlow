const request = require('supertest');
const app = require('../src/app');

describe('Health & Global Error Handler', () => {
  it('GET /api/health should return 200 with status ok and serverTime', async () => {
    const res = await request(app).get('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body).toHaveProperty('serverTime');
    expect(res.body).toHaveProperty('uptime');
  });

  it('GET /api/unknown-route should return 404 NOT_FOUND', async () => {
    const res = await request(app).get('/api/unknown-route');
    expect(res.statusCode).toBe(404);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
