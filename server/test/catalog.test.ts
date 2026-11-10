import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, loginAs, makeBossDifficulty, makeCharacter, makeGuild, makeWorld, prisma, resetDb } from './helpers.js';

let app: FastifyInstance;
let admin: string;
let user: string;

beforeEach(async () => {
  await resetDb();
  ({ app } = await buildTestApp());
  admin = await loginAs(app, 'admin-1', 'boss');
  user = await loginAs(app, 'u-2', 'plain');
});
afterAll(async () => {
  await prisma.$disconnect();
});

const WEBHOOK = 'https://discord.com/api/webhooks/123/abc-DEF';

describe('catalog', () => {
  it('non-admin cannot POST /api/admin/guilds, visitor gets 401', async () => {
    const r1 = await app.inject({ method: 'POST', url: '/api/admin/guilds', headers: { cookie: user }, payload: { name: 'X', worldIds: [] } });
    expect(r1.statusCode).toBe(403);
    const r2 = await app.inject({ method: 'POST', url: '/api/admin/guilds', payload: { name: 'X', worldIds: [] } });
    expect(r2.statusCode).toBe(401);
  });

  it('every catalog admin route: visitor 401, non-admin 403, nothing changes', async () => {
    const world = await makeWorld({ name: 'Kronos' });
    const guild = await makeGuild({ name: 'G', worldIds: [world.id] });
    const bd = await makeBossDifficulty({ bossName: 'Lucid' });
    const routes: ['GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', string, object?][] = [
      ['GET', '/api/admin/guilds'],
      ['POST', '/api/admin/guilds', { name: 'X', worldIds: [world.id] }],
      ['PATCH', `/api/admin/guilds/${guild.id}`, { name: 'Renamed', active: false }],
      ['POST', '/api/admin/worlds', { nexonWorldId: 99, name: 'New', worldType: 'heroic' }],
      ['PATCH', `/api/admin/worlds/${world.id}`, { name: 'Renamed', active: false }],
      ['POST', '/api/admin/bosses', { name: 'Will', difficulties: [{ difficulty: 'Hard' }] }],
      ['PATCH', `/api/admin/bosses/${bd.bossId}`, { name: 'Renamed' }],
      ['DELETE', `/api/admin/bosses/${bd.bossId}`],
      ['PUT', '/api/admin/rarity-tiers', { tiers: [{ name: 'Gold', minCp: 1, sortOrder: 0 }] }],
    ];
    for (const [method, url, payload] of routes) {
      const visitor = await app.inject({ method, url, ...(payload ? { payload } : {}) });
      expect(visitor.statusCode, `visitor ${method} ${url}`).toBe(401);
      const plain = await app.inject({ method, url, headers: { cookie: user }, ...(payload ? { payload } : {}) });
      expect(plain.statusCode, `non-admin ${method} ${url}`).toBe(403);
    }
    expect(await prisma.guild.findMany({ select: { name: true, active: true } })).toEqual([{ name: 'G', active: true }]);
    expect(await prisma.world.findMany({ select: { name: true, active: true } })).toEqual([{ name: 'Kronos', active: true }]);
    expect(await prisma.boss.findMany({ select: { name: true } })).toEqual([{ name: 'Lucid' }]);
    expect(await prisma.rarityTier.count()).toBe(0);
  });

  it('admin creates guild with worlds', async () => {
    const kronos = await makeWorld();
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/guilds',
      headers: { cookie: admin },
      payload: { name: 'Moonlight', webhookUrl: WEBHOOK, worldIds: [kronos.id] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Moonlight', worldIds: [kronos.id], webhookUrl: WEBHOOK, active: true });
  });

  it('public GET /api/guilds never exposes webhook urls', async () => {
    const w = await makeWorld();
    await makeGuild({ worldIds: [w.id], webhookUrl: WEBHOOK });
    for (const headers of [{}, { cookie: user }]) {
      const res = await app.inject({ method: 'GET', url: '/api/guilds', headers });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(1);
      expect(JSON.stringify(res.json())).not.toContain('webhooks');
      expect(res.json()[0]).not.toHaveProperty('webhookUrl');
    }
  });

  it('bad webhook url -> 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/guilds',
      headers: { cookie: admin },
      payload: { name: 'Bad', webhookUrl: 'https://evil.com/api/webhooks/1/a', worldIds: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('duplicate guild name -> 409 and unknown world -> 400', async () => {
    const payload = { name: 'Dup', worldIds: [] };
    await app.inject({ method: 'POST', url: '/api/admin/guilds', headers: { cookie: admin }, payload });
    const dup = await app.inject({ method: 'POST', url: '/api/admin/guilds', headers: { cookie: admin }, payload });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('DUPLICATE');
    const bad = await app.inject({ method: 'POST', url: '/api/admin/guilds', headers: { cookie: admin }, payload: { name: 'Z', worldIds: [9999] } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('VALIDATION');
  });

  it('PATCH active:false hides guild from public list but not admin list; worldIds replaces', async () => {
    const w1 = await makeWorld();
    const w2 = await makeWorld({ nexonWorldId: 46, name: 'Bera' });
    const g = await makeGuild({ worldIds: [w1.id] });
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/admin/guilds/${g.id}`,
      headers: { cookie: admin },
      payload: { active: false, worldIds: [w2.id] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().worldIds).toEqual([w2.id]);
    const pub = await app.inject({ method: 'GET', url: '/api/guilds' });
    expect(pub.json()).toHaveLength(0);
    const adm = await app.inject({ method: 'GET', url: '/api/admin/guilds', headers: { cookie: admin } });
    expect(adm.json()).toHaveLength(1);
  });

  it('worlds: ?all=1 only honoured for admin; admin can create and patch', async () => {
    await makeWorld({ active: false });
    const asUser = await app.inject({ method: 'GET', url: '/api/worlds?all=1', headers: { cookie: user } });
    expect(asUser.json()).toHaveLength(0);
    const adm = await app.inject({ method: 'GET', url: '/api/worlds?all=1', headers: { cookie: admin } });
    expect(adm.json()).toHaveLength(1);
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/worlds',
      headers: { cookie: admin },
      payload: { nexonWorldId: 99, name: 'Luna', worldType: 'interactive' },
    });
    expect(created.statusCode).toBe(201);
    const dup = await app.inject({
      method: 'POST',
      url: '/api/admin/worlds',
      headers: { cookie: admin },
      payload: { nexonWorldId: 99, name: 'Luna2', worldType: 'interactive' },
    });
    expect(dup.statusCode).toBe(409);
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/admin/worlds/${created.json().id}`,
      headers: { cookie: admin },
      payload: { active: false },
    });
    expect(patched.json().active).toBe(false);
  });

  it('rarity tiers PUT then GET returns ascending; large minCp round-trips', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/admin/rarity-tiers',
      headers: { cookie: admin },
      payload: {
        tiers: [
          { name: 'Epic', minCp: 1_500_000_000, sortOrder: 2 },
          { name: 'Common', minCp: 0, sortOrder: 1 },
        ],
      },
    });
    expect(put.statusCode).toBe(200);
    const res = await app.inject({ method: 'GET', url: '/api/rarity-tiers' });
    expect(res.json().map((t: { name: string; minCp: number }) => [t.name, t.minCp])).toEqual([
      ['Common', 0],
      ['Epic', 1_500_000_000],
    ]);
  });

  it('PUT tiers without base -> 400 NEEDS_BASE_TIER', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/admin/rarity-tiers',
      headers: { cookie: admin },
      payload: { tiers: [{ name: 'Epic', minCp: 5, sortOrder: 1 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('NEEDS_BASE_TIER');
  });

  it('bosses: create, list sorted, patch adds/updates/removes unreferenced', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/bosses',
      headers: { cookie: admin },
      payload: {
        name: 'Lucid',
        sortOrder: 1,
        difficulties: [
          { difficulty: 'Hard', partyCap: 3, sortOrder: 2 },
          { difficulty: 'Easy', sortOrder: 1 },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: '/api/bosses' });
    expect(list.json()[0].difficulties.map((d: { difficulty: string }) => d.difficulty)).toEqual(['Easy', 'Hard']);
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/admin/bosses/${created.json().id}`,
      headers: { cookie: admin },
      payload: { difficulties: [{ difficulty: 'Hard', partyCap: 4 }, { difficulty: 'Normal' }] },
    });
    expect(patched.statusCode).toBe(200);
    expect(
      patched
        .json()
        .difficulties.map((d: { difficulty: string; partyCap: number }) => [d.difficulty, d.partyCap])
        .sort(),
    ).toEqual([
      ['Hard', 4],
      ['Normal', 6],
    ]);
  });

  it('deleting a boss difficulty referenced by a CharacterBoss -> 409 IN_USE', async () => {
    const bd = await makeBossDifficulty({ difficulty: 'Hard', bossName: 'Zakum' });
    const c = await makeCharacter();
    await prisma.characterBoss.create({ data: { characterId: c.id, bossDifficultyId: bd.id, experience: 'cleared' } });
    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/admin/bosses/${bd.bossId}`,
      headers: { cookie: admin },
      payload: { difficulties: [{ difficulty: 'Normal' }] },
    });
    expect(patch.statusCode).toBe(409);
    expect(patch.json().error.code).toBe('IN_USE');
    expect(await prisma.bossDifficulty.count({ where: { bossId: bd.bossId } })).toBe(1);
    const del = await app.inject({ method: 'DELETE', url: `/api/admin/bosses/${bd.bossId}`, headers: { cookie: admin } });
    expect(del.statusCode).toBe(409);
    expect(del.json().error.code).toBe('IN_USE');
  });

  it('deletes an unreferenced boss', async () => {
    const bd = await makeBossDifficulty();
    const del = await app.inject({ method: 'DELETE', url: `/api/admin/bosses/${bd.bossId}`, headers: { cookie: admin } });
    expect(del.statusCode).toBe(204);
  });
});
