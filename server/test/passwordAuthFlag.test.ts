import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../src/config.js';
import { buildTestApp, resetDb, testConfig } from './helpers.js';

let app: FastifyInstance | undefined;
beforeEach(async () => { await resetDb(); });
afterEach(async () => { await app?.close(); app = undefined; });

const post = (url: string) => app!.inject({ method: 'POST', url, headers: { origin: 'http://localhost:5173' }, payload: {} });
const PASSWORD_ROUTES = ['/api/auth/password/register', '/api/auth/password/login', '/api/auth/password/forgot', '/api/auth/password/reset'];

it('PASSWORD_AUTH_ENABLED is off unless set to true or 1', () => {
  const base = { SESSION_SECRET: 'x'.repeat(32), DATABASE_URL: 'postgresql://x' };
  expect(loadConfig(base).passwordAuth).toBe(false);
  expect(loadConfig({ ...base, PASSWORD_AUTH_ENABLED: 'false' }).passwordAuth).toBe(false);
  expect(loadConfig({ ...base, PASSWORD_AUTH_ENABLED: ' TRUE ' }).passwordAuth).toBe(true);
  expect(loadConfig({ ...base, PASSWORD_AUTH_ENABLED: '1' }).passwordAuth).toBe(true);
});

it('with password login off: its routes do not exist, passkeys still do, and the client is told', async () => {
  ({ app } = await buildTestApp({ config: testConfig({ passwordAuth: false }) }));
  for (const url of PASSWORD_ROUTES) expect((await post(url)).statusCode, url).toBe(404);
  expect((await post('/api/auth/passkeys/login/options')).statusCode).not.toBe(404);
  const config = await app!.inject({ method: 'GET', url: '/api/auth/config' });
  expect(config.json()).toEqual({ passwordAuth: false });
});

it('with password login on: its routes exist and the client is told', async () => {
  ({ app } = await buildTestApp({ config: testConfig({ passwordAuth: true }) }));
  for (const url of PASSWORD_ROUTES) expect((await post(url)).statusCode, url).not.toBe(404);
  expect((await app!.inject({ method: 'GET', url: '/api/auth/config' })).json()).toEqual({ passwordAuth: true });
});
