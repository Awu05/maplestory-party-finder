import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildTestApp, loginAs, makeCharacter, makeGuild, makeJobClass, makeWorld, prisma, resetDb, type FakeNexon,
} from './helpers.js';

let app: FastifyInstance;
let nexon: FakeNexon;
let cookie: string;
let ownerId: string;
let worldId: number;
let guildId: string;

beforeEach(async () => {
  await resetDb();
  ({ app, nexon } = await buildTestApp());
  await makeJobClass('Hero', 'warrior');
  await makeJobClass('Bishop', 'magician');
  worldId = (await makeWorld({ nexonWorldId: 45, name: 'Kronos' })).id;
  guildId = (await makeGuild({ worldIds: [worldId] })).id;
  cookie = await loginAs(app, 'u-1', 'owner');
  ownerId = (await prisma.user.findUniqueOrThrow({ where: { discordId: 'u-1' } })).id;
});
afterAll(async () => {
  await prisma.$disconnect();
});

const body = (over: Record<string, unknown> = {}) => ({
  ign: 'Manny', worldId, jobName: 'hero', level: 250, combatPower: 5_000_000, guildId, ...over,
});
const create = (payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/characters/manual', headers: { cookie }, payload: payload as any });
const patch = (id: string, payload: unknown) =>
  app.inject({ method: 'PATCH', url: `/api/characters/${id}`, headers: { cookie }, payload: payload as any });
const expectError = (res: { statusCode: number; json: () => any }, status: number, code: string) => {
  expect(res.statusCode).toBe(status);
  expect(res.json().error.code).toBe(code);
};

describe('POST /api/characters/manual', () => {
  it('stores a manual character with the canonical class and archetype, without calling Nexon', async () => {
    const res = await create(body({ ign: '  Manny ' }));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      ign: 'Manny', jobName: 'Hero', archetype: 'warrior', level: 250, manual: true,
      imageUrl: '/default-character.svg', combatPower: 5_000_000, guild: { id: guildId },
    });
    const row = await prisma.character.findFirstOrThrow({ where: { ign: 'Manny' } });
    expect(row).toMatchObject({ source: 'manual', jobName: 'Hero', archetype: 'warrior', ownerId });
    expect(nexon.calls).toEqual([]);
  });

  it('rejects an unknown class', async () => {
    const res = await create(body({ jobName: 'Nope' }));
    expectError(res, 400, 'UNKNOWN_CLASS');
    expect(res.json().error.message).toBe('Pick a class from the list');
  });

  it('rejects an inactive world and an inactive guild', async () => {
    const w = await makeWorld({ nexonWorldId: 1, name: 'Bera', active: false });
    expectError(await create(body({ worldId: w.id })), 400, 'WORLD_INACTIVE');
    const g = await makeGuild({ active: false });
    expectError(await create(body({ guildId: g.id })), 400, 'GUILD_INACTIVE');
  });

  it('rejects levels outside 1..300', async () => {
    expect((await create(body({ level: 0 }))).statusCode).toBe(400);
    expect((await create(body({ level: 301 }))).statusCode).toBe(400);
  });

  it('409s on a name collision on the world, synced or manual', async () => {
    await makeCharacter({ ign: 'sunofsinz', worldId, guildId });
    expectError(await create(body({ ign: '  SunOfSinz ' })), 409, 'ALREADY_CLAIMED');
    expect((await create(body({ ign: 'Other' }))).statusCode).toBe(201);
    expectError(await create(body({ ign: 'OTHER' })), 409, 'ALREADY_CLAIMED');
  });
});

describe('PATCH class and level', () => {
  it('updates class, level and archetype on a manual character', async () => {
    const id = (await create(body())).json().id;
    const res = await patch(id, { jobName: 'Bishop', level: 260 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ jobName: 'Bishop', archetype: 'magician', level: 260 });
  });

  it('rejects an unknown new class', async () => {
    const id = (await create(body())).json().id;
    expectError(await patch(id, { jobName: 'Nope' }), 400, 'UNKNOWN_CLASS');
  });

  it('refuses class or level changes on a nexon character', async () => {
    const c = await makeCharacter({ ownerId, worldId, guildId });
    const res = await patch(c.id, { jobName: 'Bishop', level: 250 });
    expectError(res, 400, 'NOT_MANUAL');
    expect(res.json().error.message).toBe('Only manually added characters can change class or level');
  });

  it('keeps an unchanged class that the admin has since removed', async () => {
    const id = (await create(body())).json().id;
    await prisma.jobClass.delete({ where: { nameLower: 'hero' } });
    const res = await patch(id, { jobName: 'Hero', combatPower: 5 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ jobName: 'Hero', archetype: 'warrior', combatPower: 5 });
  });
});

describe('guildless characters', () => {
  it('appear publicly with guild null and drop out of guild-filtered lists', async () => {
    const c = await makeCharacter({ ownerId, worldId, guildId, ign: 'Loner' });
    await prisma.character.update({ where: { id: c.id }, data: { guildId: null } });
    const list = await app.inject({ method: 'GET', url: '/api/characters' });
    expect(list.json()).toHaveLength(1);
    expect(list.json()[0]).toMatchObject({ ign: 'Loner', guild: null });
    const filtered = await app.inject({ method: 'GET', url: `/api/characters?guildId=${guildId}` });
    expect(filtered.json()).toEqual([]);
  });
});
