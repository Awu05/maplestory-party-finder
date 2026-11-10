import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  addMember, buildTestApp, loginAs, makeBossDifficulty, makeCharacter, makeGuild, makePost, makeUser, makeWorld, prisma, resetDb,
} from './helpers.js';

const HOUR = 3_600_000;
let app: FastifyInstance;
let worldId: number;
let guildId: string;
let lucid: number;
let lucidNormal: number;
let limbo: number;
let lucidBossId: number;

beforeEach(async () => {
  await resetDb();
  ({ app } = await buildTestApp());
  worldId = (await makeWorld({ nexonWorldId: 45, name: 'Kronos' })).id;
  guildId = (await makeGuild({ worldIds: [worldId] })).id;
  const l = await makeBossDifficulty({ bossName: 'Lucid', difficulty: 'Hard' });
  lucid = l.id;
  lucidBossId = l.bossId;
  lucidNormal = (await makeBossDifficulty({ bossId: l.bossId, difficulty: 'Normal' })).id;
  limbo = (await makeBossDifficulty({ bossName: 'Limbo' })).id;
});
afterAll(async () => {
  await prisma.$disconnect();
});

const list = async (qs = '', cookie?: string) => {
  const res = await app.inject({ method: 'GET', url: `/api/posts${qs}`, headers: cookie ? { cookie } : {} });
  expect(res.statusCode).toBe(200);
  return res.json() as { id: string }[];
};
const mk = (over: Parameters<typeof makePost>[0] = {}) => makePost({ worldId, guildId, bossDifficultyIds: [lucid], ...over });

describe('GET /api/posts', () => {
  it('lists open posts newest first', async () => {
    const a = await mk({ createdAt: new Date(Date.now() - 3 * HOUR) });
    const b = await mk({ createdAt: new Date(Date.now() - HOUR) });
    const c = await mk({ createdAt: new Date(Date.now() - 2 * HOUR) });
    expect((await list()).map((p) => p.id)).toEqual([b.id, c.id, a.id]);
  });

  it('filters', async () => {
    const lfp = await mk({ type: 'lfp', partySize: null });
    const limboPost = await mk({ bossDifficultyIds: [limbo] });
    const normalPost = await mk({ bossDifficultyIds: [lucidNormal] });
    const otherGuild = await makeGuild({ worldIds: [worldId] });
    const gPost = await mk({ guildId: otherGuild.id });
    const w2 = await makeWorld({ nexonWorldId: 46, name: 'Bera' });
    const wPost = await mk({ worldId: w2.id, guildId: (await makeGuild({ worldIds: [w2.id] })).id });
    const soon = await mk({ scheduledAt: new Date(Date.now() + 2 * HOUR) });
    const later = await mk({ scheduledAt: new Date(Date.now() + 10 * 24 * HOUR) });
    const flex = await mk({ scheduledAt: null });
    const ids = async (qs: string) => (await list(qs)).map((p) => p.id).sort();

    expect(await ids('?type=lfp')).toEqual([lfp.id]);
    expect(await ids(`?bossId=${lucidBossId}`)).toContain(normalPost.id);
    expect(await ids(`?bossId=${lucidBossId}`)).not.toContain(limboPost.id);
    expect(await ids(`?bossDifficultyId=${lucidNormal}`)).toEqual([normalPost.id]);
    expect(await ids(`?guildId=${otherGuild.id}`)).toEqual([gPost.id]);
    expect(await ids(`?worldIds=${w2.id}`)).toEqual([wPost.id]);
    expect(await ids(`?worldIds=${w2.id},${worldId + 100}`)).toEqual([wPost.id]);
    const to = new Date(Date.now() + 5 * 24 * HOUR).toISOString();
    const from = new Date().toISOString();
    expect(await ids(`?from=${from}&to=${to}&bossDifficultyId=${lucid}&guildId=${guildId}`)).toContain(soon.id);
    expect(await ids(`?from=${from}&to=${to}`)).not.toContain(later.id);
    expect(await ids(`?from=${from}&to=${to}`)).not.toContain(flex.id);
    expect(await ids(`?from=${to}`)).toEqual([later.id]);
    expect(await ids('?flexible=1')).toEqual([flex.id]);
  });

  it('flexible=1 returns only unfinalized posts, with or without free times', async () => {
    const finalized = await mk({ scheduledAt: new Date(Date.now() + 2 * HOUR) });
    const finalizedWithGrid = await mk({ scheduledAt: new Date(Date.now() + 2 * HOUR), freeTimes: [68], freeTimesZone: 'America/New_York' });
    const open = await mk({ scheduledAt: null });
    const grid = await mk({ scheduledAt: null, freeTimes: [68], freeTimesZone: 'America/New_York' });
    const ids = (await list('?flexible=1')).map((p) => p.id).sort();
    expect(ids).toEqual([open.id, grid.id].sort());
    expect(ids).not.toContain(finalized.id);
    expect(ids).not.toContain(finalizedWithGrid.id);
  });

  it('serializes freeTimes and freeTimesZone', async () => {
    const p = await mk({ scheduledAt: null, freeTimes: [20, 68], freeTimesZone: 'America/New_York' });
    const q = await mk({ scheduledAt: null });
    const rows = (await list()) as unknown as { id: string; freeTimes: number[]; freeTimesZone: string | null }[];
    expect(rows.find((r) => r.id === p.id)).toMatchObject({ freeTimes: [20, 68], freeTimesZone: 'America/New_York' });
    expect(rows.find((r) => r.id === q.id)).toMatchObject({ freeTimes: [], freeTimesZone: null });
  });

  describe('freeAt', () => {
    // Tue 2026-11-10 20:00 in New York (EST, UTC-5) is hour-of-week 2 * 24 + 20 = 68.
    const ny = (over: Parameters<typeof makePost>[0] = {}) =>
      mk({ scheduledAt: null, freeTimes: [68], freeTimesZone: 'America/New_York', ...over });
    const ids = async (qs: string) => (await list(qs)).map((p) => p.id).sort();

    it("matches the instant's hour-of-week in the post's own zone", async () => {
      const p = await ny();
      // Tue 5pm in Los Angeles = Tue 8pm in New York.
      expect(await ids('?freeAt=2026-11-11T01:00:00Z')).toEqual([p.id]);
      // Tue 8pm in Los Angeles = Tue 11pm in New York.
      expect(await ids('?freeAt=2026-11-11T04:00:00Z')).toEqual([]);
    });

    it("uses each post's zone: the same wall hour in another zone matches a different instant", async () => {
      const nyPost = await ny();
      const kolkata = await mk({ scheduledAt: null, freeTimes: [68], freeTimesZone: 'Asia/Kolkata' });
      // Tue 20:00 in Kolkata (UTC+5:30) = 14:30Z; any minute in that hour matches.
      expect(await ids('?freeAt=2026-11-10T14:30:00Z')).toEqual([kolkata.id]);
      expect(await ids('?freeAt=2026-11-10T15:29:00Z')).toEqual([kolkata.id]);
      expect(await ids('?freeAt=2026-11-10T15:30:00Z')).toEqual([]);
      expect(await ids('?freeAt=2026-11-11T01:59:59Z')).toEqual([nyPost.id]);
    });

    it('a NY post free at 68 is found by the instant a Kolkata viewer sends for cell 78 (the last minute of that hour)', async () => {
      const p = await ny();
      // Kolkata cell 78 is Wed 6a IST; the web sends its last minute, 6:59 IST = 01:29Z = Tue 8:29pm EST.
      expect(await ids('?freeAt=2026-11-11T01:29:00.000Z')).toEqual([p.id]);
      // The start of that cell (6:00 IST = Tue 7:30pm EST) would land in poster hour 67 instead.
      expect(await ids('?freeAt=2026-11-11T00:30:00.000Z')).toEqual([]);
    });

    it('uses the post zone across a DST change (wall-clock hours, not fixed UTC hours)', async () => {
      const p = await ny();
      // Tue 2026-10-27 20:00 EDT (UTC-4) = 2026-10-28T00:00Z.
      expect(await ids('?freeAt=2026-10-28T00:00:00Z')).toEqual([p.id]);
      expect(await ids('?freeAt=2026-10-28T01:00:00Z')).toEqual([]);
    });

    it('a post with no zone or no free times never matches', async () => {
      const p = await ny();
      await mk({ scheduledAt: null });
      await mk({ scheduledAt: null, freeTimes: [], freeTimesZone: null });
      // Stored inconsistently (times without a zone): still never matches.
      await mk({ scheduledAt: null, freeTimes: [68], freeTimesZone: null });
      expect(await ids('?freeAt=2026-11-11T01:00:00Z')).toEqual([p.id]);
    });

    it('combines with other filters', async () => {
      const recruiting = await ny();
      const lfp = await ny({ type: 'lfp', partySize: null });
      await ny({ status: 'closed' });
      await ny({ expiresAt: new Date(Date.now() - 60_000) });
      expect(await ids('?freeAt=2026-11-11T01:00:00Z')).toEqual([recruiting.id, lfp.id].sort());
      expect(await ids('?freeAt=2026-11-11T01:00:00Z&type=lfp')).toEqual([lfp.id]);
      expect(await ids('?freeAt=2026-11-11T01:00:00Z&type=recruiting')).toEqual([recruiting.id]);
      expect(await ids('?freeAt=2026-11-11T04:00:00Z&type=lfp')).toEqual([]);
      expect(await ids(`?freeAt=2026-11-11T01:00:00Z&bossDifficultyId=${limbo}`)).toEqual([]);
    });
  });

  it('rejects invalid params', async () => {
    for (const qs of ['?worldIds=a,b', '?type=x', '?from=nope', '?freeAt=nope', '?bossId=x', `?flexible=1&from=${new Date().toISOString()}`, `?flexible=1&to=${new Date().toISOString()}`]) {
      const res = await app.inject({ method: 'GET', url: `/api/posts${qs}` });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION');
    }
  });

  it('hides posts stored open but already expired', async () => {
    const stale = await mk({ status: 'open', expiresAt: new Date(Date.now() - 60_000) });
    const fresh = await mk();
    const ids = (await list()).map((p) => p.id);
    expect(ids).toEqual([fresh.id]);
    expect(ids).not.toContain(stale.id);
  });

  it('does not list full, closed or deleted posts', async () => {
    const open = await mk();
    await mk({ status: 'full' });
    await mk({ status: 'closed' });
    await mk({ deletedAt: new Date() });
    expect((await list()).map((p) => p.id)).toEqual([open.id]);
  });
});

describe('GET /api/posts/:id', () => {
  const get = (id: string, cookie?: string) =>
    app.inject({ method: 'GET', url: `/api/posts/${id}`, headers: cookie ? { cookie } : {} });

  it('shows an open post to a visitor with members', async () => {
    const p = await mk();
    await addMember(p.id, (await makeCharacter({ worldId, guildId })).id);
    const res = await get(p.id);
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json).toMatchObject({
      id: p.id, memberCount: 2, isPoster: false, isMember: false, incomingRequests: [], sentInvites: [], myPending: [],
    });
    expect(json.members).toHaveLength(2);
    expect(json.members[0].role).toBe('poster');
    expect(json.bosses[0]).toMatchObject({ bossName: 'Lucid', difficulty: 'Hard' });
  });

  it('flags membership for a member', async () => {
    const p = await mk();
    const user = await makeUser({ discordId: 'u-9' });
    await addMember(p.id, (await makeCharacter({ worldId, guildId, ownerId: user.id })).id);
    const cookie = await loginAs(app, 'u-9', 'm');
    const json = (await get(p.id, cookie)).json();
    expect(json.isMember).toBe(true);
    expect(json.members.find((m: any) => m.role === 'member').isMine).toBe(true);
  });

  it('expired post: 404 for a stranger, 200 for the poster', async () => {
    const poster = await makeUser({ discordId: 'u-1' });
    const p = await mk({ posterUserId: poster.id, expiresAt: new Date(Date.now() - 60_000) });
    expect((await get(p.id)).statusCode).toBe(404);
    const stranger = await loginAs(app, 'u-2', 'x');
    const r404 = await get(p.id, stranger);
    expect(r404.statusCode).toBe(404);
    expect(r404.json().error.code).toBe('NOT_FOUND');
    const res = await get(p.id, await loginAs(app, 'u-1', 'p'));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'closed', isPoster: true });
  });

  it('deleted post: hidden from strangers, visible to admin', async () => {
    const p = await mk({ deletedAt: new Date() });
    expect((await get(p.id)).statusCode).toBe(404);
    const res = await get(p.id, await loginAs(app, 'admin-1', 'admin'));
    expect(res.statusCode).toBe(200);
    expect(res.json().deleted).toBe(true);
  });

  it('unknown id -> 404', async () => {
    expect((await get('nope')).statusCode).toBe(404);
  });

  it('guild in DTO has no webhookUrl', async () => {
    await prisma.guild.update({ where: { id: guildId }, data: { webhookUrl: 'https://discord.com/api/webhooks/1/secret' } });
    const p = await mk();
    const text = (await get(p.id)).body;
    expect(text).not.toContain('webhooks');
    expect(text).not.toContain('webhookUrl');
    expect((await app.inject({ method: 'GET', url: '/api/posts' })).body).not.toContain('webhooks');
  });
});
