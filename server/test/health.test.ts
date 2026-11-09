import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { FakeNexon, testConfig } from './helpers.js';

describe('health', () => {
  it('GET /api/health returns ok', async () => {
    const app = await buildApp({ config: testConfig(), nexon: new FakeNexon() });
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
