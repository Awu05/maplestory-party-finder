import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Storage } from '../src/storage/storage.js';
import type { Character, Guild, PrismaClient } from '@prisma/client';
import { EventDispatcher } from '../src/notifications/dispatcher.js';
import {
  addMember, buildTestApp, loginAs, makeBossDifficulty, makeCharacter, makeGuild, makePost, makeUser, makeWorld, prisma, resetDb,
  type LogEntry,
} from './helpers.js';

const HOOK = 'https://discord.test/api/webhooks/1/secret';

let app: FastifyInstance;
let events: EventDispatcher;
let logs: LogEntry[];
let storage: Storage;
let u1: string; // poster (Alice, G1)
let u2: string; // Bob (G5)
let u3: string; // Carol (G2, no webhook)
let u1Id: string;
let u2Id: string;
let u3Id: string;
let kronosId: number;
let lucid: number;
let g1: Guild;
let g5: Guild;
let alice: Character;
let bob: Character;
let carol: Character;

beforeEach(async () => {
  await resetDb();
  ({ app, events, logs, storage } = await buildTestApp({ events: 'dispatcher' }));
  u1 = await loginAs(app, 'u-1', 'one');
  u2 = await loginAs(app, 'u-2', 'two');
  u3 = await loginAs(app, 'u-3', 'three');
  const id = async (d: string) => (await prisma.user.findUniqueOrThrow({ where: { discordId: d } })).id;
  [u1Id, u2Id, u3Id] = [await id('u-1'), await id('u-2'), await id('u-3')];
  const kronos = await makeWorld({ nexonWorldId: 45, name: 'Kronos' });
  const bera = await makeWorld({ nexonWorldId: 1, name: 'Bera' });
  kronosId = kronos.id;
  g1 = await makeGuild({ name: 'G1', worldIds: [kronos.id], webhookUrl: HOOK });
  const g2 = await makeGuild({ name: 'G2', worldIds: [kronos.id] });
  await makeGuild({ name: 'G3', worldIds: [bera.id], webhookUrl: HOOK });
  await makeGuild({ name: 'G4', worldIds: [kronos.id], webhookUrl: HOOK, active: false });
  g5 = await makeGuild({ name: 'G5', webhookUrl: HOOK }); // plays no world: never gets new-post broadcasts
  lucid = (await makeBossDifficulty({ bossName: 'Lucid', difficulty: 'Hard', partyCap: 6 })).id;
  alice = await makeCharacter({ ownerId: u1Id, worldId: kronos.id, guildId: g1.id, ign: 'Alice' });
  bob = await makeCharacter({ ownerId: u2Id, worldId: kronos.id, guildId: g5.id, ign: 'Bob' });
  carol = await makeCharacter({ ownerId: u3Id, worldId: kronos.id, guildId: g2.id, ign: 'Carol' });
});
afterAll(async () => {
  await prisma.$disconnect();
});

const call = (method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, cookie: string, body?: unknown) =>
  app.inject({ method, url, headers: { cookie }, ...(body === undefined ? {} : { payload: body as object }) });
const recruiting = (partySize = 4) => makePost({ posterCharacterId: alice.id, partySize, bossDifficultyIds: [lucid] });
const join = async (postId: string, characterId: string, cookie: string): Promise<string> => {
  const res = await call('POST', `/api/posts/${postId}/requests`, cookie, { characterId });
  expect(res.statusCode).toBe(201);
  return res.json().id;
};
const invite = async (lfpId: string, recruitingPostId: string, cookie: string): Promise<string> => {
  const res = await call('POST', `/api/posts/${lfpId}/invites`, cookie, { recruitingPostId });
  expect(res.statusCode).toBe(201);
  return res.json().id;
};
const notes = () => prisma.notification.findMany({ orderBy: { createdAt: 'asc' } });
const deliveries = () => prisma.webhookDelivery.findMany({ orderBy: { createdAt: 'asc' } });
const content = (d: { payload: unknown }) => (d.payload as { content?: string }).content ?? '';

describe('post.created', () => {
  it('Kronos recruiting post -> exactly one delivery, for G1 (active, webhook, plays Kronos)', async () => {
    const res = await call('POST', '/api/posts', u1, {
      type: 'recruiting', characterId: alice.id, bossDifficultyIds: [lucid],
      freeTimes: [68], freeTimesZone: 'America/New_York', partySize: 4, note: 'hi',
    });
    expect(res.statusCode).toBe(201);
    await events.drain();
    const ds = await deliveries();
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ guildId: g1.id, eventType: 'post.created', status: 'pending' });
    expect(JSON.stringify(ds[0]!.payload)).toContain(`http://localhost:5173/posts/${res.json().id}`);
    expect(JSON.stringify(ds[0]!.payload)).toContain('Not set yet — see free times on the post');
    expect(await notes()).toEqual([]);
  });

  it('broadcasts one pending delivery per matching guild, all with the same payload and postId', async () => {
    const g6 = await makeGuild({ name: 'G6', worldIds: [kronosId], webhookUrl: HOOK });
    const res = await call('POST', '/api/posts', u1, {
      type: 'recruiting', characterId: alice.id, bossDifficultyIds: [lucid],
      partySize: 4, note: 'hi',
    });
    await events.drain();
    const ds = await deliveries();
    expect(ds.map((d) => d.guildId).sort()).toEqual([g1.id, g6.id].sort());
    for (const d of ds) expect(d).toMatchObject({ eventType: 'post.created', status: 'pending', postId: res.json().id, attempts: 0 });
    expect(ds[0]!.payload).toEqual(ds[1]!.payload);
  });
});

describe('request.created', () => {
  it('join request -> poster gets join_request linking /posts/:id; one ping to poster guild mentioning poster', async () => {
    const post = await recruiting();
    await join(post.id, bob.id, u2);
    await events.drain();
    const ns = await notes();
    expect(ns).toHaveLength(1);
    expect(ns[0]).toMatchObject({ userId: u1Id, kind: 'join_request', text: 'Bob wants to join your Hard Lucid run', link: `/posts/${post.id}` });
    const ds = await deliveries();
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ guildId: g1.id, eventType: 'request.created' });
    expect(content(ds[0]!)).toContain('<@u-1>');
    expect(ds[0]!.payload).toMatchObject({ allowed_mentions: { parse: [], users: ['u-1'] } });
  });

  it("join request ping goes to the poster character's current guild, not the post's snapshot guild", async () => {
    const post = await recruiting();
    await prisma.character.update({ where: { id: alice.id }, data: { guildId: g5.id } });
    await join(post.id, bob.id, u2);
    await events.drain();
    const ds = await deliveries();
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ guildId: g5.id, eventType: 'request.created' });
  });

  it('invite to a guildless character -> notification only, no ping, no throw', async () => {
    const post = await recruiting();
    const lfp = await makePost({ type: 'lfp', partySize: null, posterCharacterId: bob.id, bossDifficultyIds: [lucid] });
    const requestId = await invite(lfp.id, post.id, u1);
    await events.drain();
    await prisma.notification.deleteMany();
    await prisma.webhookDelivery.deleteMany();
    // The character loses its guild after the invite exists; the event is dispatched again.
    await prisma.character.update({ where: { id: bob.id }, data: { guildId: null } });
    events.emit({ type: 'request.created', requestId });
    await events.drain();
    expect(await notes()).toHaveLength(1);
    expect(await deliveries()).toEqual([]);
  });

  it('invite -> invitee notified; ping to invitee guild mentioning invitee', async () => {
    const post = await recruiting();
    const lfp = await makePost({ type: 'lfp', partySize: null, posterCharacterId: bob.id, bossDifficultyIds: [lucid] });
    await invite(lfp.id, post.id, u1);
    await events.drain();
    const ns = await notes();
    expect(ns).toHaveLength(1);
    expect(ns[0]).toMatchObject({ userId: u2Id, kind: 'invite', text: 'Alice invited Bob to Hard Lucid', link: `/posts/${post.id}` });
    const ds = await deliveries();
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ guildId: g5.id, eventType: 'request.created' });
    expect(content(ds[0]!)).toContain('<@u-2>');
  });

  it('ping skipped when the target guild has no webhook; the notification is still written', async () => {
    const carolPost = await makePost({ posterCharacterId: carol.id, partySize: 4, bossDifficultyIds: [lucid] });
    await join(carolPost.id, bob.id, u2);
    await events.drain();
    expect((await notes()).map((n) => [n.userId, n.kind])).toEqual([[u3Id, 'join_request']]);
    expect(await deliveries()).toEqual([]);
  });

  it('ping skipped when the target guild is inactive (even with a webhook); the notification is still written', async () => {
    const g4 = await prisma.guild.findFirstOrThrow({ where: { name: 'G4' } });
    expect(g4).toMatchObject({ active: false, webhookUrl: HOOK });
    await prisma.character.update({ where: { id: alice.id }, data: { guildId: g4.id } });
    const post = await recruiting();
    await join(post.id, bob.id, u2);
    await events.drain();
    expect((await notes()).map((n) => [n.userId, n.kind])).toEqual([[u1Id, 'join_request']]);
    expect(await deliveries()).toEqual([]);
  });

  it('ping skipped when the recipient has no Discord id; the notification is still written', async () => {
    const post = await recruiting();
    await join(post.id, bob.id, u2);
    await events.drain();
    expect(await deliveries()).toHaveLength(1); // the baseline: G1 can receive pings for u-1
    await prisma.webhookDelivery.deleteMany();
    await prisma.notification.deleteMany();
    await prisma.user.update({ where: { id: u1Id }, data: { discordId: '' } });
    await join(post.id, carol.id, u3);
    await events.drain();
    expect((await notes()).map((n) => [n.userId, n.kind])).toEqual([[u1Id, 'join_request']]);
    expect(await deliveries()).toEqual([]);
  });

  it('the poster inviting their own alt sends no ping and no notification', async () => {
    const post = await recruiting();
    const alt = await makeCharacter({ ownerId: u1Id, worldId: kronosId, guildId: g1.id, ign: 'AliceAlt' });
    const lfp = await makePost({ type: 'lfp', partySize: null, posterCharacterId: alt.id, bossDifficultyIds: [lucid] });
    await invite(lfp.id, post.id, u1);
    await events.drain();
    expect(await notes()).toEqual([]);
    expect(await deliveries()).toEqual([]);
  });

  it("the actor is never notified about their own action (poster's own alt applies)", async () => {
    const post = await recruiting();
    const alt = await makeCharacter({ ownerId: u1Id, worldId: kronosId, guildId: g1.id, ign: 'AliceAlt' });
    await join(post.id, alt.id, u1);
    await events.drain();
    expect(await notes()).toEqual([]);
    expect(await deliveries()).toEqual([]);
  });
});

describe('request.accepted', () => {
  it('accept join request -> applicant notified accepted + accept ping to applicant guild', async () => {
    const post = await recruiting();
    const reqId = await join(post.id, bob.id, u2);
    await events.drain();
    expect((await call('POST', `/api/requests/${reqId}/accept`, u1)).statusCode).toBe(200);
    await events.drain();
    const ns = await notes();
    expect(ns.map((n) => [n.userId, n.kind])).toEqual([[u1Id, 'join_request'], [u2Id, 'accepted']]);
    expect(ns[1]!.link).toBe(`/posts/${post.id}`);
    const accepts = (await deliveries()).filter((d) => d.eventType === 'request.accepted');
    expect(accepts).toHaveLength(1);
    expect(accepts[0]!.guildId).toBe(g5.id);
    expect(content(accepts[0]!)).toContain('<@u-2>');
  });

  it('accept invite -> poster notified, no ping', async () => {
    const post = await recruiting();
    const lfp = await makePost({ type: 'lfp', partySize: null, posterCharacterId: bob.id, bossDifficultyIds: [lucid] });
    const reqId = await invite(lfp.id, post.id, u1);
    await events.drain();
    expect((await call('POST', `/api/requests/${reqId}/accept`, u2)).statusCode).toBe(200);
    await events.drain();
    const ns = await notes();
    expect(ns.map((n) => [n.userId, n.kind])).toEqual([[u2Id, 'invite'], [u1Id, 'accepted']]);
    expect(ns[1]).toMatchObject({ text: 'Bob accepted your invite', link: `/posts/${post.id}` });
    expect((await deliveries()).map((d) => d.eventType)).toEqual(['request.created']);
  });
});

describe('request.declined', () => {
  it('manual decline of a join request -> applicant notified declined, no delivery', async () => {
    const post = await recruiting();
    const reqId = await join(post.id, bob.id, u2);
    await events.drain();
    expect((await call('POST', `/api/requests/${reqId}/decline`, u1)).statusCode).toBe(200);
    await events.drain();
    expect((await notes()).map((n) => [n.userId, n.kind])).toEqual([[u1Id, 'join_request'], [u2Id, 'declined']]);
    expect((await deliveries()).map((d) => d.eventType)).toEqual(['request.created']);
  });

  it('manual decline of an invite -> poster notified declined, no delivery', async () => {
    const post = await recruiting();
    const lfp = await makePost({ type: 'lfp', partySize: null, posterCharacterId: bob.id, bossDifficultyIds: [lucid] });
    const reqId = await invite(lfp.id, post.id, u1);
    await events.drain();
    expect((await call('POST', `/api/requests/${reqId}/decline`, u2)).statusCode).toBe(200);
    await events.drain();
    expect((await notes()).map((n) => [n.userId, n.kind])).toEqual([[u2Id, 'invite'], [u1Id, 'declined']]);
    expect((await deliveries()).map((d) => d.eventType)).toEqual(['request.created']);
  });

  it('fill party -> auto-declined applicant gets auto_declined, no delivery for it', async () => {
    const post = await recruiting(2);
    const bobReq = await join(post.id, bob.id, u2);
    await join(post.id, carol.id, u3);
    expect((await call('POST', `/api/requests/${bobReq}/accept`, u1)).statusCode).toBe(200);
    await events.drain();
    const auto = (await notes()).filter((n) => n.kind === 'auto_declined');
    expect(auto).toHaveLength(1);
    expect(auto[0]).toMatchObject({ userId: u3Id, text: 'The Hard Lucid party filled or the post closed', link: '/me/parties?tab=requests' });
    expect((await deliveries()).map((d) => d.eventType).sort()).toEqual(['request.accepted', 'request.created', 'request.created']);
  });

  it("accepting one invite auto-declines the invitee's other invites without notifying the invitee (the actor) or the inviter", async () => {
    const alicePost = await recruiting();
    const carolPost = await makePost({ posterCharacterId: carol.id, partySize: 4, bossDifficultyIds: [lucid] });
    const lfp = await makePost({ type: 'lfp', partySize: null, posterCharacterId: bob.id, bossDifficultyIds: [lucid] });
    const fromAlice = await invite(lfp.id, alicePost.id, u1);
    const fromCarol = await invite(lfp.id, carolPost.id, u3);
    await events.drain();
    expect((await call('POST', `/api/requests/${fromAlice}/accept`, u2)).statusCode).toBe(200);
    await events.drain();
    expect((await prisma.request.findUniqueOrThrow({ where: { id: fromCarol } })).status).toBe('declined');
    const ns = await notes();
    expect(ns.filter((n) => n.kind === 'auto_declined')).toEqual([]);
    expect(ns.filter((n) => n.userId === u3Id)).toEqual([]);
    expect(ns.map((n) => [n.userId, n.kind])).toEqual([[u2Id, 'invite'], [u2Id, 'invite'], [u1Id, 'accepted']]);
  });

  it('character deletion cascade-deletes the request -> auto decline skipped silently', async () => {
    const post = await recruiting();
    await join(post.id, bob.id, u2);
    await events.drain();
    expect((await call('DELETE', `/api/characters/${bob.id}`, u2)).statusCode).toBe(204);
    await events.drain();
    expect((await notes()).map((n) => n.kind)).toEqual(['join_request']);
    expect(logs).toEqual([]);
  });
});

describe('member.left', () => {
  it('poster removes member -> member notified removed; member leaves -> poster notified member_left', async () => {
    const post = await recruiting();
    const bobMember = await addMember(post.id, bob.id);
    const carolMember = await addMember(post.id, carol.id);
    expect((await call('DELETE', `/api/posts/${post.id}/members/${bobMember.id}`, u1)).statusCode).toBe(200);
    await events.drain();
    expect((await call('DELETE', `/api/posts/${post.id}/members/${carolMember.id}`, u3)).statusCode).toBe(200);
    await events.drain();
    const ns = await notes();
    expect(ns.map((n) => [n.userId, n.kind, n.link])).toEqual([
      [u2Id, 'removed', `/posts/${post.id}`],
      [u1Id, 'member_left', `/posts/${post.id}`],
    ]);
    expect(ns[1]!.text).toContain('Carol');
    expect(await deliveries()).toEqual([]);
  });
});

describe('ignored events', () => {
  it('post close / edit / cancel produce no notifications or deliveries', async () => {
    const post = await recruiting();
    const reqId = await join(post.id, bob.id, u2);
    await events.drain();
    const [n0, d0] = [(await notes()).length, (await deliveries()).length];
    expect((await call('POST', `/api/requests/${reqId}/cancel`, u2)).statusCode).toBe(200);
    expect((await call('PATCH', `/api/posts/${post.id}`, u1, { note: 'edited' })).statusCode).toBe(200);
    expect((await call('POST', `/api/posts/${post.id}/close`, u1)).statusCode).toBe(200);
    await events.drain();
    expect((await notes()).length).toBe(n0);
    expect((await deliveries()).length).toBe(d0);
  });
});

describe('errors', () => {
  it('dispatcher error (prisma rejects) is logged, emit does not throw, the HTTP response was already 201', async () => {
    const errorLogs: LogEntry[] = [];
    const broken = {
      post: { findUnique: () => Promise.reject(new TypeError(`boom ${HOOK}`)) },
      request: { findUnique: () => Promise.reject(Object.assign(new Error(`fk ${HOOK}`), { code: 'P2003' })) },
    } as unknown as PrismaClient;
    const dispatcher = new EventDispatcher({
      prisma: broken, storage, webOrigin: 'http://localhost:5173',
      log: { error: (obj, msg) => errorLogs.push({ obj, msg }) },
    });
    const { app: brokenApp } = await buildTestApp({ events: dispatcher });
    const res = await brokenApp.inject({
      method: 'POST', url: '/api/posts', headers: { cookie: await loginAs(brokenApp, 'u-1', 'one') },
      payload: {
        type: 'recruiting', characterId: alice.id, bossDifficultyIds: [lucid],
        partySize: 4, note: 'hi',
      },
    });
    expect(res.statusCode).toBe(201);
    await dispatcher.drain();
    expect(errorLogs).toEqual([{ obj: { event: 'post.created', postId: res.json().id, errName: 'TypeError' }, msg: 'event dispatch failed' }]);
    expect(JSON.stringify(errorLogs)).not.toContain('discord.test');
    errorLogs.length = 0;
    expect(() => dispatcher.emit({ type: 'request.declined', requestId: 'r-1', auto: true, actorUserId: null })).not.toThrow();
    await dispatcher.drain();
    expect(errorLogs).toEqual([
      { obj: { event: 'request.declined', requestId: 'r-1', errName: 'Error', code: 'P2003' }, msg: 'event dispatch failed' },
    ]);
    expect(JSON.stringify(errorLogs)).not.toContain('discord.test');
    expect(await deliveries()).toEqual([]);
  });
});

describe('post.finalized', () => {
  it('notifies members (not the poster) and pings those in a webhook guild', async () => {
    const post = await recruiting();
    await addMember(post.id, bob.id); // G5, webhook
    await addMember(post.id, carol.id); // G2, no webhook
    const loner = await makeCharacter({ ownerId: (await makeUser({ discordId: 'u-9', username: 'nine' })).id, worldId: (await prisma.world.findFirstOrThrow()).id, guildId: null, ign: 'Loner' });
    await addMember(post.id, loner.id);
    const at = new Date(Date.now() + 2 * 86_400_000).toISOString();
    expect((await call('PUT', `/api/posts/${post.id}/final-time`, u1, { scheduledAt: at })).statusCode).toBe(200);
    await events.drain();
    const ns = await notes();
    expect(ns.map((n) => n.kind)).toEqual(['time_set', 'time_set', 'time_set']);
    expect(ns.map((n) => n.userId).sort()).toEqual([u2Id, u3Id, (await prisma.user.findUniqueOrThrow({ where: { discordId: 'u-9' } })).id].sort());
    expect(ns.every((n) => n.link === `/posts/${post.id}` && n.text === 'Alice set the time for Hard Lucid')).toBe(true);
    const ds = await deliveries();
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ guildId: g5.id, eventType: 'post.finalized' });
    expect(content(ds[0]!)).toContain('<@u-2>');
    expect(content(ds[0]!)).toContain('<t:');
    expect((ds[0]!.payload as { allowed_mentions: unknown }).allowed_mentions).toEqual({ parse: [], users: ['u-2'] });
  });
});
