import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  addMember, buildTestApp, loginAs, makeCharacter, makeGuild, makeJobClass, makePost, makeWorld, prisma, resetDb, type FakeNexon,
} from './helpers.js';

let app: FastifyInstance;
let nexon: FakeNexon;
let cookie: string;
let ownerId: string;
let challenger: number;
let kronos: number;
let guildId: string;

const CHALLENGER = 1;
const KRONOS = 45;
const SOLIS = 46;
const HYPERION = 47;

beforeEach(async () => {
  await resetDb();
  ({ app, nexon } = await buildTestApp());
  await makeJobClass('Hero', 'warrior');
  await makeJobClass('Bishop', 'magician');
  challenger = (await makeWorld({ nexonWorldId: CHALLENGER, name: 'Challenger', worldType: 'heroic' })).id;
  kronos = (await makeWorld({ nexonWorldId: KRONOS, name: 'Kronos', worldType: 'heroic' })).id;
  await makeWorld({ nexonWorldId: SOLIS, name: 'Solis', worldType: 'interactive' });
  await makeWorld({ nexonWorldId: HYPERION, name: 'Hyperion', worldType: 'heroic', active: false });
  guildId = (await makeGuild({ worldIds: [challenger] })).id;
  cookie = await loginAs(app, 'u-1', 'owner');
  ownerId = (await prisma.user.findUniqueOrThrow({ where: { discordId: 'u-1' } })).id;
});
afterAll(async () => {
  await prisma.$disconnect();
});

const refresh = (id: string) => app.inject({ method: 'POST', url: `/api/characters/${id}/refresh`, headers: { cookie } });
const move = (id: string, payload: unknown) =>
  app.inject({ method: 'POST', url: `/api/characters/${id}/move`, headers: { cookie }, payload: payload as any });
const expectError = (res: { statusCode: number; json: () => any }, status: number, code: string) => {
  expect(res.statusCode).toBe(status);
  expect(res.json().error.code).toBe(code);
};

const onNexon = (nexonWorldId: number, over: Record<string, unknown> = {}) => ({
  ign: 'Manny', nexonWorldId, level: 281, jobName: 'Bishop', imageUrl: `https://x/${nexonWorldId}.png`, ...over,
});

const manual = (over: Record<string, unknown> = {}) =>
  makeCharacter({
    ign: 'Manny', ownerId, worldId: challenger, guildId, level: 250, jobName: 'Hero', source: 'manual',
    imageUrl: '/default-character.svg', ...over,
  });

describe('refresh: nexon characters', () => {
  it('found -> synced with no candidates', async () => {
    const c = await makeCharacter({ ign: 'Manny', ownerId, worldId: challenger, guildId, level: 250 });
    nexon.set([onNexon(CHALLENGER)]);
    const res = await refresh(c.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      outcome: 'synced', candidates: [],
      character: { level: 281, jobName: 'Bishop', archetype: 'magician', syncStatus: 'ok', manual: false },
    });
    expect(nexon.calls).toEqual([{ ign: 'Manny', fresh: true }]);
  });

  it('not found -> stale, even if found on another world', async () => {
    const c = await makeCharacter({ ign: 'Manny', ownerId, worldId: challenger, guildId, level: 250 });
    nexon.set([onNexon(KRONOS)]);
    const res = await refresh(c.id);
    expect(res.json()).toMatchObject({ outcome: 'stale', candidates: [], character: { level: 250, syncStatus: 'stale' } });
    expect((await prisma.character.findUniqueOrThrow({ where: { id: c.id } })).syncStatus).toBe('stale');
  });

  it('Nexon unavailable -> stale', async () => {
    const c = await makeCharacter({ ign: 'Manny', ownerId, worldId: challenger, guildId, level: 250 });
    nexon.failNext();
    const res = await refresh(c.id);
    expect(res.json()).toMatchObject({ outcome: 'stale', candidates: [], character: { level: 250, syncStatus: 'stale' } });
  });
});

describe('refresh: manual characters', () => {
  it('found on its own world -> synced and no longer manual', async () => {
    const c = await manual({ lastSyncedAt: new Date(0) });
    nexon.set([onNexon(CHALLENGER)]);
    const res = await refresh(c.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      outcome: 'synced', candidates: [],
      character: {
        manual: false, level: 281, jobName: 'Bishop', archetype: 'magician', imageUrl: 'https://x/1.png',
        syncStatus: 'ok', world: { id: challenger }, guild: { id: guildId },
      },
    });
    const row = await prisma.character.findUniqueOrThrow({ where: { id: c.id } });
    expect(row.source).toBe('nexon');
    expect(row.lastSyncedAt.getTime()).toBeGreaterThan(Date.now() - 5_000);
    expect(nexon.calls).toEqual([{ ign: 'Manny', fresh: true }]);
  });

  it('found on its own world and another heroic world -> synced, no candidates', async () => {
    const c = await manual();
    nexon.set([onNexon(KRONOS), onNexon(CHALLENGER)]);
    const res = await refresh(c.id);
    expect(res.json()).toMatchObject({ outcome: 'synced', candidates: [], character: { world: { id: challenger }, manual: false } });
  });

  it('found only elsewhere -> found_elsewhere with same-type active worlds only, no write', async () => {
    const c = await manual();
    const before = await prisma.character.findUniqueOrThrow({ where: { id: c.id } });
    nexon.set([onNexon(SOLIS), onNexon(HYPERION), onNexon(KRONOS, { level: 270, jobName: 'Hero' }), onNexon(999)]);
    const res = await refresh(c.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      outcome: 'found_elsewhere',
      candidates: [{ worldId: kronos, worldName: 'Kronos', level: 270, jobName: 'Hero', imageUrl: 'https://x/45.png' }],
      character: { manual: true, level: 250, world: { id: challenger } },
    });
    expect(res.json().candidates).toHaveLength(1);
    const after = await prisma.character.findUniqueOrThrow({ where: { id: c.id } });
    expect({ ...after, lastRefreshRequestedAt: null }).toEqual({ ...before, lastRefreshRequestedAt: null });
  });

  it('sorts several candidates by world name', async () => {
    await makeWorld({ nexonWorldId: 48, name: 'Bera', worldType: 'heroic' });
    const c = await manual();
    nexon.set([onNexon(KRONOS), onNexon(48)]);
    const res = await refresh(c.id);
    expect(res.json().candidates.map((x: { worldName: string }) => x.worldName)).toEqual(['Bera', 'Kronos']);
  });

  it('not found -> not_found, syncStatus stays ok', async () => {
    const c = await manual();
    nexon.set([onNexon(SOLIS)]);
    const res = await refresh(c.id);
    expect(res.json()).toMatchObject({ outcome: 'not_found', candidates: [], character: { manual: true, level: 250, syncStatus: 'ok' } });
    expect((await prisma.character.findUniqueOrThrow({ where: { id: c.id } })).syncStatus).toBe('ok');
  });

  it('Nexon unavailable -> unavailable, row unchanged', async () => {
    const c = await manual();
    const before = await prisma.character.findUniqueOrThrow({ where: { id: c.id } });
    nexon.failNext();
    const res = await refresh(c.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ outcome: 'unavailable', candidates: [], character: { manual: true, syncStatus: 'ok' } });
    const after = await prisma.character.findUniqueOrThrow({ where: { id: c.id } });
    expect({ ...after, lastRefreshRequestedAt: null }).toEqual({ ...before, lastRefreshRequestedAt: null });
  });

  it('second refresh within 10 minutes -> 429 TOO_SOON', async () => {
    const c = await manual();
    expect((await refresh(c.id)).statusCode).toBe(200);
    expectError(await refresh(c.id), 429, 'TOO_SOON');
  });
});

describe('POST /api/characters/:id/move', () => {
  beforeEach(() => {
    nexon.set([onNexon(KRONOS)]);
  });

  it('moves to the candidate world with no guild', async () => {
    const c = await manual();
    const res = await move(c.id, { worldId: kronos, guildId: null });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      world: { id: kronos, name: 'Kronos' }, guild: null, manual: false,
      level: 281, jobName: 'Bishop', archetype: 'magician', imageUrl: 'https://x/45.png', syncStatus: 'ok',
    });
    const row = await prisma.character.findUniqueOrThrow({ where: { id: c.id } });
    expect(row).toMatchObject({ worldId: kronos, guildId: null, source: 'nexon', lastRefreshRequestedAt: null });
    expect(nexon.calls).toEqual([{ ign: 'Manny', fresh: true }]);
  });

  it('sets a new active guild', async () => {
    const c = await manual();
    const newGuild = (await makeGuild({ worldIds: [kronos] })).id;
    const res = await move(c.id, { worldId: kronos, guildId: newGuild });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ world: { id: kronos }, guild: { id: newGuild } });
  });

  it('rejects an inactive guild', async () => {
    const c = await manual();
    const inactive = (await makeGuild({ active: false })).id;
    expectError(await move(c.id, { worldId: kronos, guildId: inactive }), 400, 'GUILD_INACTIVE');
  });

  it('rejects a non-candidate world', async () => {
    const c = await manual();
    const solis = (await prisma.world.findUniqueOrThrow({ where: { nexonWorldId: SOLIS } })).id;
    const hyperion = (await prisma.world.findUniqueOrThrow({ where: { nexonWorldId: HYPERION } })).id;
    for (const worldId of [solis, hyperion, challenger, 9999]) {
      const res = await move(c.id, { worldId, guildId: null });
      expectError(res, 400, 'WRONG_WORLD');
      expect(res.json().error.message).toBe("That world isn't an option for this character");
    }
  });

  it('refuses while the character is in an open post', async () => {
    const c = await manual();
    const post = await makePost({ worldId: challenger, guildId });
    await addMember(post.id, c.id);
    const res = await move(c.id, { worldId: kronos, guildId: null });
    expectError(res, 409, 'IN_PARTY');
    expect(res.json().error.message).toBe('Leave or close your open parties first');
  });

  it('refuses while the character is the poster of a full post', async () => {
    const c = await manual();
    await makePost({ posterCharacterId: c.id, status: 'full' });
    expectError(await move(c.id, { worldId: kronos, guildId: null }), 409, 'IN_PARTY');
  });

  it('refuses with a pending join request', async () => {
    const c = await manual();
    const post = await makePost({ worldId: challenger, guildId });
    await prisma.request.create({ data: { kind: 'join_request', postId: post.id, characterId: c.id, createdByUserId: ownerId } });
    expectError(await move(c.id, { worldId: kronos, guildId: null }), 409, 'IN_PARTY');
  });

  it('a closed or expired post does not block', async () => {
    const c = await manual();
    const closed = await makePost({ worldId: challenger, guildId, status: 'closed' });
    const expired = await makePost({ worldId: challenger, guildId, expiresAt: new Date(Date.now() - 60_000) });
    await addMember(closed.id, c.id);
    await addMember(expired.id, c.id);
    expect((await move(c.id, { worldId: kronos, guildId: null })).statusCode).toBe(200);
  });

  it('409 ALREADY_CLAIMED when the IGN already exists on the target world', async () => {
    const c = await manual();
    await makeCharacter({ ign: 'manny', worldId: kronos });
    expectError(await move(c.id, { worldId: kronos, guildId: null }), 409, 'ALREADY_CLAIMED');
    expect((await prisma.character.findUniqueOrThrow({ where: { id: c.id } })).worldId).toBe(challenger);
  });

  it('400 NOT_MANUAL for a nexon character', async () => {
    const c = await makeCharacter({ ign: 'Manny', ownerId, worldId: challenger, guildId });
    expectError(await move(c.id, { worldId: kronos, guildId: null }), 400, 'NOT_MANUAL');
  });

  it('404 CHARACTER_NOT_FOUND when Nexon no longer lists it there', async () => {
    const c = await manual();
    nexon.set([onNexon(SOLIS)]);
    expectError(await move(c.id, { worldId: kronos, guildId: null }), 404, 'CHARACTER_NOT_FOUND');
  });

  it('502 NEXON_UNAVAILABLE when Nexon is down', async () => {
    const c = await manual();
    nexon.failNext();
    expectError(await move(c.id, { worldId: kronos, guildId: null }), 502, 'NEXON_UNAVAILABLE');
  });

  it('403 for a non-owner', async () => {
    const c = await manual();
    const other = await loginAs(app, 'u-2', 'other');
    const res = await app.inject({
      method: 'POST', url: `/api/characters/${c.id}/move`, headers: { cookie: other }, payload: { worldId: kronos, guildId: null },
    });
    expect(res.statusCode).toBe(403);
  });
});
