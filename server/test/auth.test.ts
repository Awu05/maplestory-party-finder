import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, loginAs, prisma, resetDb } from './helpers.js';
import { requireUser } from '../src/auth/guards.js';

let app: FastifyInstance;

beforeEach(async () => {
  await resetDb();
  ({ app } = await buildTestApp());
});
afterEach(async () => {
  await app.close();
});

describe('auth', () => {
  it('login flow', async () => {
    const cookie = await loginAs(app, 'u-1', 'andy');
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.json()).toMatchObject({ discordUsername: 'andy', isAdmin: false });
    expect(await prisma.user.count()).toBe(1);
  });

  it('session survives past 24h (30-day expiry)', async () => {
    const cookie = await loginAs(app, 'u-1', 'andy');
    const realNow = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(realNow + 25 * 60 * 60 * 1000);
    try {
      const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
      expect(me.json()).toMatchObject({ discordUsername: 'andy' });
    } finally {
      spy.mockRestore();
    }
  });

  it('second login updates username', async () => {
    await loginAs(app, 'u-1', 'andy');
    await loginAs(app, 'u-1', 'andy2');
    const users = await prisma.user.findMany();
    expect(users).toHaveLength(1);
    expect(users[0]!.username).toBe('andy2');
  });

  const startLogin = async () => {
    const start = await app.inject({ method: 'GET', url: '/api/auth/discord' });
    const state = new URL(String(start.headers.location)).searchParams.get('state')!;
    const cookie = String(start.headers['set-cookie']).split(';')[0]!;
    return { state, cookie };
  };
  const callback = (query: string, cookie: string) =>
    app.inject({ method: 'GET', url: `/api/auth/discord/callback?${query}`, headers: { cookie } });
  const expectLoginFailed = async (res: Awaited<ReturnType<typeof callback>>) => {
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('http://localhost:5173/?login=failed');
    expect(await prisma.user.count()).toBe(0);
  };

  it('bad state → redirect to /?login=failed and clears the stored state', async () => {
    const { state, cookie } = await startLogin();
    const res = await callback('code=fake:u-1:andy&state=wrong', cookie);
    await expectLoginFailed(res);
    // The original state can no longer be used with the updated session.
    const cleared = String(res.headers['set-cookie']).split(';')[0]!;
    await expectLoginFailed(await callback(`code=fake:u-1:andy&state=${state}`, cleared));
  });

  it('access_denied from Discord → redirect to /?login=failed, no user', async () => {
    const { state, cookie } = await startLogin();
    await expectLoginFailed(await callback(`error=access_denied&state=${state}`, cookie));
  });

  it('exchangeCode failure → redirect to /?login=failed, no user', async () => {
    const { state, cookie } = await startLogin();
    await expectLoginFailed(await callback(`code=not-a-fake-code&state=${state}`, cookie));
  });

  it('admin by env', async () => {
    const cookie = await loginAs(app, 'admin-1');
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.json().isAdmin).toBe(true);
  });

  it('logged out me is null', async () => {
    const me = await app.inject({ method: 'GET', url: '/api/auth/me' });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toBeNull();
  });

  it('logout clears the session', async () => {
    const cookie = await loginAs(app, 'u-1');
    const out = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
    expect(out.statusCode).toBe(204);
    const cleared = String(out.headers['set-cookie']).split(';')[0]!;
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: cleared } });
    expect(me.json()).toBeNull();
  });

  it('banned user is rejected by requireUser', async () => {
    app.get('/guarded', async (req) => {
      await requireUser(req);
      return { ok: true };
    });
    const cookie = await loginAs(app, 'u-1');
    const ok = await app.inject({ method: 'GET', url: '/guarded', headers: { cookie } });
    expect(ok.statusCode).toBe(200);
    await prisma.user.update({ where: { discordId: 'u-1' }, data: { banned: true } });
    const res = await app.inject({ method: 'GET', url: '/guarded', headers: { cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('BANNED');
    const anon = await app.inject({ method: 'GET', url: '/guarded' });
    expect(anon.json().error.code).toBe('UNAUTHENTICATED');
  });
});
