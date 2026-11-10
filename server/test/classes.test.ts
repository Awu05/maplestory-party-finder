import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { seed } from '../prisma/seed.js';
import { buildTestApp, loginAs, makeCharacter, makeGuild, makeJobClass, makeWorld, prisma, resetDb, type FakeNexon } from './helpers.js';

let app: FastifyInstance;
let nexon: FakeNexon;
let admin: string;

beforeEach(async () => {
  await resetDb();
  ({ app, nexon } = await buildTestApp());
  admin = await loginAs(app, 'admin-1', 'boss');
});
afterAll(async () => {
  await prisma.$disconnect();
});

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
  app.inject({ method, url, headers: { cookie: admin }, ...(payload ? { payload } : {}) });

describe('classes', () => {
  it('GET /api/classes is sorted alphabetically, case-insensitive', async () => {
    await makeJobClass('zero', 'warrior');
    await makeJobClass('Adele', 'warrior');
    await makeJobClass('Bishop', 'magician');
    await makeJobClass('Évoker', 'magician');
    const res = await app.inject({ method: 'GET', url: '/api/classes' });
    expect(res.statusCode).toBe(200);
    expect(res.json().map((c: { name: string }) => c.name)).toEqual(['Adele', 'Bishop', 'Évoker', 'zero']);
  });

  it('admin POST creates a class; a duplicate in another case is 409', async () => {
    const res = await call('POST', '/api/admin/classes', { name: ' Adele ', archetype: 'warrior' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ name: 'Adele', archetype: 'warrior' });
    const dup = await call('POST', '/api/admin/classes', { name: 'adele', archetype: 'thief' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('DUPLICATE');
    expect(dup.json().error.message).toBe('That class already exists');
  });

  it('admin POST retags existing characters (case-insensitive)', async () => {
    const c = await makeCharacter({ jobName: 'newclass' });
    expect(c.archetype).toBe('unknown');
    await call('POST', '/api/admin/classes', { name: 'NewClass', archetype: 'thief' });
    const res = await call('GET', `/api/characters/${c.id}`);
    expect(res.json().archetype).toBe('thief');
  });

  it('admin PATCH changes the archetype and characters follow', async () => {
    const jc = await makeJobClass('Hero', 'warrior');
    const c = await makeCharacter({ jobName: 'hero' });
    const res = await call('PATCH', `/api/admin/classes/${jc.id}`, { archetype: 'pirate' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: jc.id, archetype: 'pirate' });
    expect((await call('GET', `/api/characters/${c.id}`)).json().archetype).toBe('pirate');
    expect((await call('PATCH', '/api/admin/classes/9999', { archetype: 'pirate' })).statusCode).toBe(404);
  });

  it('admin DELETE removes the class; characters keep their archetype', async () => {
    const jc = await makeJobClass('Hero', 'warrior');
    const c = await makeCharacter({ jobName: 'Hero' });
    expect((await call('DELETE', `/api/admin/classes/${jc.id}`)).statusCode).toBe(204);
    expect(await prisma.jobClass.count()).toBe(0);
    expect((await call('GET', `/api/characters/${c.id}`)).json().archetype).toBe('warrior');
    expect((await call('DELETE', `/api/admin/classes/${jc.id}`)).statusCode).toBe(404);
  });

  it('createCharacter stores the archetype from JobClass, winning over the shared list', async () => {
    await makeJobClass('Hero', 'magician');
    const world = await makeWorld({ nexonWorldId: 45 });
    const guild = await makeGuild({ worldIds: [world.id] });
    nexon.set([{ ign: 'Lily', nexonWorldId: 45, level: 279, jobName: 'Hero', imageUrl: 'https://x/y.png' }]);
    const res = await call('POST', '/api/characters', { ign: 'Lily', nexonWorldId: 45, combatPower: 5_000_000, guildId: guild.id });
    expect(res.statusCode).toBe(201);
    expect(res.json().archetype).toBe('magician');
    expect((await prisma.character.findFirstOrThrow()).archetype).toBe('magician');
  });

  it('createCharacter falls back to the shared list, then unknown', async () => {
    const world = await makeWorld({ nexonWorldId: 45 });
    const guild = await makeGuild({ worldIds: [world.id] });
    nexon.set([
      { ign: 'Lily', nexonWorldId: 45, level: 279, jobName: 'Bishop', imageUrl: 'https://x/y.png' },
      { ign: 'Odd', nexonWorldId: 45, level: 279, jobName: 'Mystery', imageUrl: 'https://x/y.png' },
    ]);
    const a = await call('POST', '/api/characters', { ign: 'Lily', nexonWorldId: 45, combatPower: 1, guildId: guild.id });
    const b = await call('POST', '/api/characters', { ign: 'Odd', nexonWorldId: 45, combatPower: 1, guildId: guild.id });
    expect(a.json().archetype).toBe('magician');
    expect(b.json().archetype).toBe('unknown');
  });

  it('?archetype= filters on the stored column', async () => {
    await makeCharacter({ ign: 'Stored', jobName: 'Hero', archetype: 'thief' });
    await makeCharacter({ ign: 'Other', jobName: 'Hero' });
    const res = await call('GET', '/api/characters?archetype=thief');
    expect(res.json().map((c: { ign: string }) => c.ign)).toEqual(['Stored']);
  });

  it('seed creates every known class once, keeps admin changes, and backfills unknown characters', async () => {
    const c = await makeCharacter({ jobName: 'Hero', archetype: 'unknown' });
    await seed(prisma);
    const total = await prisma.jobClass.count();
    await prisma.jobClass.update({ where: { nameLower: 'bishop' }, data: { archetype: 'pirate' } });
    await seed(prisma);
    expect(await prisma.jobClass.count()).toBe(total);
    expect((await prisma.jobClass.findUniqueOrThrow({ where: { nameLower: 'bishop' } })).archetype).toBe('pirate');
    expect((await prisma.character.findUniqueOrThrow({ where: { id: c.id } })).archetype).toBe('warrior');
  });
});
