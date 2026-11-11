import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildTestApp, loginAs, makeBossDifficulty, makeCharacter, makeGuild, makeWorld, prisma, resetDb, type RecordingEvents,
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

  it('guildless character -> 400 NO_GUILD', async () => {
    await prisma.character.update({ where: { id: lilyId }, data: { guildId: null } });
    const res = await post(body());
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('NO_GUILD');
  });

  it('inactive guild / world -> 400', async () => {
    await prisma.guild.update({ where: { id: guildId }, data: { active: false } });
    expect((await post(body())).json().error.code).toBe('GUILD_INACTIVE');
    await prisma.guild.update({ where: { id: guildId }, data: { active: true } });
    await prisma.world.updateMany({ data: { active: false } });
    const res = await post(body());
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('WORLD_INACTIVE');
  });
});
