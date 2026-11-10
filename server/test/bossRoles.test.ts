import { beforeEach, afterEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { EventDispatcher } from '../src/notifications/dispatcher.js';
import { buildTestApp, loginAs, makeBossDifficulty, makeCharacter, makeGuild, makePost, makeWorld, prisma, resetDb } from './helpers.js';

let app: FastifyInstance;
let events: EventDispatcher;
let cookie: string;
beforeEach(async () => {
  await resetDb();
  const setup = await buildTestApp({ events: 'dispatcher' });
  app = setup.app;
  events = setup.events as EventDispatcher;
  cookie = await loginAs(app, 'admin-1');
});
afterEach(async () => { await app.close(); });

const update = (id: string, bossRoleIds: unknown, auth = cookie) => app.inject({
  method: 'PATCH', url: `/api/admin/guilds/${id}`, headers: { cookie: auth }, payload: { bossRoleIds },
});

it('stores validated admin-only boss role mappings and can clear them', async () => {
  const guild = await makeGuild();
  const boss = await makeBossDifficulty();
  const mappings = { [boss.bossId]: '111111111111111111' };
  expect((await update(guild.id, mappings)).json().bossRoleIds).toEqual(mappings);
  const admin = await app.inject({ url: '/api/admin/guilds', headers: { cookie } });
  expect(admin.json()[0].bossRoleIds).toEqual(mappings);
  const publicList = await app.inject({ url: '/api/guilds' });
  expect(publicList.json()[0]).not.toHaveProperty('bossRoleIds');
  for (const invalid of [{ [boss.bossId]: '@everyone' }, { 999999: '111111111111111111' }, { bad: '111111111111111111' }]) {
    expect((await update(guild.id, invalid)).statusCode).toBe(400);
  }
  expect((await update(guild.id, {}, '')).statusCode).toBe(401);
  const member = await loginAs(app, 'member');
  expect((await update(guild.id, {}, member)).statusCode).toBe(403);
  expect((await update(guild.id, {})).json().bossRoleIds).toEqual({});
});

it('broadcasts only the posted bosses with each receiving guild’s own role IDs, deduplicated', async () => {
  const world = await makeWorld();
  const hook = 'https://discord.com/api/webhooks/1/test';
  const first = await makeGuild({ worldIds: [world.id], webhookUrl: hook });
  const second = await makeGuild({ worldIds: [world.id], webhookUrl: hook });
  const unmapped = await makeGuild({ worldIds: [world.id], webhookUrl: hook });
  const boss = await makeBossDifficulty({ bossName: 'Lucid', difficulty: 'Hard' });
  const normal = await prisma.bossDifficulty.create({ data: { bossId: boss.bossId, difficulty: 'Normal' } });
  const other = await makeBossDifficulty({ bossName: 'Will' });
  const unrelated = await makeBossDifficulty({ bossName: 'Lotus' });
  await update(first.id, { [boss.bossId]: '111111111111111111', [other.bossId]: '222222222222222222', [unrelated.bossId]: '333333333333333333' });
  await update(second.id, { [boss.bossId]: '444444444444444444', [other.bossId]: '444444444444444444' });
  const character = await makeCharacter({ worldId: world.id, guildId: first.id });
  for (const type of ['recruiting', 'lfp'] as const) {
    const post = await makePost({ type, posterCharacterId: character.id, bossDifficultyIds: [boss.id, normal.id, other.id] });
    events.emit({ type: 'post.created', postId: post.id });
    await events.drain();
    const deliveries = await prisma.webhookDelivery.findMany({ where: { postId: post.id } });
    expect(deliveries).toHaveLength(3);
    expect(deliveries.find((d) => d.guildId === first.id)!.payload).toMatchObject({
      content: '<@&111111111111111111> <@&222222222222222222>',
      allowed_mentions: { parse: [], roles: ['111111111111111111', '222222222222222222'] },
    });
    expect(deliveries.find((d) => d.guildId === second.id)!.payload).toMatchObject({
      content: '<@&444444444444444444>', allowed_mentions: { parse: [], roles: ['444444444444444444'] },
    });
    expect(deliveries.find((d) => d.guildId === unmapped.id)!.payload).not.toHaveProperty('content');
  }
});

it('deleting a boss removes its role mapping from every guild', async () => {
  const kept = await makeBossDifficulty();
  const removed = await makeBossDifficulty();
  const roles = { [kept.bossId]: '111111111111111111', [removed.bossId]: '222222222222222222' };
  const a = await makeGuild({ bossRoleIds: roles });
  const b = await makeGuild({ bossRoleIds: { [removed.bossId]: '333333333333333333' } });
  const del = await app.inject({ method: 'DELETE', url: `/api/admin/bosses/${removed.bossId}`, headers: { cookie } });
  expect(del.statusCode).toBe(204);
  expect((await prisma.guild.findUniqueOrThrow({ where: { id: a.id } })).bossRoleIds).toEqual({ [kept.bossId]: '111111111111111111' });
  expect((await prisma.guild.findUniqueOrThrow({ where: { id: b.id } })).bossRoleIds).toEqual({});
  // The stored mappings can be sent back unchanged.
  expect((await update(a.id, { [kept.bossId]: '111111111111111111' })).statusCode).toBe(200);
});
