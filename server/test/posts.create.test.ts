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
  app.inject({ method: 'POST', url: '/api/posts', headers: c ? { cookie: c } : {}, payload: payload as any });
const body = (over: Record<string, unknown> = {}) => ({
  type: 'recruiting',
  characterId: lilyId,
  bossDifficultyIds: [hardLucid],
  scheduledAt: new Date(Date.now() + 24 * HOUR).toISOString(),
  partySize: 4,
  note: 'hi',
  ...over,
});

describe('POST /api/posts', () => {
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

  it('computes expiresAt', async () => {
    const at = new Date(Date.now() + 24 * HOUR);
    const a = (await post(body({ scheduledAt: at.toISOString() }))).json();
    expect(new Date(a.expiresAt).getTime()).toBe(at.getTime() + 3 * HOUR);
    const b = (await post(body({ scheduledAt: null }))).json();
    expect(new Date(b.expiresAt).getTime()).toBe(new Date(b.createdAt).getTime() + 7 * 24 * HOUR);
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
    ['scheduledAt 31 days ahead', { scheduledAt: new Date(Date.now() + 31 * 24 * HOUR).toISOString() }],
    ['scheduledAt 1h ago', { scheduledAt: new Date(Date.now() - HOUR).toISOString() }],
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
