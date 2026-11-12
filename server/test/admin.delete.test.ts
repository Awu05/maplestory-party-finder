import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, loginAs, makeCharacter, makeGuild, makePost, makeUser, makeWorld, prisma, resetDb } from './helpers.js';

let app: FastifyInstance;
let admin: string;
let plain: string;

beforeEach(async () => {
  await resetDb();
  ({ app } = await buildTestApp());
  admin = await loginAs(app, 'admin-1', 'boss');
  plain = await loginAs(app, 'u-2', 'plain');
});
afterAll(async () => {
  await prisma.$disconnect();
});

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie: string | null = admin, payload?: unknown) =>
  app.inject({ method, url, headers: cookie ? { cookie } : {}, payload: payload as any });

const HOOK = 'https://discord.com/api/webhooks/123/abc-DEF';

describe('DELETE /admin/guilds/:id', () => {
  it('requires an admin', async () => {
    const g = await makeGuild();
    for (const [m, u] of [['DELETE', `/api/admin/guilds/${g.id}`], ['GET', `/api/admin/guilds/${g.id}/usage`]] as const) {
      expect((await call(m, u, null)).statusCode).toBe(401);
      expect((await call(m, u, plain)).statusCode).toBe(403);
    }
    expect(await prisma.guild.count()).toBe(1);
  });

  it('404 when missing', async () => {
    expect((await call('DELETE', '/api/admin/guilds/nope')).statusCode).toBe(404);
    expect((await call('GET', '/api/admin/guilds/nope/usage')).statusCode).toBe(404);
  });

  it('deletes an in-use guild: characters guildless, posts lose it, links and deliveries go, announced ids pruned', async () => {
    const w = await makeWorld();
    const g = await makeGuild({ worldIds: [w.id], webhookUrl: HOOK });
    const other = await makeGuild({ worldIds: [w.id], webhookUrl: HOOK });
    const c = await makeCharacter({ worldId: w.id, guildId: g.id });
    const post = await makePost({ posterCharacterId: c.id, guildId: g.id, notificationGuildId: g.id, partyForumGuildId: g.id, announcedGuildIds: [g.id, other.id] });
    await prisma.webhookDelivery.create({ data: { guildId: g.id, eventType: 'test', payload: {} } });
    await prisma.webhookDelivery.create({ data: { guildId: other.id, eventType: 'test', payload: {} } });

    const usage = await call('GET', `/api/admin/guilds/${g.id}/usage`);
    expect(usage.json()).toEqual({ characters: 1, posts: 1 });

    const res = await call('DELETE', `/api/admin/guilds/${g.id}`);
    expect(res.statusCode).toBe(204);
    expect(await prisma.guild.findUnique({ where: { id: g.id } })).toBeNull();
    expect((await prisma.character.findUniqueOrThrow({ where: { id: c.id } })).guildId).toBeNull();
    const p = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect([p.guildId, p.notificationGuildId, p.partyForumGuildId]).toEqual([null, null, null]);
    expect(p.announcedGuildIds).toEqual([other.id]);
    expect(await prisma.guildWorld.count({ where: { guildId: g.id } })).toBe(0);
    expect(await prisma.webhookDelivery.count()).toBe(1);
  });

  it('usage counts only live posts', async () => {
    const w = await makeWorld();
    const g = await makeGuild({ worldIds: [w.id] });
    const c = await makeCharacter({ worldId: w.id, guildId: g.id });
    await makePost({ posterCharacterId: c.id, guildId: g.id });
    await makePost({ posterCharacterId: c.id, guildId: g.id, deletedAt: new Date() });
    expect((await call('GET', `/api/admin/guilds/${g.id}/usage`)).json()).toEqual({ characters: 1, posts: 1 });
  });
});

describe('DELETE /admin/worlds/:id', () => {
  it('requires an admin', async () => {
    const w = await makeWorld();
    for (const [m, u] of [['DELETE', `/api/admin/worlds/${w.id}`], ['GET', `/api/admin/worlds/${w.id}/usage`]] as const) {
      expect((await call(m, u, null)).statusCode).toBe(401);
      expect((await call(m, u, plain)).statusCode).toBe(403);
    }
  });

  it('404 for a missing world; 409 NO_KRONOS without a Kronos world; 409 for Kronos itself', async () => {
    expect((await call('DELETE', '/api/admin/worlds/999')).statusCode).toBe(404);
    const other = await makeWorld({ nexonWorldId: 1, name: 'Bera' });
    const noKronos = await call('DELETE', `/api/admin/worlds/${other.id}`);
    expect(noKronos.statusCode).toBe(409);
    expect(noKronos.json().error).toMatchObject({ code: 'NO_KRONOS', message: 'Add a Kronos world before deleting other worlds.' });
    const kronos = await makeWorld({ nexonWorldId: 45, name: 'kronos' });
    const self = await call('DELETE', `/api/admin/worlds/${kronos.id}`);
    expect(self.statusCode).toBe(409);
    expect(self.json().error).toMatchObject({ code: 'CANNOT_DELETE_KRONOS', message: "Kronos is the default world and can't be deleted." });
  });

  it('moves characters and posts to Kronos, marks Nexon characters stale, drops links, clears unserved destinations', async () => {
    const kronos = await makeWorld({ nexonWorldId: 45, name: 'Kronos' });
    const bera = await makeWorld({ nexonWorldId: 1, name: 'Bera' });
    const both = await makeGuild({ worldIds: [kronos.id, bera.id], webhookUrl: HOOK, partyForumWebhookUrl: HOOK });
    const beraOnly = await makeGuild({ worldIds: [bera.id], webhookUrl: HOOK, partyForumWebhookUrl: HOOK });
    const nexonChar = await makeCharacter({ worldId: bera.id, guildId: both.id, source: 'nexon' });
    const manualChar = await makeCharacter({ worldId: bera.id, guildId: both.id, source: 'manual' });
    const post = await makePost({ posterCharacterId: nexonChar.id, notificationGuildId: both.id, partyForumGuildId: beraOnly.id });
    expect((await call('GET', `/api/admin/worlds/${bera.id}/usage`)).json()).toEqual({ characters: 2, posts: 1 });

    const res = await call('DELETE', `/api/admin/worlds/${bera.id}`);
    expect(res.statusCode).toBe(204);
    expect(await prisma.world.findUnique({ where: { id: bera.id } })).toBeNull();
    const n = await prisma.character.findUniqueOrThrow({ where: { id: nexonChar.id } });
    const m = await prisma.character.findUniqueOrThrow({ where: { id: manualChar.id } });
    expect([n.worldId, n.syncStatus]).toEqual([kronos.id, 'stale']);
    expect([m.worldId, m.syncStatus]).toEqual([kronos.id, 'ok']);
    const p = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect([p.worldId, p.notificationGuildId, p.partyForumGuildId]).toEqual([kronos.id, both.id, null]);
    expect(await prisma.guildWorld.findMany({ where: { worldId: bera.id } })).toEqual([]);
    expect(await prisma.guildWorld.count({ where: { worldId: kronos.id } })).toBe(1);
  });

  it('refuses with WORLD_NAME_CLASH and changes nothing', async () => {
    const kronos = await makeWorld({ nexonWorldId: 45, name: 'Kronos' });
    const bera = await makeWorld({ nexonWorldId: 1, name: 'Bera' });
    await makeCharacter({ worldId: kronos.id, guildId: null, ign: 'Dupe' });
    const moving = await makeCharacter({ worldId: bera.id, guildId: null, ign: 'dupe' });
    await makeCharacter({ worldId: bera.id, guildId: null, ign: 'Fine' });
    const res = await call('DELETE', `/api/admin/worlds/${bera.id}`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'WORLD_NAME_CLASH', igns: ['dupe'], message: 'These characters already exist on Kronos: dupe. Rename or remove them first.' });
    expect(await prisma.world.findUnique({ where: { id: bera.id } })).not.toBeNull();
    expect((await prisma.character.findUniqueOrThrow({ where: { id: moving.id } })).worldId).toBe(bera.id);
  });
});

describe('webhook delivery records', () => {
  const mk = async (guildId: string, status: 'pending' | 'sent' | 'failed') =>
    prisma.webhookDelivery.create({ data: { guildId, eventType: 'test', payload: {}, status } });

  it('requires an admin', async () => {
    const g = await makeGuild();
    const d = await mk(g.id, 'failed');
    for (const url of [`/api/admin/webhooks/deliveries/${d.id}`, '/api/admin/webhooks/deliveries?status=failed']) {
      expect((await call('DELETE', url, null)).statusCode).toBe(401);
      expect((await call('DELETE', url, plain)).statusCode).toBe(403);
    }
    expect(await prisma.webhookDelivery.count()).toBe(1);
  });

  it('removes one record of any status; 404 when missing', async () => {
    const g = await makeGuild();
    const sent = await mk(g.id, 'sent');
    const pending = await mk(g.id, 'pending');
    expect((await call('DELETE', `/api/admin/webhooks/deliveries/${sent.id}`)).statusCode).toBe(204);
    expect((await call('DELETE', `/api/admin/webhooks/deliveries/${sent.id}`)).statusCode).toBe(404);
    expect((await prisma.webhookDelivery.findMany()).map((d) => d.id)).toEqual([pending.id]);
  });

  it('clears all failed records only', async () => {
    const g = await makeGuild();
    await mk(g.id, 'failed');
    await mk(g.id, 'failed');
    const keep = await mk(g.id, 'sent');
    expect((await call('DELETE', '/api/admin/webhooks/deliveries?status=failed')).statusCode).toBe(204);
    expect((await prisma.webhookDelivery.findMany()).map((d) => d.id)).toEqual([keep.id]);
    expect((await call('DELETE', '/api/admin/webhooks/deliveries?status=sent')).statusCode).toBe(400);
    expect((await call('DELETE', '/api/admin/webhooks/deliveries')).statusCode).toBe(400);
  });
});
