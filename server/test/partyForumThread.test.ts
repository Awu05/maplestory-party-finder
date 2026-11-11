import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { WebhookWorker } from '../src/discord/outbox.js';
import { addMember, buildTestApp, FakeWebhookSender, loginAs, makeBossDifficulty, makeCharacter, makeGuild, makePost, makeUser, makeWorld, prisma, resetDb } from './helpers.js';

let app: FastifyInstance;
let cookie: string;
let postId: string;
const FORUM_URL = 'https://discord.com/api/webhooks/123/forumsecret';
const OWNER_DISCORD_ID = '123456789012345678';
const MEMBER_DISCORD_ID = '234567890123456789';

beforeEach(async () => {
  await resetDb();
  ({ app } = await buildTestApp());
  cookie = await loginAs(app, OWNER_DISCORD_ID);
  const owner = await prisma.user.findUniqueOrThrow({ where: { discordId: OWNER_DISCORD_ID } });
  const world = await makeWorld();
  const guild = await makeGuild({ worldIds: [world.id], partyForumWebhookUrl: FORUM_URL });
  const character = await makeCharacter({ ownerId: owner.id, worldId: world.id, guildId: guild.id });
  const boss = await makeBossDifficulty({ bossName: 'Lucid', difficulty: 'Hard' });
  postId = (await makePost({ posterCharacterId: character.id, scheduledAt: null, bossDifficultyIds: [boss.id] })).id;
});
afterEach(async () => { await app.close(); });

const finalize = (at: Date) => app.inject({ method: 'PUT', url: `/api/posts/${postId}/final-time`, headers: { cookie }, payload: { scheduledAt: at.toISOString() } });

it('refreshes the time and roster before retrying a rate-limited thread', async () => {
  const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  const user = await makeUser({ discordId: MEMBER_DISCORD_ID });
  const member = await addMember(postId, (await makeCharacter({ ownerId: user.id, guildId: post.guildId })).id);
  const first = new Date(Date.now() + 86_400_000);
  const second = new Date(first.getTime() + 86_400_000);
  expect((await finalize(first)).statusCode).toBe(200);
  let now = new Date();
  const sender = new FakeWebhookSender();
  sender.queue({ ok: false, status: 429, retryAfterMs: 1000, error: 'rate limited' });
  const worker = new WebhookWorker({ prisma, sender, now: () => now });
  expect((await worker.runOnce()).retried).toBe(1);
  expect((await finalize(second)).statusCode).toBe(200);
  await prisma.postMember.delete({ where: { id: member.id } });
  now = new Date(now.getTime() + 60_000);
  expect((await worker.runOnce()).sent).toBe(1);
  const sent = sender.calls[1]!.payload;
  expect(sent.content).toContain(`<t:${Math.floor(second.getTime() / 1000)}:F>`);
  expect(sent.content).not.toContain(`<t:${Math.floor(first.getTime() / 1000)}:F>`);
  expect(sent.content).toContain(OWNER_DISCORD_ID);
  expect(sent.content).not.toContain(MEMBER_DISCORD_ID);
  expect(sent).not.toHaveProperty('_forum');
  expect(await prisma.webhookDelivery.count({ where: { postId, eventType: 'post.party_thread' } })).toBe(1);
});

it('queues and delivers exactly one forum thread for the host guild', async () => {
  const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  const member = await makeUser({ discordId: MEMBER_DISCORD_ID });
  await addMember(postId, (await makeCharacter({ ownerId: member.id, worldId: post.worldId, guildId: post.guildId })).id);
  const first = new Date(Date.now() + 86_400_000);
  const second = new Date(first.getTime() + 86_400_000);
  expect((await finalize(first)).statusCode).toBe(200);
  expect((await finalize(second)).statusCode).toBe(200);
  const deliveries = await prisma.webhookDelivery.findMany({ where: { postId, eventType: 'post.party_thread' } });
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]!.payload).toMatchObject({ thread_name: expect.stringContaining('Hard Lucid'), content: expect.stringContaining(`<t:${Math.floor(second.getTime() / 1000)}:F>`) });
  const sender = new FakeWebhookSender();
  const worker = new WebhookWorker({ prisma, sender });
  expect((await worker.runOnce()).sent).toBe(1);
  expect(sender.calls[0]!.url).toBe(FORUM_URL);
  expect(sender.calls[0]!.payload.thread_name).toContain('Hard Lucid');
  expect(sender.calls[0]!.payload.content).toContain(`<@${OWNER_DISCORD_ID}>`);
  expect(sender.calls[0]!.payload.content).toContain(`<@${MEMBER_DISCORD_ID}>`);
  expect(sender.calls[0]!.payload.allowed_mentions).toEqual({ parse: [] });
  expect((await finalize(second)).statusCode).toBe(200);
  expect(await prisma.webhookDelivery.count({ where: { postId, eventType: 'post.party_thread' } })).toBe(1);
});

it('does not create a thread without a forum webhook or after the party is reopened', async () => {
  const p = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  await prisma.guild.update({ where: { id: p.guildId }, data: { partyForumWebhookUrl: null } });
  expect((await finalize(new Date(Date.now() + 86_400_000))).statusCode).toBe(200);
  expect(await prisma.webhookDelivery.count({ where: { postId, eventType: 'post.party_thread' } })).toBe(0);
  await prisma.guild.update({ where: { id: p.guildId }, data: { partyForumWebhookUrl: FORUM_URL } });
  expect((await finalize(new Date(Date.now() + 86_400_000))).statusCode).toBe(200);
  expect((await app.inject({ method: 'POST', url: `/api/posts/${postId}/reopen`, headers: { cookie } })).statusCode).toBe(200);
  const sender = new FakeWebhookSender();
  const result = await new WebhookWorker({ prisma, sender }).runOnce();
  expect(result.failed).toBe(1);
  expect(sender.calls).toHaveLength(0);
  expect((await prisma.post.findUniqueOrThrow({ where: { id: postId } })).forumThreadRequested).toBe(false);
  expect((await finalize(new Date(Date.now() + 86_400_000))).statusCode).toBe(200);
  expect((await new WebhookWorker({ prisma, sender }).runOnce()).sent).toBe(1);
});

it('queues a new thread on the next finalize after a delivery failed (webhook removed, then fixed)', async () => {
  const p = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  expect((await finalize(new Date(Date.now() + 86_400_000))).statusCode).toBe(200);
  await prisma.guild.update({ where: { id: p.guildId }, data: { partyForumWebhookUrl: null } });
  const sender = new FakeWebhookSender();
  expect((await new WebhookWorker({ prisma, sender }).runOnce()).failed).toBe(1);
  expect((await prisma.post.findUniqueOrThrow({ where: { id: postId } })).forumThreadRequested).toBe(false);
  await prisma.guild.update({ where: { id: p.guildId }, data: { partyForumWebhookUrl: FORUM_URL } });
  expect((await finalize(new Date(Date.now() + 2 * 86_400_000))).statusCode).toBe(200);
  expect(await prisma.webhookDelivery.count({ where: { postId, eventType: 'post.party_thread', status: 'pending' } })).toBe(1);
  expect((await new WebhookWorker({ prisma, sender }).runOnce()).sent).toBe(1);
  expect(sender.calls[0]!.url).toBe(FORUM_URL);
});

it('queues a new thread on the next finalize after a delivery was rejected by Discord', async () => {
  expect((await finalize(new Date(Date.now() + 86_400_000))).statusCode).toBe(200);
  const failing = new FakeWebhookSender();
  failing.queue({ ok: false, status: 404, error: 'Unknown Webhook' });
  expect((await new WebhookWorker({ prisma, sender: failing }).runOnce()).failed).toBe(1);
  expect((await finalize(new Date(Date.now() + 2 * 86_400_000))).statusCode).toBe(200);
  const sender = new FakeWebhookSender();
  expect((await new WebhookWorker({ prisma, sender }).runOnce()).sent).toBe(1);
});
