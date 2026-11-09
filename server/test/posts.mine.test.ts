import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addMember, buildTestApp, loginAs, makeCharacter, makePost, prisma, resetDb } from './helpers.js';

let app: FastifyInstance;
let cookie: string;
let userId: string;

beforeEach(async () => {
  await resetDb();
  ({ app } = await buildTestApp());
  cookie = await loginAs(app, 'u-1', 'one');
  userId = (await prisma.user.findUniqueOrThrow({ where: { discordId: 'u-1' } })).id;
});
afterAll(async () => {
  await prisma.$disconnect();
});

const get = (url: string, c: string | undefined = cookie) => app.inject({ method: 'GET', url, headers: c ? { cookie: c } : {} });
const ids = (res: { json(): { id: string }[] }) => res.json().map((p) => p.id);

describe('GET /api/me/parties', () => {
  it('includes a soft-deleted post with 2 members, excludes a solo post; requires login', async () => {
    const party = await makePost({ posterUserId: userId, deletedAt: new Date() });
    await addMember(party.id, (await makeCharacter()).id);
    const solo = await makePost({ posterUserId: userId });
    const res = await get('/api/me/parties');
    expect(ids(res)).toEqual([party.id]);
    expect(ids(res)).not.toContain(solo.id);
    expect((await app.inject({ method: 'GET', url: '/api/me/parties' })).statusCode).toBe(401);
  });

  it('includes parties I joined as a member; orders scheduledAt desc, flexible last', async () => {
    const day = 86_400_000;
    const mk = async (over: Record<string, unknown>) => {
      const p = await makePost(over);
      await addMember(p.id, (await makeCharacter({ ownerId: userId })).id);
      return p.id;
    };
    const early = await mk({ scheduledAt: new Date(Date.now() + day) });
    const late = await mk({ scheduledAt: new Date(Date.now() + 3 * day) });
    const flexible = await mk({ scheduledAt: null });
    expect(ids(await get('/api/me/parties'))).toEqual([late, early, flexible]);
  });
});

describe('GET /api/me/posts', () => {
  it('lists my closed post but not my deleted one, newest first', async () => {
    const older = await makePost({ posterUserId: userId, status: 'closed', closedReason: 'manual', createdAt: new Date(Date.now() - 5000) });
    await makePost({ posterUserId: userId, deletedAt: new Date() });
    const newer = await makePost({ posterUserId: userId });
    await makePost();
    const res = await get('/api/me/posts');
    expect(ids(res)).toEqual([newer.id, older.id]);
    expect(res.json()[1].status).toBe('closed');
  });
});

describe('GET /api/me/requests', () => {
  it('returns an incoming invite and an outgoing join request with post summaries', async () => {
    const mine = await makeCharacter({ ownerId: userId });
    const recA = await makePost();
    const recB = await makePost();
    const lfp = await makePost({ posterUserId: userId, type: 'lfp', partySize: null });
    const invite = await prisma.request.create({
      data: { kind: 'invite', postId: recA.id, characterId: mine.id, lfpPostId: lfp.id, createdByUserId: recA.posterUserId },
    });
    const join = await prisma.request.create({
      data: { kind: 'join_request', postId: recB.id, characterId: mine.id, createdByUserId: userId },
    });
    await prisma.request.create({
      data: { kind: 'join_request', postId: recA.id, characterId: (await makeCharacter()).id, createdByUserId: recA.posterUserId },
    });
    const body = (await get('/api/me/requests')).json();
    expect(body.incomingInvites.map((r: { id: string }) => r.id)).toEqual([invite.id]);
    expect(body.incomingInvites[0].post.id).toBe(recA.id);
    expect(body.outgoingRequests.map((r: { id: string }) => r.id)).toEqual([join.id]);
    expect(body.outgoingRequests[0].post).toMatchObject({ id: recB.id, type: 'recruiting' });
  });
});
