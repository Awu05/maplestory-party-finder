import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
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

  it('prunes the guild from closed and deleted posts too, so no later notice targets it', async () => {
    const w = await makeWorld();
    const g = await makeGuild({ worldIds: [w.id], webhookUrl: HOOK });
    const c = await makeCharacter({ worldId: w.id, guildId: null });
    const closed = await makePost({ posterCharacterId: c.id, status: 'closed', closedReason: 'finalized', announcedGuildIds: [g.id], finalizedNoticeSent: true });
    const gone = await makePost({ posterCharacterId: c.id, deletedAt: new Date(), announcedGuildIds: [g.id] });
    expect((await call('DELETE', `/api/admin/guilds/${g.id}`)).statusCode).toBe(204);
    for (const p of [closed, gone]) expect((await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).announcedGuildIds).toEqual([]);
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
    expect((await call('GET', `/api/admin/worlds/${bera.id}/usage`)).json()).toEqual({ characters: 2, posts: 1, leavingGuild: { characters: 0, posts: 0 } });

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

  it('lists every clashing IGN and moves nothing at all', async () => {
    const kronos = await makeWorld({ nexonWorldId: 45, name: 'Kronos' });
    const bera = await makeWorld({ nexonWorldId: 1, name: 'Bera' });
    const g = await makeGuild({ worldIds: [bera.id] });
    await makeCharacter({ worldId: kronos.id, guildId: null, ign: 'One' });
    await makeCharacter({ worldId: kronos.id, guildId: null, ign: 'Two' });
    const a = await makeCharacter({ worldId: bera.id, guildId: g.id, ign: 'one' });
    const b = await makeCharacter({ worldId: bera.id, guildId: g.id, ign: 'TWO' });
    const fine = await makeCharacter({ worldId: bera.id, guildId: g.id, ign: 'Fine' });
    const post = await makePost({ posterCharacterId: fine.id, guildId: g.id });
    const res = await call('DELETE', `/api/admin/worlds/${bera.id}`);
    expect(res.statusCode).toBe(409);
    expect([...res.json().error.igns].sort()).toEqual(['TWO', 'one']);
    for (const c of [a, b, fine]) {
      const now = await prisma.character.findUniqueOrThrow({ where: { id: c.id } });
      expect([now.worldId, now.guildId, now.syncStatus]).toEqual([bera.id, g.id, 'ok']);
    }
    const p = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect([p.worldId, p.guildId]).toEqual([bera.id, g.id]);
    expect(await prisma.guildWorld.count({ where: { worldId: bera.id } })).toBe(1);
  });

  it('moves to Kronos matched case-insensitively', async () => {
    const kronos = await makeWorld({ nexonWorldId: 45, name: 'KRONOS' });
    const bera = await makeWorld({ nexonWorldId: 1, name: 'Bera' });
    const c = await makeCharacter({ worldId: bera.id, guildId: null });
    expect((await call('DELETE', `/api/admin/worlds/${bera.id}`)).statusCode).toBe(204);
    expect((await prisma.character.findUniqueOrThrow({ where: { id: c.id } })).worldId).toBe(kronos.id);
  });

  it('refuses while Kronos is inactive', async () => {
    await makeWorld({ nexonWorldId: 45, name: 'Kronos', active: false });
    const bera = await makeWorld({ nexonWorldId: 1, name: 'Bera' });
    const res = await call('DELETE', `/api/admin/worlds/${bera.id}`);
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: 'KRONOS_INACTIVE' });
    expect(await prisma.world.findUnique({ where: { id: bera.id } })).not.toBeNull();
  });

  it('characters and posts leave a guild that does not play on Kronos, and usage counts them', async () => {
    const kronos = await makeWorld({ nexonWorldId: 45, name: 'Kronos' });
    const bera = await makeWorld({ nexonWorldId: 1, name: 'Bera' });
    const both = await makeGuild({ worldIds: [kronos.id, bera.id] });
    const beraOnly = await makeGuild({ worldIds: [bera.id] });
    const stays = await makeCharacter({ worldId: bera.id, guildId: both.id });
    const leaves = await makeCharacter({ worldId: bera.id, guildId: beraOnly.id });
    const guildless = await makeCharacter({ worldId: bera.id, guildId: null });
    const keepPost = await makePost({ posterCharacterId: stays.id, guildId: both.id });
    const leavePost = await makePost({ posterCharacterId: leaves.id, guildId: beraOnly.id });
    await makePost({ posterCharacterId: leaves.id, guildId: beraOnly.id, deletedAt: new Date() });
    expect((await call('GET', `/api/admin/worlds/${bera.id}/usage`)).json()).toEqual({ characters: 3, posts: 2, leavingGuild: { characters: 1, posts: 1 } });

    expect((await call('DELETE', `/api/admin/worlds/${bera.id}`)).statusCode).toBe(204);
    const guildOf = async (id: string) => (await prisma.character.findUniqueOrThrow({ where: { id } })).guildId;
    expect([await guildOf(stays.id), await guildOf(leaves.id), await guildOf(guildless.id)]).toEqual([both.id, null, null]);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: keepPost.id } })).guildId).toBe(both.id);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: leavePost.id } })).guildId).toBeNull();
    // The guild itself is kept; it just no longer serves the deleted world.
    expect(await prisma.guild.findUnique({ where: { id: beraOnly.id } })).not.toBeNull();
  });

  it('a character created on the world mid-delete gives a 409 to retry, not a 500', async () => {
    await makeWorld({ nexonWorldId: 45, name: 'Kronos' });
    const bera = await makeWorld({ nexonWorldId: 1, name: 'Bera' });
    // Simulate the race: the world delete fails on a row that appeared after the move (FK or unique violation).
    for (const code of ['P2003', 'P2002']) {
      const spy = vi.spyOn(prisma, '$transaction').mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('race', { code, clientVersion: 'test' }),
      );
      try {
        const res = await call('DELETE', `/api/admin/worlds/${bera.id}`);
        expect(res.statusCode).toBe(409);
        expect(res.json().error).toMatchObject({ code: 'WORLD_CHANGED' });
      } finally {
        spy.mockRestore();
      }
    }
    expect(await prisma.world.findUnique({ where: { id: bera.id } })).not.toBeNull();
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
