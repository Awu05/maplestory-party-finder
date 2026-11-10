import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  addMember, buildTestApp, loginAs, makeCharacter, makePost, makeUser, prisma, resetDb, testConfig, type RecordingEvents,
} from './helpers.js';

let app: FastifyInstance;
let events: RecordingEvents;
let adminCookie: string;
let adminId: string;

beforeEach(async () => {
  await resetDb();
  ({ app, events } = await buildTestApp());
  adminCookie = await loginAs(app, 'admin-1', 'boss');
  adminId = (await prisma.user.findUniqueOrThrow({ where: { discordId: 'admin-1' } })).id;
});
afterAll(async () => {
  await prisma.$disconnect();
});

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie: string | null = adminCookie, payload?: unknown) =>
  app.inject({ method, url, headers: cookie ? { cookie } : {}, payload: payload as any });

/** Events in a stable order, for exact comparisons that don't depend on emit order. */
const sorted = <T,>(xs: T[]) => [...xs].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

describe('authorization', () => {
  it('non-admin gets 403 on every moderation route', async () => {
    const cookie = await loginAs(app, 'u-1', 'plain');
    const routes: ['GET' | 'POST' | 'PATCH' | 'DELETE', string, unknown?][] = [
      ['GET', '/api/admin/users'],
      ['PATCH', '/api/admin/users/x', { banned: true }],
      ['GET', '/api/admin/users/x/characters'],
      ['POST', '/api/admin/characters/x/reassign', { userId: 'y' }],
      ['DELETE', '/api/admin/characters/x'],
      ['GET', '/api/admin/posts'],
    ];
    for (const [method, url, payload] of routes) {
      expect((await call(method, url, cookie, payload)).statusCode, `${method} ${url}`).toBe(403);
    }
  });
});

describe('GET /admin/users', () => {
  it('searches by case-insensitive username prefix', async () => {
    await makeUser({ username: 'AliceWong' });
    await makeUser({ username: 'alicia' });
    await makeUser({ username: 'bob' });
    const res = await call('GET', '/api/admin/users?q=ALI');
    expect(res.statusCode).toBe(200);
    expect(res.json().map((u: any) => u.discordUsername).sort()).toEqual(['AliceWong', 'alicia']);
    const all = (await call('GET', '/api/admin/users')).json();
    expect(all.length).toBe(4);
    expect(all.find((u: any) => u.discordUsername === 'boss').isAdmin).toBe(true);
  });
});

describe('ban', () => {
  it('closes posts, declines requests, hides content, blocks login, emits events; unban restores', async () => {
    const u2 = await makeUser({ discordId: 'u-2', username: 'badguy' });
    const u3 = await makeUser({ discordId: 'u-3', username: 'victim' });
    const c2 = await makeCharacter({ ownerId: u2.id, ign: 'BadChar' });
    const c3 = await makeCharacter({ ownerId: u3.id, ign: 'GoodChar' });
    const post2 = await makePost({ posterUserId: u2.id, posterCharacterId: c2.id });
    const post3 = await makePost({ posterUserId: u3.id, posterCharacterId: c3.id });
    // u-3 asked to join u-2's post; u-2's character asked to join u-3's post.
    const incoming = await prisma.request.create({ data: { kind: 'join_request', postId: post2.id, characterId: c3.id, createdByUserId: u3.id } });
    const outgoing = await prisma.request.create({ data: { kind: 'join_request', postId: post3.id, characterId: c2.id, createdByUserId: u2.id } });

    const res = await call('PATCH', `/api/admin/users/${u2.id}`, adminCookie, { banned: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: u2.id, banned: true, characterCount: 1 });

    expect(await prisma.post.findUniqueOrThrow({ where: { id: post2.id } })).toMatchObject({ status: 'closed', closedReason: 'banned' });
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post3.id } })).status).toBe('open');
    expect((await prisma.request.findUniqueOrThrow({ where: { id: incoming.id } })).status).toBe('declined');
    expect((await prisma.request.findUniqueOrThrow({ where: { id: outgoing.id } })).status).toBe('declined');

    expect(events.events).toContainEqual({ type: 'post.closed', postId: post2.id, reason: 'banned' });
    expect(events.events).toContainEqual({ type: 'request.declined', requestId: incoming.id, auto: true, actorUserId: adminId });
    expect(events.events).toContainEqual({ type: 'request.declined', requestId: outgoing.id, auto: true, actorUserId: adminId });

    // Hidden from public lists, still visible to admin.
    const chars = (await call('GET', '/api/characters', null)).json();
    expect(chars.map((c: any) => c.ign)).toEqual(['GoodChar']);
    expect((await call('GET', '/api/admin/users/' + u2.id + '/characters')).json().map((c: any) => c.ign)).toEqual(['BadChar']);
    const board = (await call('GET', '/api/posts', null)).json();
    expect(board.map((p: any) => p.id)).toEqual([post3.id]);

    // Next login is refused.
    const start = await app.inject({ method: 'GET', url: '/api/auth/discord' });
    const state = new URL(String(start.headers.location)).searchParams.get('state')!;
    const cb = await app.inject({
      method: 'GET',
      url: `/api/auth/discord/callback?code=${encodeURIComponent('fake:u-2:badguy')}&state=${state}`,
      headers: { cookie: String(start.headers['set-cookie']).split(';')[0]! },
    });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe('http://localhost:5173/?login=banned');
    expect(String(cb.headers['set-cookie'] ?? '')).not.toContain('userId');
    const me = await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: String(cb.headers['set-cookie'] ?? '').split(';')[0]! } });
    expect(me.json()).toBeNull();

    // Unban only flips the flag: character visible again, closed post stays closed.
    const un = await call('PATCH', `/api/admin/users/${u2.id}`, adminCookie, { banned: false });
    expect(un.json().banned).toBe(false);
    expect((await call('GET', '/api/characters', null)).json().map((c: any) => c.ign).sort()).toEqual(['BadChar', 'GoodChar']);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post2.id } })).status).toBe('closed');
  });

  it("declines invites tied to the banned user's LFP post, closes their full post, emits events", async () => {
    const u2 = await makeUser({ discordId: 'u-2', username: 'badguy' });
    const c2 = await makeCharacter({ ownerId: u2.id, ign: 'BadChar' });
    const lfp = await makePost({ posterUserId: u2.id, posterCharacterId: c2.id, type: 'lfp', partySize: null });
    const full = await makePost({ posterUserId: u2.id, posterCharacterId: c2.id, partySize: 2, status: 'full', closedReason: 'full' });
    const filler = await makeCharacter({ ign: 'Filler' });
    await addMember(full.id, filler.id);
    const host = await makeUser();
    const hostChar = await makeCharacter({ ownerId: host.id });
    const hostPost = await makePost({ posterUserId: host.id, posterCharacterId: hostChar.id });
    const invite = await prisma.request.create({
      data: { kind: 'invite', postId: hostPost.id, characterId: c2.id, lfpPostId: lfp.id, createdByUserId: host.id },
    });
    const decided = await prisma.request.create({
      data: { kind: 'invite', status: 'declined', decidedAt: new Date(), postId: hostPost.id, characterId: c2.id, lfpPostId: lfp.id, createdByUserId: host.id },
    });

    const res = await call('PATCH', `/api/admin/users/${u2.id}`, adminCookie, { banned: true });
    expect(res.statusCode).toBe(200);
    expect(await prisma.post.findUniqueOrThrow({ where: { id: lfp.id } })).toMatchObject({ status: 'closed', closedReason: 'banned' });
    expect(await prisma.post.findUniqueOrThrow({ where: { id: full.id } })).toMatchObject({ status: 'closed', closedReason: 'banned' });
    expect((await prisma.post.findUniqueOrThrow({ where: { id: hostPost.id } })).status).toBe('open');
    expect((await prisma.request.findUniqueOrThrow({ where: { id: invite.id } })).status).toBe('declined');
    expect(await prisma.request.findUniqueOrThrow({ where: { id: decided.id } })).toMatchObject({ status: 'declined', decidedAt: decided.decidedAt });
    expect(await prisma.postMember.count({ where: { postId: full.id } })).toBe(2); // the lineup is kept as a record
    expect(sorted(events.events)).toEqual(
      sorted([
        { type: 'post.closed', postId: lfp.id, reason: 'banned' },
        { type: 'post.closed', postId: full.id, reason: 'banned' },
        { type: 'request.declined', requestId: invite.id, auto: true, actorUserId: adminId },
      ]),
    );
  });

  it('banning an already-banned user changes nothing and emits nothing', async () => {
    const u2 = await makeUser({ discordId: 'u-2', username: 'badguy', banned: true });
    const c2 = await makeCharacter({ ownerId: u2.id });
    const post = await makePost({ posterUserId: u2.id, posterCharacterId: c2.id });
    expect((await call('PATCH', `/api/admin/users/${u2.id}`, adminCookie, { banned: true })).statusCode).toBe(200);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe('open');
    expect(events.events).toEqual([]);
  });

  it('cannot ban another env admin', async () => {
    const other = await makeUser({ discordId: 'admin-1-other', username: 'other' });
    const { app: app2 } = await buildTestApp({ config: testConfig({ adminDiscordIds: ['admin-1', 'admin-1-other'] }) });
    try {
      const cookie = await loginAs(app2, 'admin-1', 'boss');
      const res = await app2.inject({ method: 'PATCH', url: `/api/admin/users/${other.id}`, headers: { cookie }, payload: { banned: true } });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('CANNOT_BAN_ADMIN');
      expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).banned).toBe(false);
    } finally {
      await app2.close();
    }
  });

  it('cannot ban an admin or yourself', async () => {
    const res = await call('PATCH', `/api/admin/users/${adminId}`, adminCookie, { banned: true });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CANNOT_BAN_ADMIN');
  });
});

describe('characters', () => {
  it('reassign moves the character, cancels pending requests, moves membership and poster ownership', async () => {
    const u2 = await makeUser({ discordId: 'u-2', username: 'two' });
    const u3 = await makeUser({ discordId: 'u-3', username: 'three' });
    const host = await makeUser();
    const hostChar = await makeCharacter({ ownerId: host.id });
    const hostPost = await makePost({ posterUserId: host.id, posterCharacterId: hostChar.id });
    const c2 = await makeCharacter({ ownerId: u2.id, ign: 'Mover' });
    const joined = await addMember(hostPost.id, c2.id);
    const otherPost = await makePost({ posterUserId: host.id, posterCharacterId: hostChar.id });
    const pending = await prisma.request.create({ data: { kind: 'join_request', postId: otherPost.id, characterId: c2.id, createdByUserId: u2.id } });
    const own = await makePost({ posterUserId: u2.id, posterCharacterId: c2.id });

    const res = await call('POST', `/api/admin/characters/${c2.id}/reassign`, adminCookie, { userId: u3.id });
    expect(res.statusCode).toBe(200);
    expect((await prisma.character.findUniqueOrThrow({ where: { id: c2.id } })).ownerId).toBe(u3.id);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('cancelled');
    expect(events.events).toContainEqual({ type: 'request.cancelled', requestId: pending.id });
    expect((await prisma.postMember.findUniqueOrThrow({ where: { id: joined.id } })).userId).toBe(u3.id);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: own.id } })).posterUserId).toBe(u3.id);

    const c3 = await loginAs(app, 'u-3', 'three');
    const c2cookie = await loginAs(app, 'u-2', 'two');
    const edit = (cookie: string) => call('PATCH', `/api/characters/${c2.id}`, cookie, { note: 'hi' });
    expect((await edit(c3)).statusCode).toBe(200);
    expect((await edit(c2cookie)).statusCode).toBe(403);
  });

  it('reassign rejects a missing or banned target', async () => {
    const c = await makeCharacter();
    const banned = await makeUser({ banned: true });
    for (const userId of ['nope', banned.id]) {
      const res = await call('POST', `/api/admin/characters/${c.id}/reassign`, adminCookie, { userId });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION');
    }
  });

  it('admin delete keeps the party snapshot', async () => {
    const host = await makeUser();
    const hostChar = await makeCharacter({ ownerId: host.id });
    const post = await makePost({ posterUserId: host.id, posterCharacterId: hostChar.id });
    const member = await makeCharacter({ ign: 'Leaver' });
    const m = await addMember(post.id, member.id);

    const res = await call('DELETE', `/api/admin/characters/${member.id}`);
    expect(res.statusCode).toBe(204);
    expect(await prisma.character.findUnique({ where: { id: member.id } })).toBeNull();
    const row = await prisma.postMember.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.characterId).toBeNull();
    expect((row.snapshot as any).ign).toBe('Leaver');
  });
});

describe('admin character delete events', () => {
  it("closes the character's live posts, declines what was pending on them, and emits only for surviving requests", async () => {
    const owner = await makeUser();
    const c = await makeCharacter({ ownerId: owner.id, ign: 'Gone' });
    const rec = await makePost({ posterUserId: owner.id, posterCharacterId: c.id });
    const lfp = await makePost({ posterUserId: owner.id, posterCharacterId: c.id, type: 'lfp', partySize: null });
    const ended = await makePost({ posterUserId: owner.id, posterCharacterId: c.id, status: 'closed', closedReason: 'manual' });
    const joiner = await makeCharacter();
    const join = await prisma.request.create({ data: { kind: 'join_request', postId: rec.id, characterId: joiner.id, createdByUserId: joiner.ownerId } });
    const host = await makeUser();
    const hostChar = await makeCharacter({ ownerId: host.id });
    const hostPost = await makePost({ posterUserId: host.id, posterCharacterId: hostChar.id });
    // Requests naming the deleted character cascade away with it: no events for them.
    const invite = await prisma.request.create({
      data: { kind: 'invite', postId: hostPost.id, characterId: c.id, lfpPostId: lfp.id, createdByUserId: host.id },
    });

    const res = await call('DELETE', `/api/admin/characters/${c.id}`);
    expect(res.statusCode).toBe(204);
    expect(await prisma.request.findUnique({ where: { id: invite.id } })).toBeNull();
    expect((await prisma.request.findUniqueOrThrow({ where: { id: join.id } })).status).toBe('declined');
    expect((await prisma.post.findUniqueOrThrow({ where: { id: ended.id } })).closedReason).toBe('manual');
    expect(sorted(events.events)).toEqual(
      sorted([
        { type: 'post.closed', postId: rec.id, reason: 'character_deleted' },
        { type: 'post.closed', postId: lfp.id, reason: 'character_deleted' },
        { type: 'request.declined', requestId: join.id, auto: true, actorUserId: adminId },
      ]),
    );
  });

  it('unknown character -> 404, no events', async () => {
    const res = await call('DELETE', '/api/admin/characters/nope');
    expect(res.statusCode).toBe(404);
    expect(events.events).toEqual([]);
  });
});

describe('GET /admin/posts', () => {
  it('filters by effective status and includes soft-deleted party posts under deleted', async () => {
    const open = await makePost({});
    const full = await makePost({ status: 'full' });
    const expired = await makePost({ expiresAt: new Date(Date.now() - 1000), scheduledAt: null });
    const closed = await makePost({ status: 'closed', closedReason: 'manual' });
    const deleted = await makePost({ deletedAt: new Date() });
    const ids = async (status: string) => (await call('GET', `/api/admin/posts?status=${status}`)).json().map((p: any) => p.id).sort();

    expect(await ids('open')).toEqual([open.id]);
    expect(await ids('full')).toEqual([full.id]);
    expect(await ids('closed')).toEqual([expired.id, closed.id].sort());
    expect(await ids('deleted')).toEqual([deleted.id]);
    expect((await ids('all')).length).toBe(5);

    const dto = (await call('GET', '/api/admin/posts?status=deleted')).json()[0];
    expect(dto.deletedAt).not.toBeNull();
    expect(typeof dto.posterDiscordUsername).toBe('string');
  });

  it('q matches the poster IGN prefix', async () => {
    const c = await makeCharacter({ ign: 'Zelda' });
    const hit = await makePost({ posterCharacterId: c.id });
    await makePost({});
    const res = (await call('GET', '/api/admin/posts?q=zel')).json();
    expect(res.map((p: any) => p.id)).toEqual([hit.id]);
  });
});
