import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Prisma, PrismaClient } from '@prisma/client';
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

it('captures the party thread ID and clears it when the party reopens', async () => {
  await finalize(new Date(Date.now() + 86_400_000));
  const sender = new FakeWebhookSender();
  sender.queue({ ok: true, channelId: 'thread-1' });
  await new WebhookWorker({ prisma, sender }).runOnce();
  expect((await prisma.post.findUniqueOrThrow({ where: { id: postId } })).partyThreadId).toBe('thread-1');
  expect((await app.inject({ method: 'POST', url: `/api/posts/${postId}/reopen`, headers: { cookie } })).statusCode).toBe(200);
  expect((await prisma.post.findUniqueOrThrow({ where: { id: postId } })).partyThreadId).toBeNull();
});

it('never saves an old thread response for a reopened and refinalized run', async () => {
  await finalize(new Date(Date.now() + 86_400_000));
  let started!: () => void;
  let release!: () => void;
  const sending = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const sender = { send: async () => { started(); await gate; return { ok: true as const, channelId: 'old-thread' }; } };
  const worker = new WebhookWorker({ prisma, sender }).runOnce();
  await sending;
  try {
    expect((await app.inject({ method: 'POST', url: `/api/posts/${postId}/reopen`, headers: { cookie } })).statusCode).toBe(200);
    expect((await finalize(new Date(Date.now() + 2 * 86_400_000))).statusCode).toBe(200);
  } finally { release(); }
  await worker;
  expect((await prisma.post.findUniqueOrThrow({ where: { id: postId } })).partyThreadId).toBeNull();
  expect(await prisma.webhookDelivery.count({ where: { postId, status: 'pending', eventType: 'post.party_thread' } })).toBe(1);
  const next = new FakeWebhookSender();
  next.queue({ ok: true, channelId: 'new-thread' });
  await new WebhookWorker({ prisma, sender: next }).runOnce();
  expect((await prisma.post.findUniqueOrThrow({ where: { id: postId } })).partyThreadId).toBe('new-thread');
});

it('atomically fails a discarded thread before a concurrent finalization queues its replacement', async () => {
  expect((await finalize(new Date(Date.now() + 86_400_000))).statusCode).toBe(200);
  expect((await app.inject({ method: 'POST', url: `/api/posts/${postId}/reopen`, headers: { cookie } })).statusCode).toBe(200);
  let paused!: () => void;
  let release!: () => void;
  const failureRecorded = new Promise<void>((resolve) => { paused = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  function wrap(db: PrismaClient | Prisma.TransactionClient): PrismaClient | Prisma.TransactionClient {
    return new Proxy(db, { get(target, key) {
      if (key === '$transaction') return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => prisma.$transaction((tx) => callback(wrap(tx) as Prisma.TransactionClient));
      if (key !== 'webhookDelivery') return Reflect.get(target, key);
      return new Proxy(target.webhookDelivery, { get(model, operation) {
        if (operation !== 'updateMany') return Reflect.get(model, operation);
        return async (args: Prisma.WebhookDeliveryUpdateManyArgs) => {
          const result = await model.updateMany(args);
          if (args.data.status === 'failed') { paused(); await gate; }
          return result;
        };
      } });
    } });
  }
  const worker = new WebhookWorker({ prisma: wrap(prisma) as PrismaClient, sender: new FakeWebhookSender() }).runOnce();
  await failureRecorded;
  let during;
  let refinalizing;
  try {
    during = await prisma.webhookDelivery.findFirstOrThrow({ where: { postId, eventType: 'post.party_thread' } });
    refinalizing = finalize(new Date(Date.now() + 2 * 86_400_000)).then((response) => response);
  } finally { release(); }
  const [, finalized] = await Promise.all([worker, refinalizing]);
  expect(during.status).toBe('pending');
  expect(finalized!.statusCode).toBe(200);
  expect(await prisma.webhookDelivery.count({ where: { postId, eventType: 'post.party_thread', status: 'pending' } })).toBe(1);
  expect((await prisma.post.findUniqueOrThrow({ where: { id: postId } })).forumThreadRequested).toBe(true);
  expect((await new WebhookWorker({ prisma, sender: new FakeWebhookSender() }).runOnce()).sent).toBe(1);
});

it('loads the post only once to validate and build a forum delivery', async () => {
  expect((await finalize(new Date(Date.now() + 86_400_000))).statusCode).toBe(200);
  let reads = 0;
  const db = new Proxy(prisma, { get(target, key) {
    if (key !== 'post') return Reflect.get(target, key);
    return new Proxy(target.post, { get(model, operation) {
      if (operation !== 'findUnique') return Reflect.get(model, operation);
      return (args: Prisma.PostFindUniqueArgs) => { reads++; return model.findUnique(args); };
    } });
  } });
  expect((await new WebhookWorker({ prisma: db, sender: new FakeWebhookSender() }).runOnce()).sent).toBe(1);
  expect(reads).toBe(1);
});

it('retries a discarded thread if finalization completes before the failure obtains its post lock', async () => {
  expect((await finalize(new Date(Date.now() + 86_400_000))).statusCode).toBe(200);
  expect((await app.inject({ method: 'POST', url: `/api/posts/${postId}/reopen`, headers: { cookie } })).statusCode).toBe(200);
  let refinalized = false;
  const db = new Proxy(prisma, { get(target, key) {
    if (key !== '$transaction') return Reflect.get(target, key);
    return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => prisma.$transaction((tx) => callback(new Proxy(tx, { get(transaction, operation) {
      if (operation !== '$queryRaw') return Reflect.get(transaction, operation);
      return async (query: TemplateStringsArray, ...values: unknown[]) => {
        if (!refinalized && query.join('').includes('FROM "Post"') && query.join('').includes('FOR UPDATE')) {
          refinalized = true;
          expect((await finalize(new Date(Date.now() + 2 * 86_400_000))).statusCode).toBe(200);
        }
        return transaction.$queryRaw(query, ...values);
      };
    } })));
  } });
  const sender = new FakeWebhookSender();
  expect(await new WebhookWorker({ prisma: db, sender }).runOnce()).toEqual({ sent: 0, retried: 0, failed: 0 });
  expect(refinalized).toBe(true);
  expect(await prisma.webhookDelivery.count({ where: { postId, eventType: 'post.party_thread', status: 'pending' } })).toBe(1);
  expect((await prisma.post.findUniqueOrThrow({ where: { id: postId } })).forumThreadRequested).toBe(true);
  expect((await new WebhookWorker({ prisma, sender }).runOnce()).sent).toBe(1);
  expect(sender.calls).toHaveLength(1);
});

it('creates a forum thread through a configured world channel when the host has no guild', async () => {
  const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  await prisma.character.update({ where: { id: post.posterCharacterId! }, data: { guildId: null } });
  await prisma.post.update({ where: { id: postId }, data: { guildId: null } });
  expect((await finalize(new Date(Date.now() + 86_400_000))).statusCode).toBe(200);
  const delivery = await prisma.webhookDelivery.findFirstOrThrow({ where: { postId, eventType: 'post.party_thread' } });
  expect(delivery.guildId).toBe(post.guildId);
  const sender = new FakeWebhookSender();
  expect((await new WebhookWorker({ prisma, sender }).runOnce()).sent).toBe(1);
  expect(sender.calls[0]!.url).toBe(FORUM_URL);
});

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
  expect(sender.calls[0]!.payload.allowed_mentions).toEqual({ parse: [], users: [OWNER_DISCORD_ID, MEMBER_DISCORD_ID] });
  expect((await finalize(second)).statusCode).toBe(200);
  expect(await prisma.webhookDelivery.count({ where: { postId, eventType: 'post.party_thread' } })).toBe(1);
});

it('does not create a thread without a forum webhook or after the party is reopened', async () => {
  const p = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  await prisma.guild.update({ where: { id: p.guildId! }, data: { partyForumWebhookUrl: null } });
  expect((await finalize(new Date(Date.now() + 86_400_000))).statusCode).toBe(200);
  expect(await prisma.webhookDelivery.count({ where: { postId, eventType: 'post.party_thread' } })).toBe(0);
  await prisma.guild.update({ where: { id: p.guildId! }, data: { partyForumWebhookUrl: FORUM_URL } });
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
  await prisma.guild.update({ where: { id: p.guildId! }, data: { partyForumWebhookUrl: null } });
  const sender = new FakeWebhookSender();
  expect((await new WebhookWorker({ prisma, sender }).runOnce()).failed).toBe(1);
  expect((await prisma.post.findUniqueOrThrow({ where: { id: postId } })).forumThreadRequested).toBe(false);
  await prisma.guild.update({ where: { id: p.guildId! }, data: { partyForumWebhookUrl: FORUM_URL } });
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

it("marks a password or passkey member's typed Discord name as unverified in the roster", async () => {
  const post = await prisma.post.findUniqueOrThrow({ where: { id: postId } });
  const local = await makeUser({ discordId: null, username: 'typed_name' });
  const character = await makeCharacter({ ownerId: local.id, worldId: post.worldId, guildId: post.guildId, ign: 'LocalHero' });
  await addMember(postId, character.id);
  expect((await finalize(new Date(Date.now() + 86_400_000))).statusCode).toBe(200);
  const queued = await prisma.webhookDelivery.findFirstOrThrow({ where: { postId, eventType: 'post.party_thread' } });
  expect(JSON.stringify(queued.payload)).not.toContain('@typed_name');
  const sender = new FakeWebhookSender();
  expect((await new WebhookWorker({ prisma, sender }).runOnce()).sent).toBe(1);
  const content = sender.calls[0]!.payload.content!;
  expect(content).toContain('LocalHero (Discord name, unverified: typed_name)');
  expect(content).not.toContain('@typed_name');
  expect(content).toContain(`<@${OWNER_DISCORD_ID}>`);
});

it('a thread queued before request tokens existed is not sent twice when the time changes mid-send', async () => {
  await finalize(new Date(Date.now() + 86_400_000));
  const row = await prisma.webhookDelivery.findFirstOrThrow({ where: { postId, eventType: 'post.party_thread' } });
  const { requestId: _dropped, ...legacy } = (row.payload as { _forum: { webOrigin: string; requestId?: string } })._forum;
  await prisma.webhookDelivery.update({ where: { id: row.id }, data: { payload: { ...(row.payload as object), _forum: legacy } } });
  let started!: () => void;
  let release!: () => void;
  const sending = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const sender = { send: async () => { started(); await gate; return { ok: true as const, channelId: 'legacy-thread' }; } };
  const worker = new WebhookWorker({ prisma, sender }).runOnce();
  await sending;
  try {
    expect((await finalize(new Date(Date.now() + 2 * 86_400_000))).statusCode).toBe(200);
  } finally { release(); }
  await worker;
  expect(await prisma.webhookDelivery.count({ where: { postId, status: 'pending', eventType: 'post.party_thread' } })).toBe(0);
  expect((await prisma.post.findUniqueOrThrow({ where: { id: postId } })).partyThreadId).toBe('legacy-thread');
});
