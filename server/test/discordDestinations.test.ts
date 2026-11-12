import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { EventDispatcher } from '../src/notifications/dispatcher.js';
import { WebhookWorker } from '../src/discord/outbox.js';
import { buildTestApp, FakeWebhookSender, loginAs, makeBossDifficulty, makeCharacter, makeGuild, makeWorld, prisma, resetDb } from './helpers.js';

const notificationUrl = 'https://discord.com/api/webhooks/101/notification';
const forumUrl = 'https://discord.com/api/webhooks/202/forum';
let app: FastifyInstance;
let events: EventDispatcher;
let cookie: string;
let worldId: number;
let otherWorldId: number;
let ownerId: string;
let characterId: string;
let bossId: number;
let guildId: string;
let chatGuildId: string;
let wrongGuildId: string;
beforeEach(async () => {
  await resetDb();
  ({ app, events } = await buildTestApp({ events: 'dispatcher' }));
  cookie = await loginAs(app, 'owner');
  ownerId = (await prisma.user.findUniqueOrThrow({ where: { discordId: 'owner' } })).id;
  worldId = (await makeWorld()).id;
  otherWorldId = (await makeWorld({ nexonWorldId: 70, name: 'Hyperion' })).id;
  characterId = (await makeCharacter({ ownerId, worldId, guildId: null })).id;
  bossId = (await makeBossDifficulty()).id;
  guildId = (await makeGuild({ worldIds: [worldId], webhookUrl: notificationUrl })).id;
  chatGuildId = (await makeGuild({ worldIds: [worldId], webhookUrl: 'https://discord.com/api/webhooks/203/other', partyForumWebhookUrl: forumUrl })).id;
  wrongGuildId = (await makeGuild({ worldIds: [otherWorldId], webhookUrl: notificationUrl, partyForumWebhookUrl: forumUrl })).id;
});
afterEach(async () => { await events.drain(); await app.close(); });
const call = (method: 'POST' | 'PATCH' | 'PUT', path: string, payload: object, session = cookie) => app.inject({ method, url: `/api/posts${path}`, headers: { cookie: session }, payload });
const create = (over: object = {}) => call('POST', '', { type: 'recruiting', characterId, bossDifficultyIds: [bossId], partySize: 4, note: '', notificationGuildId: guildId, partyForumGuildId: chatGuildId, ...over });
const finalize = (id: string) => call('PUT', `/${id}/final-time`, { scheduledAt: new Date(Date.now() + 86_400_000).toISOString() });

it('lists only active configured destinations, with capabilities and worlds but no webhook URLs', async () => {
  const inactive = await makeGuild({ active: false, worldIds: [worldId], webhookUrl: notificationUrl });
  const unconfigured = await makeGuild({ worldIds: [worldId] });
  const response = await app.inject({ url: '/api/discord-destinations', headers: { cookie } });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toContainEqual(expect.objectContaining({ id: guildId, worldIds: [worldId], notifications: true, partyForum: false }));
  expect(response.json()).not.toContainEqual(expect.objectContaining({ id: inactive.id }));
  expect(response.json()).not.toContainEqual(expect.objectContaining({ id: unconfigured.id }));
  expect(response.body).not.toContain('webhooks');
  expect((await app.inject({ url: '/api/discord-destinations' })).statusCode).toBe(401);
});

it('sends a guildless host’s announcement and closure to one guild, and the forum thread to their separate selection', async () => {
  const created = await create();
  expect(created.statusCode).toBe(201);
  expect(created.json()).toMatchObject({ guild: null, notificationGuild: { id: guildId }, partyForumGuild: { id: chatGuildId } });
  expect(created.body).not.toContain('webhooks');
  await events.drain();
  const sender = new FakeWebhookSender();
  const worker = new WebhookWorker({ prisma, sender });
  expect((await worker.runOnce()).sent).toBe(1);
  expect(sender.calls[0]!.url).toBe(notificationUrl);
  sender.calls = [];
  expect((await finalize(created.json().id)).statusCode).toBe(200);
  await events.drain();
  expect((await worker.runOnce()).sent).toBe(2);
  expect(sender.calls.map((sent) => sent.url).sort()).toEqual([notificationUrl, forumUrl].sort());
  expect(sender.calls.every((sent) => JSON.stringify(sent.payload.allowed_mentions) === JSON.stringify({ parse: [] }))).toBe(true);
});

it('treats None as no destination, without automatically choosing any guild', async () => {
  const created = await create({ notificationGuildId: null, partyForumGuildId: null });
  expect(created.statusCode).toBe(201);
  expect(created.json()).toMatchObject({ notificationGuild: null, partyForumGuild: null });
  expect((await finalize(created.json().id)).statusCode).toBe(200);
  await events.drain();
  expect(await prisma.webhookDelivery.count()).toBe(0);
});

it('rejects destinations from another world, unknown guilds, inactive guilds and missing forum configurations', async () => {
  for (const invalid of [wrongGuildId, 'missing']) {
    expect((await create({ notificationGuildId: invalid })).statusCode).toBe(400);
    expect((await create({ partyForumGuildId: invalid })).statusCode).toBe(400);
  }
  expect((await create({ partyForumGuildId: guildId })).statusCode).toBe(400);
  await prisma.guild.update({ where: { id: guildId }, data: { active: false } });
  expect((await create()).statusCode).toBe(400);
  expect(await prisma.post.count()).toBe(0);
});

it('updates only for the creator, cancels pending deliveries to an old selection, and honors the changed selection when reopened', async () => {
  const created = await create();
  const id = created.json().id;
  await events.drain();
  const other = await loginAs(app, 'other');
  expect((await call('PATCH', `/${id}`, { notificationGuildId: chatGuildId }, other)).statusCode).toBe(403);
  expect((await call('PATCH', `/${id}`, { notificationGuildId: chatGuildId })).statusCode).toBe(200);
  const sender = new FakeWebhookSender();
  expect((await new WebhookWorker({ prisma, sender }).runOnce()).sent).toBe(0);
  expect(sender.calls).toHaveLength(0);
  await call('POST', `/${id}/close`, {});
  await events.drain();
  await prisma.webhookDelivery.deleteMany();
  expect((await call('POST', `/${id}/reopen`, {})).statusCode).toBe(200);
  expect(await prisma.webhookDelivery.findFirstOrThrow()).toMatchObject({ guildId: chatGuildId, eventType: 'post.reopened' });
});

it('allows notification destination changes after finalization but locks the requested party forum', async () => {
  const created = await create();
  const id = created.json().id;
  expect((await finalize(id)).statusCode).toBe(200);
  expect((await call('PATCH', `/${id}`, { notificationGuildId: chatGuildId })).statusCode).toBe(200);
  expect((await call('PATCH', `/${id}`, { partyForumGuildId: null })).json().error.code).toBe('PARTY_CHAT_LOCKED');
  expect((await call('PATCH', `/${id}`, { note: 'Not allowed' })).statusCode).toBe(409);
});

it('clears old selections when changing to a character in another world', async () => {
  const created = await create();
  const character = await makeCharacter({ ownerId, worldId: otherWorldId, guildId: null });
  const response = await call('PATCH', `/${created.json().id}`, { characterId: character.id });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ notificationGuild: null, partyForumGuild: null });
});

it('never falls back to a different forum if the selected forum becomes unavailable', async () => {
  const created = await create();
  await prisma.guild.update({ where: { id: guildId }, data: { partyForumWebhookUrl: 'https://discord.com/api/webhooks/301/fallback' } });
  await prisma.guild.update({ where: { id: chatGuildId }, data: { partyForumWebhookUrl: null } });
  expect((await finalize(created.json().id)).statusCode).toBe(200);
  expect(await prisma.webhookDelivery.count({ where: { eventType: 'post.party_thread' } })).toBe(0);
});

it('lets a reopened party move to another world even though its previous run requested a party chat', async () => {
  const id = (await create()).json().id;
  expect((await finalize(id)).statusCode).toBe(200);
  expect((await call('POST', `/${id}/reopen`, {})).statusCode).toBe(200);
  const character = await makeCharacter({ ownerId, worldId: otherWorldId, guildId: null });
  const response = await call('PATCH', `/${id}`, { characterId: character.id });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ notificationGuild: null, partyForumGuild: null, partyChatRequested: false });
});

it('lets a party reopened in another world pick a new party chat and creates it on the next finalize', async () => {
  const id = (await create()).json().id;
  expect((await finalize(id)).statusCode).toBe(200);
  await prisma.character.update({ where: { id: characterId }, data: { worldId: otherWorldId } });
  const reopened = await call('POST', `/${id}/reopen`, {});
  expect(reopened.statusCode).toBe(200);
  expect(reopened.json()).toMatchObject({ partyForumGuild: null, partyChatRequested: false });
  expect((await call('PATCH', `/${id}`, { partyForumGuildId: wrongGuildId })).statusCode).toBe(200);
  expect((await finalize(id)).statusCode).toBe(200);
  expect(await prisma.webhookDelivery.count({ where: { postId: id, eventType: 'post.party_thread', guildId: wrongGuildId, status: 'pending' } })).toBe(1);
});

it('requests the party chat when one is picked after finalizing with None, only once', async () => {
  const id = (await create({ partyForumGuildId: null })).json().id;
  expect((await finalize(id)).statusCode).toBe(200);
  expect(await prisma.webhookDelivery.count({ where: { postId: id, eventType: 'post.party_thread' } })).toBe(0);
  const picked = await call('PATCH', `/${id}`, { partyForumGuildId: chatGuildId });
  expect(picked.statusCode).toBe(200);
  expect(picked.json()).toMatchObject({ partyForumGuild: { id: chatGuildId }, partyChatRequested: true });
  expect(await prisma.webhookDelivery.count({ where: { postId: id, eventType: 'post.party_thread', guildId: chatGuildId } })).toBe(1);
  expect((await call('PATCH', `/${id}`, { partyForumGuildId: chatGuildId })).statusCode).toBe(200);
  expect(await prisma.webhookDelivery.count({ where: { postId: id, eventType: 'post.party_thread' } })).toBe(1);
  await events.drain();
  const sender = new FakeWebhookSender();
  await new WebhookWorker({ prisma, sender }).runOnce();
  expect(sender.calls.filter((sent) => sent.url === forumUrl)).toHaveLength(1);
  expect(await prisma.webhookDelivery.findFirstOrThrow({ where: { postId: id, eventType: 'post.party_thread' } })).toMatchObject({ status: 'sent' });
});

it('never stores a party chat guild on an LFP post', async () => {
  const rejected = await create({ type: 'lfp', partySize: undefined });
  expect(rejected.statusCode).toBe(400);
  expect(rejected.json().error).toMatchObject({ code: 'VALIDATION', message: expect.stringContaining('party chat') });
  const id = (await create()).json().id;
  const switched = await call('PATCH', `/${id}`, { type: 'lfp' });
  expect(switched.statusCode).toBe(200);
  expect(switched.json()).toMatchObject({ partyForumGuild: null });
  expect((await prisma.post.findUniqueOrThrow({ where: { id } })).partyForumGuildId).toBeNull();
  expect((await call('PATCH', `/${id}`, { partyForumGuildId: chatGuildId })).statusCode).toBe(400);
  const back = await call('PATCH', `/${id}`, { type: 'recruiting', partySize: 4 });
  expect(back.statusCode).toBe(200);
  expect(back.json()).toMatchObject({ partyForumGuild: null });
});

it('drops deliveries queued for a notification guild the poster moved away from, without counting a failure', async () => {
  const id = (await create()).json().id;
  await events.drain();
  expect((await call('PATCH', `/${id}`, { notificationGuildId: chatGuildId })).statusCode).toBe(200);
  expect(await new WebhookWorker({ prisma, sender: new FakeWebhookSender() }).runOnce()).toEqual({ sent: 0, retried: 0, failed: 0 });
  expect(await prisma.webhookDelivery.count({ where: { postId: id, guildId } })).toBe(0);
});

it('sends closure notices to the guilds that saw the announcement, once per run', async () => {
  const id = (await create()).json().id;
  await events.drain();
  const sender = new FakeWebhookSender();
  const worker = new WebhookWorker({ prisma, sender });
  expect((await worker.runOnce()).sent).toBe(1);
  expect((await call('PATCH', `/${id}`, { notificationGuildId: chatGuildId })).statusCode).toBe(200);
  expect((await call('POST', `/${id}/close`, {})).statusCode).toBe(200);
  await events.drain();
  expect(await prisma.webhookDelivery.findMany({ where: { postId: id, eventType: 'post.closed' }, select: { guildId: true } })).toEqual([{ guildId }]);
  expect((await worker.runOnce()).sent).toBe(1);
  await prisma.webhookDelivery.deleteMany();
  expect((await call('POST', `/${id}/reopen`, {})).statusCode).toBe(200);
  expect((await worker.runOnce()).sent).toBe(1);
  expect((await call('POST', `/${id}/close`, {})).statusCode).toBe(200);
  await events.drain();
  expect(await prisma.webhookDelivery.findMany({ where: { postId: id, eventType: 'post.closed' }, select: { guildId: true } })).toEqual([{ guildId: chatGuildId }]);
});

it('sends no closure notice when the post was never announced', async () => {
  const id = (await create({ notificationGuildId: null })).json().id;
  await events.drain();
  expect((await call('PATCH', `/${id}`, { notificationGuildId: guildId })).statusCode).toBe(200);
  expect((await call('POST', `/${id}/close`, {})).statusCode).toBe(200);
  await events.drain();
  expect(await prisma.webhookDelivery.count({ where: { postId: id, eventType: 'post.closed' } })).toBe(0);
});

it('validates a post delivery with one post read and no separate guild-world lookup', async () => {
  await create();
  await events.drain();
  const reads = { post: 0, guildWorld: 0 };
  const db = new Proxy(prisma, { get(target, key) {
    if (key !== 'post' && key !== 'guildWorld') return Reflect.get(target, key);
    const model = Reflect.get(target, key) as unknown as Record<string, (...args: unknown[]) => unknown>;
    return new Proxy(model, { get(m, operation) {
      const fn = Reflect.get(m, operation);
      if (typeof operation !== 'string' || !operation.startsWith('find') || typeof fn !== 'function') return fn;
      return (...args: unknown[]) => { reads[key as 'post' | 'guildWorld']++; return fn.apply(m, args); };
    } });
  } });
  expect((await new WebhookWorker({ prisma: db, sender: new FakeWebhookSender() }).runOnce()).sent).toBe(1);
  expect(reads).toEqual({ post: 1, guildWorld: 0 });
});
