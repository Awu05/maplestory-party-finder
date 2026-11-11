import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildTestApp, loginAs, makeBossDifficulty, makeCharacter, makeGuild, makePost, makeWorld, prisma, resetDb, type RecordingEvents,
} from './helpers.js';

const HOUR = 3_600_000;
let app: FastifyInstance;
let events: RecordingEvents;
let cookie: string;
let lilyId: string;
let hardLucid: number;
let normalLimbo: number;
let guildId: string;

beforeEach(async () => {
  await resetDb();
  ({ app, events } = await buildTestApp());
  const world = await makeWorld({ nexonWorldId: 45, name: 'Kronos' });
  guildId = (await makeGuild({ worldIds: [world.id] })).id;
  hardLucid = (await makeBossDifficulty({ bossName: 'Lucid', difficulty: 'Hard', partyCap: 6 })).id;
  normalLimbo = (await makeBossDifficulty({ bossName: 'Limbo', difficulty: 'Normal', partyCap: 3 })).id;
  cookie = await loginAs(app, 'u-1', 'owner');
  const owner = await prisma.user.findUniqueOrThrow({ where: { discordId: 'u-1' } });
  lilyId = (await makeCharacter({ ign: 'Lily', ownerId: owner.id, worldId: world.id, guildId, combatPower: 1_500_000_000n })).id;
});
afterAll(async () => {
  await prisma.$disconnect();
});

const post = (payload: unknown, c: string | null = cookie) =>
  app.inject({ method: 'POST', url: '/api/posts', headers: { ...(c ? { cookie: c } : {}), 'x-availability-version': '2' }, payload: payload as any });
const body = (over: Record<string, unknown> = {}) => ({
  type: 'recruiting',
  characterId: lilyId,
  bossDifficultyIds: [hardLucid],
  partySize: 4,
  note: 'hi',
  ...over,
});

describe('POST /api/posts', () => {
  it('allows a carrying post to invite and accept a player looking for a party', async () => {
    const created = await post(body({ type: 'carrying' }));
    expect(created.statusCode).toBe(201);
    const guestCookie = await loginAs(app, 'guest', 'guest');
    const guest = await prisma.user.findUniqueOrThrow({ where: { discordId: 'guest' } });
    const character = await makeCharacter({ ownerId: guest.id, guildId, worldId: created.json().world.id });
    const lfp = await makePost({ type: 'lfp', partySize: null, posterCharacterId: character.id, scheduledAt: null });
    const invite = await app.inject({ method: 'POST', url: `/api/posts/${lfp.id}/invites`, headers: { cookie }, payload: { recruitingPostId: created.json().id } });
    expect(invite.statusCode).toBe(201);
    const accepted = await app.inject({ method: 'POST', url: `/api/requests/${invite.json().id}/accept`, headers: { cookie: guestCookie } });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ type: 'carrying', memberCount: 2 });
  });
  it('supports carrying posts through joining, finalizing, My Parties, and reopening', async () => {
    const created = await post(body({ type: 'carrying' }));
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect(created.json()).toMatchObject({ type: 'carrying', partySize: 4, status: 'open' });
    const board = await app.inject({ method: 'GET', url: '/api/posts?type=carrying', headers: { cookie } });
    expect(board.json().map((row: { id: string }) => row.id)).toContain(id);
    const guestCookie = await loginAs(app, 'guest', 'guest');
    const guest = await prisma.user.findUniqueOrThrow({ where: { discordId: 'guest' } });
    const character = await makeCharacter({ ownerId: guest.id, guildId, worldId: created.json().world.id });
    const request = await app.inject({ method: 'POST', url: `/api/posts/${id}/requests`, headers: { cookie: guestCookie }, payload: { characterId: character.id } });
    expect(request.statusCode).toBe(201);
    const accepted = await app.inject({ method: 'POST', url: `/api/requests/${request.json().id}/accept`, headers: { cookie } });
    expect(accepted.statusCode).toBe(200);
    const final = await app.inject({ method: 'PUT', url: `/api/posts/${id}/final-time`, headers: { cookie }, payload: { scheduledAt: new Date(Date.now() + 86_400_000).toISOString(), repeatWeekly: true, timeZone: 'America/New_York' } });
    expect(final.statusCode).toBe(200);
    expect(final.json()).toMatchObject({ type: 'carrying', status: 'closed', recruitmentClosed: true, weeklyTimeZone: 'America/New_York' });
    const parties = await app.inject({ method: 'GET', url: '/api/me/parties', headers: { cookie } });
    expect(parties.json().map((row: { id: string }) => row.id)).toContain(id);
    const reopened = await app.inject({ method: 'POST', url: `/api/posts/${id}/reopen`, headers: { cookie } });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json()).toMatchObject({ type: 'carrying', status: 'open', scheduledAt: null });
  });
  it('rejects multiple difficulties of one boss on create and edit without changing the post', async () => {
    const hard = await prisma.bossDifficulty.findUniqueOrThrow({ where: { id: hardLucid } });
    const normal = await makeBossDifficulty({ bossId: hard.bossId, difficulty: 'Normal', partyCap: 6 });
    const selections = [hardLucid, normal.id];
    const invalid = await post(body({ bossDifficultyIds: selections }));
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.message).toBe('Select only one difficulty per boss');
    expect(await prisma.post.count()).toBe(0);
    const created = await post(body());
    expect(created.statusCode).toBe(201);
    const edited = await app.inject({ method: 'PATCH', url: `/api/posts/${created.json().id}`, headers: { cookie }, payload: { bossDifficultyIds: selections } });
    expect(edited.statusCode).toBe(400);
    expect(edited.json().error.message).toBe('Select only one difficulty per boss');
    const saved = await prisma.postBoss.findMany({ where: { postId: created.json().id } });
    expect(saved.map((boss) => boss.bossDifficultyId)).toEqual([hardLucid]);
    const replaced = await app.inject({ method: 'PATCH', url: `/api/posts/${created.json().id}`, headers: { cookie }, payload: { bossDifficultyIds: [normal.id] } });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json().bosses.map((boss: { bossDifficultyId: number }) => boss.bossDifficultyId)).toEqual([normal.id]);
  });
  it('accepts more than ten boss difficulties when creating and editing a post', async () => {
    const difficulties = await Promise.all(Array.from({ length: 12 }, () => makeBossDifficulty({ partyCap: 6 })));
    const ids = difficulties.map((difficulty) => difficulty.id);
    const created = await post(body({ bossDifficultyIds: ids.slice(0, 11) }));
    expect(created.statusCode).toBe(201);
    expect(created.json().bosses).toHaveLength(11);
    const edited = await app.inject({ method: 'PATCH', url: `/api/posts/${created.json().id}`, headers: { cookie }, payload: { bossDifficultyIds: ids } });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().bosses).toHaveLength(12);
  });
  it('rejects availability from a stale browser tab', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/posts', headers: { cookie }, payload: body({ freeTimes: [68], freeTimesZone: 'UTC' }) });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('STALE_CLIENT');
  });
  it('recruiting create -> 201', async () => {
    const res = await post(body());
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      type: 'recruiting', world: { name: 'Kronos' }, partySize: 4, memberCount: 1, status: 'open', isPoster: true,
      poster: { role: 'poster', snapshot: { ign: 'Lily' }, cpAtJoin: 1_500_000_000 },
    });
    expect(res.json().members).toHaveLength(1);
    expect(events.events).toContainEqual({ type: 'post.created', postId: res.json().id });
  });

  it('stores sorted unique free times and the zone, unfinalized, expiring created + 7 days', async () => {
    const res = await post(body({ freeTimes: [68, 20, 68], freeTimesZone: 'America/New_York' }));
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json).toMatchObject({ freeTimes: [20, 68], freeTimesZone: 'America/New_York', scheduledAt: null });
    expect(new Date(json.expiresAt).getTime()).toBe(new Date(json.createdAt).getTime() + 7 * 24 * HOUR);
    const row = await prisma.post.findUniqueOrThrow({ where: { id: json.id } });
    expect(row).toMatchObject({ freeTimes: [20, 68], freeTimesZone: 'America/New_York', scheduledAt: null });
    expect(row.expiresAt.getTime()).toBe(row.createdAt.getTime() + 7 * 24 * HOUR);
  });

  it("stores the zone's canonical name", async () => {
    const res = await post(body({ freeTimes: [20], freeTimesZone: 'america/new_york' }));
    expect(res.statusCode).toBe(201);
    expect(res.json().freeTimesZone).toBe('America/New_York');
    expect((await prisma.post.findUniqueOrThrow({ where: { id: res.json().id } })).freeTimesZone).toBe('America/New_York');
  });

  it('empty free times store no zone', async () => {
    const res = await post(body({ freeTimes: [], freeTimesZone: 'America/New_York' }));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ freeTimes: [], freeTimesZone: null });
    const omitted = await post(body());
    expect(omitted.statusCode).toBe(201);
    expect(omitted.json()).toMatchObject({ freeTimes: [], freeTimesZone: null });
  });

  it.each([
    ['a future scheduledAt', new Date(Date.now() + 24 * HOUR).toISOString()],
    ['a scheduledAt 31 days ahead', new Date(Date.now() + 31 * 24 * HOUR).toISOString()],
    ['a scheduledAt 1h ago', new Date(Date.now() - HOUR).toISOString()],
  ])('ignores %s in the body: the post is created unfinalized', async (_n, scheduledAt) => {
    const res = await post(body({ scheduledAt }));
    expect(res.statusCode).toBe(201);
    expect(res.json().scheduledAt).toBeNull();
    const row = await prisma.post.findUniqueOrThrow({ where: { id: res.json().id } });
    expect(row.scheduledAt).toBeNull();
    expect(row.expiresAt.getTime()).toBe(row.createdAt.getTime() + 7 * 24 * HOUR);
  });

  it('creates an lfp post without party size', async () => {
    const res = await post(body({ type: 'lfp', partySize: undefined }));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ type: 'lfp', partySize: null, minCp: null });
  });

  it.each([
    ['party size over the boss cap', { bossDifficultyIds: [normalLimbo], partySize: 4 }],
    ['party size 1', { partySize: 1 }],
    ['recruiting without party size', { partySize: undefined }],
    ['lfp with partySize', { type: 'lfp' }],
    ['lfp with minCp', { type: 'lfp', partySize: undefined, minCp: 5 }],
    ['freeTimes [336]', { freeTimes: [336], freeTimesZone: 'America/New_York' }],
    ['freeTimes [-1]', { freeTimes: [-1], freeTimesZone: 'America/New_York' }],
    ['freeTimes [1.5]', { freeTimes: [1.5], freeTimesZone: 'America/New_York' }],
    ['337 freeTimes entries', { freeTimes: Array.from({ length: 337 }, (_, i) => i % 336), freeTimesZone: 'America/New_York' }],
    ['freeTimes not an array', { freeTimes: 5, freeTimesZone: 'America/New_York' }],
    ['non-empty freeTimes with no zone', { freeTimes: [20] }],
    ['non-empty freeTimes with a null zone', { freeTimes: [20], freeTimesZone: null }],
    ['zone Mars/Base', { freeTimes: [20], freeTimesZone: 'Mars/Base' }],
    ['UTC-offset zone +05:30', { freeTimes: [20], freeTimesZone: '+05:30' }],
    ['UTC-offset zone -08:00', { freeTimes: [20], freeTimesZone: '-08:00' }],
    ['zone Mars/Base with empty freeTimes', { freeTimes: [], freeTimesZone: 'Mars/Base' }],
    ['duplicate bossDifficultyIds', { bossDifficultyIds: [hardLucid, hardLucid] }],
    ['unknown bossDifficultyId', { bossDifficultyIds: [999999] }],
    ['no bosses', { bossDifficultyIds: [] }],
    ['note too long', { note: 'x'.repeat(301) }],
  ])('rejects %s -> 400 VALIDATION', async (_n, over) => {
    const res = await post(body(over));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it("someone else's character -> 403 NOT_OWNER", async () => {
    const other = await loginAs(app, 'u-2', 'other');
    const res = await post(body(), other);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_OWNER');
  });

  it('visitor -> 401', async () => {
    expect((await post(body(), null)).statusCode).toBe(401);
  });

  it.each(['recruiting', 'carrying', 'lfp'] as const)('creates a %s post without a guild', async (type) => {
    await prisma.character.update({ where: { id: lilyId }, data: { guildId: null } });
    const res = await post(body({ type, ...(type === 'lfp' ? { partySize: undefined } : {}) }));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ type, guild: null });
    expect((await prisma.post.findUniqueOrThrow({ where: { id: res.json().id } })).guildId).toBeNull();
    const id = res.json().id;
    const edited = await app.inject({ method: 'PATCH', url: `/api/posts/${id}`, headers: { cookie }, payload: { note: 'No guild needed' } });
    expect(edited.statusCode).toBe(200);
    if (type !== 'lfp') {
      const finalized = await app.inject({ method: 'PUT', url: `/api/posts/${id}/final-time`, headers: { cookie }, payload: { scheduledAt: new Date(Date.now() + 86_400_000).toISOString() } });
      expect(finalized.statusCode).toBe(200);
      expect(finalized.json()).toMatchObject({ guild: null, recruitmentClosed: true });
    }
    expect((await app.inject({ method: 'POST', url: `/api/posts/${id}/close`, headers: { cookie } })).statusCode).toBe(200);
    const reopened = await app.inject({ method: 'POST', url: `/api/posts/${id}/reopen`, headers: { cookie } });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json()).toMatchObject({ guild: null, status: 'open' });
  });

  it('guild activity does not block posting, but an inactive world does', async () => {
    await prisma.guild.update({ where: { id: guildId }, data: { active: false } });
    expect((await post(body())).statusCode).toBe(201);
    await prisma.guild.update({ where: { id: guildId }, data: { active: true } });
    await prisma.world.updateMany({ data: { active: false } });
    const res = await post(body());
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('WORLD_INACTIVE');
  });
});
