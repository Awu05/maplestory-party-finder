import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { DAY_MS } from '@pf/shared';
import { buildTestApp, FakeWebhookSender, loginAs, makeBossDifficulty, makeCharacter, makeGuild, makePost, makeWorld, prisma, resetDb } from './helpers.js';
import { WebhookWorker } from '../src/discord/outbox.js';

let app: FastifyInstance;
let ownerCookie: string;
let ownerId: string;
let worldId: number;
let guildId: string;
let bossId: number;
let difficultyId: number;

beforeEach(async () => {
  await resetDb();
  ({ app } = await buildTestApp());
  ownerCookie = await loginAs(app, 'post-owner');
  ownerId = (await prisma.user.findUniqueOrThrow({ where: { discordId: 'post-owner' } })).id;
  worldId = (await makeWorld()).id;
  guildId = (await makeGuild({ worldIds: [worldId], webhookUrl: 'https://discord.com/api/webhooks/1/token' })).id;
  const difficulty = await makeBossDifficulty({ bossName: 'Lucid', difficulty: 'Hard' });
  bossId = difficulty.bossId;
  difficultyId = difficulty.id;
});
afterEach(async () => { await app.close(); });

const post = async (createdAt: Date, overrides: Parameters<typeof makePost>[0] = {}) => {
  const character = await makeCharacter({ ownerId, worldId, guildId });
  return makePost({ posterCharacterId: character.id, scheduledAt: null, bossDifficultyIds: [difficultyId], createdAt, ...overrides });
};
const announce = (id: string, cookie = ownerCookie) => app.inject({ method: 'POST', url: `/api/posts/${id}/discord-announcement`, headers: { cookie } });

it('waits 24 hours after creation and enforces the cooldown across concurrent requests', async () => {
  const p = await post(new Date(Date.now() - DAY_MS + 60_000));
  expect((await announce(p.id)).statusCode).toBe(429);
  expect(await prisma.webhookDelivery.count()).toBe(0);
  await prisma.post.update({ where: { id: p.id }, data: { createdAt: new Date(Date.now() - DAY_MS - 1000) } });
  await prisma.guild.update({ where: { id: guildId }, data: { bossRoleIds: { [String(bossId)]: '123456789012345678' } } });
  const [first, second] = await Promise.all([announce(p.id), announce(p.id)]);
  expect([first.statusCode, second.statusCode].sort()).toEqual([200, 429]);
  const deliveries = await prisma.webhookDelivery.findMany();
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]).toMatchObject({ guildId, postId: p.id, eventType: 'post.announcement', payload: { allowed_mentions: { roles: ['123456789012345678'] } } });
  const successful = first.statusCode === 200 ? first : second;
  expect(Date.parse(successful.json().discordAnnouncementAvailableAt)).toBeGreaterThan(Date.now() + DAY_MS - 10_000);
  expect((await announce(p.id)).statusCode).toBe(429);
  await prisma.post.update({ where: { id: p.id }, data: { lastDiscordAnnouncementAt: new Date(Date.now() - DAY_MS - 1000) } });
  expect((await announce(p.id)).statusCode).toBe(200);
  expect(await prisma.webhookDelivery.count()).toBe(2);
});

it('requires the owner and an open post, and does not consume the cooldown without a destination', async () => {
  const p = await post(new Date(Date.now() - DAY_MS - 1000));
  const other = await loginAs(app, 'other-user');
  expect((await announce(p.id, other)).statusCode).toBe(403);
  await prisma.guild.update({ where: { id: guildId }, data: { webhookUrl: null } });
  expect((await announce(p.id)).json().error.code).toBe('NO_ANNOUNCEMENT_WEBHOOK');
  expect((await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).lastDiscordAnnouncementAt).toBeNull();
  await prisma.post.update({ where: { id: p.id }, data: { status: 'closed', closedReason: 'manual' } });
  expect((await announce(p.id)).statusCode).toBe(409);
  expect(await prisma.webhookDelivery.count()).toBe(0);
});

it('does not send a queued announcement if recruitment closes before delivery', async () => {
  const p = await post(new Date(Date.now() - DAY_MS - 1000));
  expect((await announce(p.id)).statusCode).toBe(200);
  await prisma.post.update({ where: { id: p.id }, data: { status: 'full', closedReason: 'full' } });
  const sender = new FakeWebhookSender();
  expect((await new WebhookWorker({ prisma, sender }).runOnce()).failed).toBe(1);
  expect(sender.calls).toHaveLength(0);
});

it('announces a reopened post with boss-role pings and resets its manual notification cooldown', async () => {
  const p = await post(new Date(Date.now() - DAY_MS - 1000), { status: 'closed', closedReason: 'manual' });
  await prisma.guild.update({ where: { id: guildId }, data: { bossRoleIds: { [String(bossId)]: '123456789012345678' } } });
  const response = await app.inject({ method: 'POST', url: `/api/posts/${p.id}/reopen`, headers: { cookie: ownerCookie } });
  expect(response.statusCode).toBe(200);
  const deliveries = await prisma.webhookDelivery.findMany();
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]).toMatchObject({ postId: p.id, guildId, eventType: 'post.reopened', payload: { content: '<@&123456789012345678> Party reopened.', allowed_mentions: { roles: ['123456789012345678'] } } });
  expect((await announce(p.id)).statusCode).toBe(429);
  const sender = new FakeWebhookSender();
  expect((await new WebhookWorker({ prisma, sender }).runOnce()).sent).toBe(1);
  expect(sender.calls[0]!.payload.content).toContain('Party reopened.');
  expect((await app.inject({ method: 'POST', url: `/api/posts/${p.id}/reopen`, headers: { cookie: ownerCookie } })).statusCode).toBe(409);
  expect(await prisma.webhookDelivery.count()).toBe(1);
});

it('still reopens successfully when no Discord channel is configured', async () => {
  const p = await post(new Date(Date.now() - DAY_MS - 1000), { status: 'closed', closedReason: 'manual' });
  await prisma.guild.update({ where: { id: guildId }, data: { webhookUrl: null } });
  const response = await app.inject({ method: 'POST', url: `/api/posts/${p.id}/reopen`, headers: { cookie: ownerCookie } });
  expect(response.statusCode).toBe(200);
  expect(response.json().status).toBe('open');
  expect(await prisma.webhookDelivery.count()).toBe(0);
});
