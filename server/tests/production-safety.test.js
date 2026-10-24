const path = require('path');
const { spawnSync } = require('child_process');
const request = require('supertest');
const app = require('../src/app');
const env = require('../src/config/env');

describe('production safety configuration', () => {
  const serverRoot = path.resolve(__dirname, '..');

  const loadProductionConfig = (jwtSecret) => spawnSync(
    process.execPath,
    ['-e', "require('./src/config/env')"],
    {
      cwd: serverRoot,
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: jwtSecret },
    }
  );

  it('refuses short and example JWT secrets but accepts a long unique secret', () => {
    const short = loadProductionConfig('short-secret');
    expect(short.status).not.toBe(0);
    expect(short.stderr).toContain('Unsafe production JWT_SECRET');

    const placeholder = loadProductionConfig('replace_with_a_random_secret_at_least_32_characters_long');
    expect(placeholder.status).not.toBe(0);
    expect(placeholder.stderr).toContain('do not use an example placeholder');

    const valid = loadProductionConfig('local-test-only-random-production-secret-123456');
    expect(valid.status).toBe(0);
  });

  it('sets security headers and does not enable credentialed CORS', async () => {
    const response = await request(app)
      .get('/api/health')
      .set('Origin', 'http://localhost:5173');
    expect(response.statusCode).toBe(200);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['access-control-allow-origin']).toBe(env.CLIENT_ORIGIN);
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });
});
