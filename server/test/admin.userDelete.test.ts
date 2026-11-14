import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildTestApp, loginAs, makeCharacter, makePost, makeUser, makeWorld, prisma, resetDb, type RecordingEvents,
} from './helpers.js';

let app: FastifyInstance;
let events: RecordingEvents;
let admin: string;

beforeEach(async () => {
  await resetDb();
  ({ app, events } = await buildTestApp());
  admin = await loginAs(app, 'admin-1', 'boss');
});
afterAll(async () => {
  await prisma.$disconnect();
});

const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie: string | null = admin, payload?: unknown) =>
  app.inject({ method, url, headers: cookie ? { cookie } : {}, payload: payload as any });

describe('soft-deleting users', () => {
  it('requires an admin', async () => {
    const plain = await loginAs(app, 'u-1', 'plain');
    const u = await makeUser();
    for (const [m, url] of [['DELETE', `/api/admin/users/${u.id}`], ['POST', `/api/admin/users/${u.id}/reactivate`]] as const) {
      expect((await call(m, url, null)).statusCode).toBe(401);
      expect((await call(m, url, plain)).statusCode).toBe(403);
    }
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).deletedAt).toBeNull();
  });

  it('404 for a missing user; admins (self or other) cannot be deleted', async () => {
    expect((await call('DELETE', '/api/admin/users/nope')).statusCode).toBe(404);
    expect((await call('POST', '/api/admin/users/nope/reactivate')).statusCode).toBe(404);
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { discordId: 'admin-1' } });
    const self = await call('DELETE', `/api/admin/users/${adminUser.id}`);
    expect(self.statusCode).toBe(400);
    expect(self.json().error.code).toBe('CANNOT_DELETE_ADMIN');
  });

  it('deletes: sets deletedAt, ends sessions, closes posts like a ban, hides characters, keeps data and name claim', async () => {
    const world = await makeWorld();
    const victim = await makeUser({ discordId: 'u-2', username: 'Victim', usernameKey: 'victim' });
    const victimCookie = await loginAs(app, 'u-2', 'Victim');
    const mine = await makeCharacter({ ownerId: victim.id, worldId: world.id, ign: 'Vic' });
    const post = await makePost({ posterCharacterId: mine.id });
    const other = await makeCharacter({ worldId: world.id, ign: 'Other' });
    const request = await prisma.request.create({ data: { kind: 'join_request', postId: post.id, characterId: other.id, createdByUserId: other.ownerId } });
    expect((await call('GET', '/api/characters', victimCookie)).statusCode).toBe(200);
    events.clear();

    const res = await call('DELETE', `/api/admin/users/${victim.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: victim.id, deletedAt: expect.any(String), banned: false });

    const row = await prisma.user.findUniqueOrThrow({ where: { id: victim.id } });
    expect(row.deletedAt).not.toBeNull();
    expect(row.usernameKey).toBe('victim');
    expect(await prisma.character.count({ where: { ownerId: victim.id } })).toBe(1);
    expect(await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).toMatchObject({ status: 'closed', closedReason: 'banned' });
    expect((await prisma.request.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('declined');
    expect(events.events).toContainEqual({ type: 'post.closed', postId: post.id, reason: 'banned' });

    // The old session no longer works, and the characters are hidden from everyone else.
    expect((await call('GET', '/api/auth/me', victimCookie)).json()).toBeNull();
    const list = (await call('GET', '/api/characters', admin)).json();
    expect(list.map((c: any) => c.ign)).toEqual(['Other']);
  });

  it('a deleted user cannot sign in by Discord, with ?login=deleted', async () => {
    await makeUser({ discordId: 'u-2', username: 'Victim', deletedAt: new Date() });
    const start = await app.inject({ method: 'GET', url: '/api/auth/discord' });
    const state = new URL(String(start.headers.location)).searchParams.get('state')!;
    const cb = await app.inject({
      method: 'GET', url: `/api/auth/discord/callback?code=${encodeURIComponent('fake:u-2:Victim')}&state=${state}`,
      headers: { cookie: String(start.headers['set-cookie']).split(';')[0]! },
    });
    expect(cb.headers.location).toBe('http://localhost:5173/?login=deleted');
    expect(String(cb.headers['set-cookie'] ?? '')).not.toContain('userId');
  });

  it('a deleted user cannot sign in by password', async () => {
    const email = 'gone@example.com';
    const post = (path: 'register' | 'login') => app.inject({ method: 'POST', url: `/api/auth/password/${path}`, headers: { origin: 'http://localhost:5173' }, payload: path === 'login' ? { email, password } : { discordUserId: '123456789012345678', discordUsername: 'Gone', displayName: 'Gone', email, password } });
    const password = 'correct horse battery staple';
    const reg = await post('register');
    expect(reg.statusCode).toBe(200);
    const user = await prisma.user.findFirstOrThrow({ where: { passwordCredential: { email } } });
    expect((await post('login')).statusCode).toBe(200);
    await call('DELETE', `/api/admin/users/${user.id}`);
    expect((await post('login')).statusCode).toBe(401);
  });

  it('reactivate clears deletedAt but leaves a ban and closed posts alone', async () => {
    const victim = await makeUser({ discordId: 'u-2', username: 'Victim', banned: true, deletedAt: new Date() });
    const mine = await makeCharacter({ ownerId: victim.id, ign: 'Vic' });
    const post = await makePost({ posterCharacterId: mine.id, status: 'closed', closedReason: 'banned' });
    const res = await call('POST', `/api/admin/users/${victim.id}/reactivate`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ deletedAt: null, banned: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: victim.id } })).deletedAt).toBeNull();
    expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe('closed');
  });

  it('a banned user can be deleted, then unbanning alone does not let them back in', async () => {
    const victim = await makeUser({ discordId: 'u-2', username: 'Victim' });
    const victimCookie = await loginAs(app, 'u-2', 'Victim');
    expect((await call('PATCH', `/api/admin/users/${victim.id}`, admin, { banned: true })).statusCode).toBe(200);
    const del = await call('DELETE', `/api/admin/users/${victim.id}`);
    expect(del.statusCode).toBe(200);
    expect(del.json()).toMatchObject({ banned: true, deletedAt: expect.any(String) });
    expect((await call('PATCH', `/api/admin/users/${victim.id}`, admin, { banned: false })).json()).toMatchObject({ banned: false, deletedAt: expect.any(String) });
    expect((await call('GET', '/api/auth/me', victimCookie)).json()).toBeNull();
    expect((await call('GET', '/api/auth/me', await loginAs(app, 'u-2', 'Victim'))).json()).toBeNull();
    // Reactivating as well restores access with a fresh sign-in; the old session stays ended.
    expect((await call('POST', `/api/admin/users/${victim.id}/reactivate`)).statusCode).toBe(200);
    expect((await call('GET', '/api/auth/me', victimCookie)).json()).toBeNull();
    expect((await call('GET', '/api/auth/me', await loginAs(app, 'u-2', 'Victim'))).json()).toMatchObject({ id: victim.id });
  });

  it('deleting twice keeps the first timestamp', async () => {
    const u = await makeUser();
    await call('DELETE', `/api/admin/users/${u.id}`);
    const first = (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).deletedAt;
    await call('DELETE', `/api/admin/users/${u.id}`);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).deletedAt).toEqual(first);
  });

  it('lists with deletedAt and filters by status', async () => {
    await makeUser({ username: 'live' });
    await makeUser({ username: 'gone', deletedAt: new Date() });
    const names = async (q: string) => (await call('GET', `/api/admin/users${q}`)).json().map((u: any) => u.discordUsername).sort();
    expect(await names('')).toEqual(['boss', 'gone', 'live']);
    expect(await names('?status=all')).toEqual(['boss', 'gone', 'live']);
    expect(await names('?status=active')).toEqual(['boss', 'live']);
    expect(await names('?status=deleted')).toEqual(['gone']);
    expect((await call('GET', '/api/admin/users?status=deleted')).json()[0].deletedAt).toEqual(expect.any(String));
  });

  it('hides a deleted owner\'s posts from the board', async () => {
    const gone = await makeUser({ deletedAt: new Date() });
    const c = await makeCharacter({ ownerId: gone.id });
    await makePost({ posterCharacterId: c.id });
    const board = await call('GET', '/api/posts', admin);
    expect(board.json()).toEqual([]);
  });
});
