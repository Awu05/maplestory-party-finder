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

  it('bad state returns 400 BAD_STATE', async () => {
    const start = await app.inject({ method: 'GET', url: '/api/auth/discord' });
    const cookie = String(start.headers['set-cookie']).split(';')[0]!;
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/discord/callback?code=fake:u-1:andy&state=wrong',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('BAD_STATE');
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
