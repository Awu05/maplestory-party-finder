import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, loginAs, makeGuild, makeWorld, prisma, resetDb, type FakeNexon } from './helpers.js';

let app: FastifyInstance;
let nexon: FakeNexon;
let cookie: string;
let guildId: string;

beforeEach(async () => {
  await resetDb();
  ({ app, nexon } = await buildTestApp());
  const world = await makeWorld({ nexonWorldId: 45, name: 'Kronos' });
  guildId = (await makeGuild({ worldIds: [world.id] })).id;
  nexon.set([{ ign: 'Lily', nexonWorldId: 45, level: 279, jobName: 'Angelic Buster', imageUrl: 'https://msavatar1.nexon.net/x.png' }]);
  cookie = await loginAs(app, 'u-1');
});
afterAll(async () => {
  await prisma.$disconnect();
});

const body = (over: Record<string, unknown> = {}) => ({
  ign: 'Lily',
  nexonWorldId: 45,
  combatPower: 5_000_000,
  guildId,
  ...over,
});
const create = (over: Record<string, unknown> = {}, c: string | null = cookie) =>
  app.inject({ method: 'POST', url: '/api/characters', headers: c ? { cookie: c } : {}, payload: body(over) });

describe('characters lookup', () => {
  it('returns preview with worldName', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/characters/lookup', headers: { cookie }, payload: { ign: 'lily' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { ign: 'Lily', level: 279, jobName: 'Angelic Buster', imageUrl: 'https://msavatar1.nexon.net/x.png', nexonWorldId: 45, worldName: 'Kronos' },
    ]);
  });

  it('502 when Nexon is down', async () => {
    nexon.failNext();
    const res = await app.inject({ method: 'POST', url: '/api/characters/lookup', headers: { cookie }, payload: { ign: 'Lily' } });
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('NEXON_UNAVAILABLE');
  });
});

describe('characters create', () => {
  it('happy path', async () => {
    const res = await create();
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      ign: 'Lily',
      level: 279,
      jobName: 'Angelic Buster',
      world: { name: 'Kronos' },
      guild: { id: guildId },
      isOwner: true,
      owner: { discordUsername: 'tester' },
    });
  });

  it('body of only ign, world, CP and guild -> DTO without note, playTimes or bosses', async () => {
    const res = await create();
    expect(res.statusCode).toBe(201);
    for (const key of ['note', 'playTimes', 'bosses']) expect(res.json()).not.toHaveProperty(key);
  });

  it('old clients sending the removed fields still succeed (unknown keys stripped)', async () => {
    const res = await create({ bosses: [], playTimes: [1], note: 'hi' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).not.toHaveProperty('note');
  });

  it('guild is optional: omitted or null creates a character with no guild', async () => {
    for (const guildId of [undefined, null]) {
      await prisma.character.deleteMany();
      const res = await create({ guildId });
      expect(res.statusCode).toBe(201);
      expect(res.json().guild).toBeNull();
    }
  });

  it('large combat power is exact', async () => {
    const res = await create({ combatPower: 1_500_000_000 });
    expect(res.statusCode).toBe(201);
    expect(res.json().combatPower).toBe(1500000000);
  });

  it('stores Nexon casing and rejects a case-variant duplicate', async () => {
    const res = await create({ ign: 'lily' });
    expect(res.statusCode).toBe(201);
    expect(res.json().ign).toBe('Lily');
    const other = await loginAs(app, 'u-2', 'other');
    const dup = await create({ ign: 'LILY' }, other);
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('ALREADY_CLAIMED');
  });

  it('Nexon failure returns 502 and writes nothing', async () => {
    nexon.failNext();
    const res = await create();
    expect(res.statusCode).toBe(502);
    expect(res.json().error.code).toBe('NEXON_UNAVAILABLE');
    expect(await prisma.character.count()).toBe(0);
  });

  it('404 when Nexon has no match on that world', async () => {
    const res = await create({ nexonWorldId: 46 });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('CHARACTER_NOT_FOUND');
  });

  it('unknown world', async () => {
    nexon.set([{ ign: 'Lily', nexonWorldId: 999, level: 1, jobName: 'x', imageUrl: 'u' }]);
    const res = await create({ nexonWorldId: 999 });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('UNKNOWN_WORLD');
    expect(res.json().error.message).toBe("World 999 isn't set up yet — ask the admin");
  });

  it('inactive world', async () => {
    await prisma.world.updateMany({ data: { active: false } });
    const res = await create();
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('WORLD_INACTIVE');
  });

  it('inactive guild', async () => {
    await prisma.guild.update({ where: { id: guildId }, data: { active: false } });
    const res = await create();
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('GUILD_INACTIVE');
  });

  it('visitor gets 401', async () => {
    expect((await create({}, null)).statusCode).toBe(401);
  });

  it('validation errors', async () => {
    for (const over of [
      { combatPower: 0 },
      { ign: '' },
    ]) {
      const res = await create(over);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION');
    }
    expect(await prisma.character.count()).toBe(0);
  });
});
