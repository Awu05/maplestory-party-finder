import fs from 'node:fs';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Storage } from '../src/storage/storage.js';
import type { FastifyInstance } from 'fastify';
import {
  buildTestApp, loginAs, makeBossDifficulty, makeCharacter, makeGuild, makeWorld, prisma, resetDb, type FakeNexon,
} from './helpers.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

let app: FastifyInstance;
let nexon: FakeNexon;
let uploadDir: string;
let storage: Storage;
let cookie: string;
let ownerId: string;
let worldId: number;
let guildId: string;

beforeEach(async () => {
  await resetDb();
  ({ app, nexon, uploadDir, storage } = await buildTestApp());
  worldId = (await makeWorld({ nexonWorldId: 45, name: 'Kronos' })).id;
  guildId = (await makeGuild({ worldIds: [worldId] })).id;
  cookie = await loginAs(app, 'u-1', 'owner');
  ownerId = (await prisma.user.findUniqueOrThrow({ where: { discordId: 'u-1' } })).id;
});
afterAll(async () => {
  await prisma.$disconnect();
});

const get = (url: string, c?: string) => app.inject({ method: 'GET', url, headers: c ? { cookie: c } : {} });
const patch = (id: string, payload: unknown, c: string | null = cookie) =>
  app.inject({ method: 'PATCH', url: `/api/characters/${id}`, headers: c ? { cookie: c } : {}, payload: payload as any });

function multipart(content: Buffer) {
  const b = '----pfboundary';
  const body = Buffer.concat([
    Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="file"; filename="x.png"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${b}--\r\n`),
  ]);
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${b}` } };
}
const upload = (id: string, c = cookie) => {
  const { body, headers } = multipart(PNG);
  return app.inject({ method: 'PUT', url: `/api/characters/${id}/screenshot`, payload: body, headers: { ...headers, cookie: c } });
};
const igns = (res: { json(): any }) => res.json().map((c: any) => c.ign);

describe('characters list', () => {
  it('sorted by CP desc and filters by guildId, worldId, archetype=pirate, q=li', async () => {
    const w2 = await makeWorld({ nexonWorldId: 46, name: 'Bera' });
    const g2 = await makeGuild({ worldIds: [w2.id] });
    await makeCharacter({ ign: 'Lily', jobName: 'Angelic Buster', combatPower: 5n, worldId, guildId });
    await makeCharacter({ ign: 'Lia', jobName: 'Shade', combatPower: 9n, worldId, guildId });
    await makeCharacter({ ign: 'Liam', jobName: 'Hero', combatPower: 7n, worldId, guildId });
    await makeCharacter({ ign: 'Bob', jobName: 'Jett', combatPower: 8n, worldId, guildId });
    await makeCharacter({ ign: 'Lisa', jobName: 'Jett', combatPower: 3n, worldId: w2.id, guildId: g2.id });

    expect(igns(await get('/api/characters'))).toEqual(['Lia', 'Bob', 'Liam', 'Lily', 'Lisa']);
    expect(igns(await get(`/api/characters?guildId=${g2.id}`))).toEqual(['Lisa']);
    expect(igns(await get(`/api/characters?worldId=${worldId}`))).toHaveLength(4);
    expect(igns(await get('/api/characters?archetype=pirate'))).toEqual(['Lia', 'Bob', 'Lily', 'Lisa']);
    expect(igns(await get('/api/characters?q=li'))).toEqual(['Lia', 'Liam', 'Lily', 'Lisa']);
    expect(igns(await get(`/api/characters?archetype=pirate&q=LI&worldId=${worldId}`))).toEqual(['Lia', 'Lily']);
  });

  it('hides characters of inactive guilds, except with mine=1', async () => {
    const dead = await makeGuild({ worldIds: [worldId], active: false });
    await makeCharacter({ ign: 'Ghost', guildId: dead.id, worldId, ownerId });
    await makeCharacter({ ign: 'Live', guildId, worldId });
    expect(igns(await get('/api/characters'))).toEqual(['Live']);
    expect(igns(await get('/api/characters?mine=1', cookie))).toEqual(['Ghost']);
    expect((await get('/api/characters?mine=1')).statusCode).toBe(401);
  });
});

describe('characters get', () => {
  it('as visitor -> isOwner:false and includes owner.discordUsername', async () => {
    const c = await makeCharacter({ ownerId, worldId, guildId });
    const res = await get(`/api/characters/${c.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: c.id, isOwner: false, owner: { discordUsername: 'owner' } });
    expect((await get(`/api/characters/${c.id}`, cookie)).json().isOwner).toBe(true);
    expect((await get('/api/characters/nope')).statusCode).toBe(404);
  });
});

describe('characters patch', () => {
  it('non-owner -> 403 NOT_OWNER', async () => {
    const c = await makeCharacter({ ownerId, worldId, guildId });
    const other = await loginAs(app, 'u-2', 'other');
    const res = await patch(c.id, { note: 'x' }, other);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_OWNER');
    expect((await patch(c.id, { note: 'x' }, null)).statusCode).toBe(401);
    expect((await patch('nope', { note: 'x' })).statusCode).toBe(404);
  });

  it('combatPower bumps cpUpdatedAt; note only does not', async () => {
    const old = new Date('2020-01-01T00:00:00Z');
    const c = await makeCharacter({ ownerId, worldId, guildId, cpUpdatedAt: old });
    const r1 = await patch(c.id, { note: 'hello' });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().note).toBe('hello');
    expect(r1.json().cpUpdatedAt).toBe(old.toISOString());
    const r2 = await patch(c.id, { combatPower: 2_000_000 });
    expect(r2.json().combatPower).toBe(2_000_000);
    expect(new Date(r2.json().cpUpdatedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('unchanged combatPower (sent alongside other edits) does not bump cpUpdatedAt', async () => {
    const old = new Date('2020-01-01T00:00:00Z');
    const c = await makeCharacter({ ownerId, worldId, guildId, cpUpdatedAt: old, combatPower: 1_500_000n });
    const r1 = await patch(c.id, { combatPower: 1_500_000, note: 'same cp' });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().note).toBe('same cp');
    expect(r1.json().cpUpdatedAt).toBe(old.toISOString());
    const r2 = await patch(c.id, { combatPower: 1_500_001, note: 'new cp' });
    expect(r2.json().combatPower).toBe(1_500_001);
    expect(new Date(r2.json().cpUpdatedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('bosses replaces set; validates guild, bosses, playTimes', async () => {
    const a = await makeBossDifficulty({ bossName: 'A' });
    const b = await makeBossDifficulty({ bossName: 'B' });
    const c = await makeCharacter({ ownerId, worldId, guildId });
    await prisma.characterBoss.create({ data: { characterId: c.id, bossDifficultyId: a.id, experience: 'learning' } });
    const res = await patch(c.id, { bosses: [{ bossDifficultyId: b.id, experience: 'cleared' }], playTimes: [5, 3] });
    expect(res.statusCode).toBe(200);
    expect(res.json().bosses).toEqual([{ bossDifficultyId: b.id, bossName: 'B', difficulty: 'Normal', experience: 'cleared' }]);
    expect(res.json().playTimes).toEqual([3, 5]);
    expect((await patch(c.id, { bosses: [{ bossDifficultyId: 99999, experience: 'cleared' }] })).statusCode).toBe(400);
    const dup = [{ bossDifficultyId: b.id, experience: 'cleared' }, { bossDifficultyId: b.id, experience: 'learning' }];
    expect((await patch(c.id, { bosses: dup })).statusCode).toBe(400);
    expect((await patch(c.id, { playTimes: [1, 1] })).statusCode).toBe(400);
    const dead = await makeGuild({ worldIds: [worldId], active: false });
    const g = await patch(c.id, { guildId: dead.id });
    expect(g.statusCode).toBe(400);
    expect(g.json().error.code).toBe('GUILD_INACTIVE');
    const other = await makeGuild({ worldIds: [worldId] });
    expect((await patch(c.id, { guildId: other.id })).json().guild.id).toBe(other.id);
  });
});

describe('characters screenshot', () => {
  it('upload sets screenshotUrl /uploads/<key>; second upload removes first file', async () => {
    const c = await makeCharacter({ ownerId, worldId, guildId });
    const r1 = await upload(c.id);
    expect(r1.statusCode).toBe(200);
    const url1 = r1.json().screenshotUrl as string;
    expect(url1).toMatch(/^\/uploads\/[a-f0-9]{24}\.png$/);
    expect(fs.readdirSync(uploadDir)).toEqual([url1.replace('/uploads/', '')]);
    const r2 = await upload(c.id);
    const url2 = r2.json().screenshotUrl as string;
    expect(url2).not.toBe(url1);
    expect(fs.readdirSync(uploadDir)).toEqual([url2.replace('/uploads/', '')]);
  });

  it('non-owner -> 403 and nothing saved', async () => {
    const c = await makeCharacter({ ownerId, worldId, guildId });
    const other = await loginAs(app, 'u-2', 'other');
    expect((await upload(c.id, other)).statusCode).toBe(403);
    expect(fs.readdirSync(uploadDir)).toEqual([]);
  });
});

describe('characters refresh', () => {
  const refresh = (id: string) => app.inject({ method: 'POST', url: `/api/characters/${id}/refresh`, headers: { cookie } });
  beforeEach(() => {
    nexon.set([{ ign: 'Lily', nexonWorldId: 45, level: 280, jobName: 'Angelic Buster', imageUrl: 'https://x/new.png' }]);
  });

  it('updates level from FakeNexon (279 -> 280); second within 10 min -> 429 TOO_SOON', async () => {
    const c = await makeCharacter({ ign: 'Lily', ownerId, worldId, guildId, level: 279 });
    const r1 = await refresh(c.id);
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ level: 280, syncStatus: 'ok', imageUrl: 'https://x/new.png', jobName: 'Angelic Buster' });
    const r2 = await refresh(c.id);
    expect(r2.statusCode).toBe(429);
    expect(r2.json().error.code).toBe('TOO_SOON');
  });

  it('Nexon failure -> 200 stale with old level; next success returns to ok', async () => {
    const c = await makeCharacter({ ign: 'Lily', ownerId, worldId, guildId, level: 279 });
    nexon.failNext();
    const r1 = await refresh(c.id);
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ level: 279, syncStatus: 'stale' });
    await prisma.character.update({ where: { id: c.id }, data: { lastRefreshRequestedAt: new Date(Date.now() - 11 * 60_000) } });
    const r2 = await refresh(c.id);
    expect(r2.statusCode).toBe(200);
    expect(r2.json()).toMatchObject({ level: 280, syncStatus: 'ok' });
  });

  it('no match on Nexon -> stale, data unchanged; non-owner 403', async () => {
    const c = await makeCharacter({ ign: 'Ghosty', ownerId, worldId, guildId, level: 279 });
    const r = await refresh(c.id);
    expect(r.json()).toMatchObject({ level: 279, syncStatus: 'stale' });
    const other = await loginAs(app, 'u-2', 'other');
    const r2 = await app.inject({ method: 'POST', url: `/api/characters/${c.id}/refresh`, headers: { cookie: other } });
    expect(r2.statusCode).toBe(403);
  });
});

describe('characters delete', () => {
  it('removes row and screenshot file; non-owner 403', async () => {
    const c = await makeCharacter({ ownerId, worldId, guildId });
    await upload(c.id);
    expect(fs.readdirSync(uploadDir)).toHaveLength(1);
    const other = await loginAs(app, 'u-2', 'other');
    expect((await app.inject({ method: 'DELETE', url: `/api/characters/${c.id}`, headers: { cookie: other } })).statusCode).toBe(403);
    const res = await app.inject({ method: 'DELETE', url: `/api/characters/${c.id}`, headers: { cookie } });
    expect(res.statusCode).toBe(204);
    expect(await prisma.character.count()).toBe(0);
    expect(fs.readdirSync(uploadDir)).toEqual([]);
  });

  it('file removal failure still deletes the row (204)', async () => {
    const c = await makeCharacter({ ownerId, worldId, guildId });
    await upload(c.id);
    vi.spyOn(storage, 'remove').mockRejectedValueOnce(new Error('disk gone'));
    const res = await app.inject({ method: 'DELETE', url: `/api/characters/${c.id}`, headers: { cookie } });
    expect(res.statusCode).toBe(204);
    expect(await prisma.character.count()).toBe(0);
  });
});
