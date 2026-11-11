import { describe, it, expect } from 'vitest';
import { buildTestApp } from './helpers.js';

describe('health', () => {
  it('GET /api/health returns ok', async () => {
    const app = (await buildTestApp()).app;
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});

describe('API caching', () => {
  it('API responses (including errors) are never cached; uploads keep their long cache', async () => {
    const { app } = await buildTestApp();
    const ok = await app.inject({ method: 'GET', url: '/api/health' });
    expect(ok.headers['cache-control']).toBe('no-store');
    const unauth = await app.inject({ method: 'GET', url: '/api/notifications' });
    expect(unauth.statusCode).toBe(401);
    expect(unauth.headers['cache-control']).toBe('no-store');
    const missing = await app.inject({ method: 'GET', url: '/uploads/nope.png' });
    expect(missing.headers['cache-control']).not.toBe('no-store');
    await app.close();
  });
});
