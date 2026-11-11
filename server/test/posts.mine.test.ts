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
    const solo = await makePost({ posterUserId: userId, scheduledAt: null });
    const res = await get('/api/me/parties');
    expect(ids(res)).toEqual([party.id]);
    expect(ids(res)).not.toContain(solo.id);
    expect((await app.inject({ method: 'GET', url: '/api/me/parties' })).statusCode).toBe(401);
  });

  it('includes solo finalized parties, including past runs, but not other users\' parties', async () => {
    const solo = await makePost({ posterUserId: userId, scheduledAt: null });
    const at = new Date(Date.now() + 86_400_000).toISOString();
    const finalized = await app.inject({ method: 'PUT', url: `/api/posts/${solo.id}/final-time`, headers: { cookie }, payload: { scheduledAt: at } });
    expect(finalized.statusCode).toBe(200);
    const past = await makePost({ posterUserId: userId, status: 'closed', closedReason: 'manual', scheduledAt: new Date(Date.now() - 86_400_000), expiresAt: new Date(Date.now() - 1000) });
    const other = await makePost({ status: 'closed', closedReason: 'finalized' });
    const result = (await get('/api/me/parties')).json();
    expect(result.map((p: { id: string }) => p.id)).toEqual([solo.id, past.id]);
    expect(result.find((p: { id: string }) => p.id === solo.id)).toMatchObject({ memberCount: 1, recruitmentClosed: true });
    expect(result.map((p: { id: string }) => p.id)).not.toContain(other.id);
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

describe('GET /api/me/parties history', () => {
  it('returns all parties beyond 100, including an unscheduled active party', async () => {
    const character = await makeCharacter({ ownerId: userId });
    const base = Date.now() + 86_400_000;
    const posts = await prisma.post.createManyAndReturn({
      data: Array.from({ length: 101 }, (_, i) => ({
        type: 'recruiting' as const, partySize: 4, status: 'closed' as const, closedReason: 'finalized' as const,
        posterUserId: userId, posterCharacterId: character.id, worldId: character.worldId, guildId: character.guildId!,
        scheduledAt: new Date(base + i * 60_000), expiresAt: new Date(base + i * 60_000 + 3 * 3_600_000),
      })),
      select: { id: true, scheduledAt: true },
    });
    await prisma.postMember.createMany({ data: posts.map((p) => ({ postId: p.id, characterId: character.id, userId, role: 'poster' as const, cpAtJoin: character.combatPower, snapshot: { ign: character.ign, jobName: character.jobName, level: character.level, imageUrl: character.imageUrl, worldName: 'w', guildName: 'g' } })) });
    const active = await makePost({ posterCharacterId: character.id, scheduledAt: null });
    await addMember(active.id, (await makeCharacter()).id);
    const result = ids(await get('/api/me/parties'));
    const expected = [...posts].sort((a, b) => b.scheduledAt!.getTime() - a.scheduledAt!.getTime()).map((p) => p.id);
    expected.push(active.id);
    expect(result).toEqual(expected);
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

  it('leaves out requests on ended posts and invites whose LFP post has ended', async () => {
    const mine = await makeCharacter({ ownerId: userId });
    const past = { scheduledAt: new Date(Date.now() - 86_400_000), expiresAt: new Date(Date.now() - 1000) };
    const expired = await makePost(past);
    const closed = await makePost({ status: 'closed', closedReason: 'manual' });
    const deleted = await makePost({ deletedAt: new Date() });
    const full = await makePost({ status: 'full', closedReason: 'full' });
    const live = await makePost();
    const join = (postId: string) =>
      prisma.request.create({ data: { kind: 'join_request', postId, characterId: mine.id, createdByUserId: userId } });
    await join(expired.id);
    await join(closed.id);
    await join(deleted.id);
    const onFull = await join(full.id);
    const lfp = (over: Record<string, unknown> = {}) => makePost({ posterUserId: userId, posterCharacterId: mine.id, type: 'lfp', partySize: null, ...over });
    const invite = (postId: string, lfpPostId: string | null) =>
      prisma.request.create({ data: { kind: 'invite', postId, characterId: mine.id, lfpPostId, createdByUserId: userId } });
    const recs = await Promise.all([makePost(), makePost(), makePost()]);
    await invite(recs[0]!.id, (await lfp({ status: 'closed', closedReason: 'manual' })).id);
    await invite(recs[1]!.id, (await lfp(past)).id);
    const ok = await invite(recs[2]!.id, (await lfp()).id);
    const noLfp = await invite(live.id, null);
    const body = (await get('/api/me/requests')).json();
    expect(body.outgoingRequests.map((r: { id: string }) => r.id)).toEqual([onFull.id]);
    expect(body.incomingInvites.map((r: { id: string }) => r.id).sort()).toEqual([ok.id, noLfp.id].sort());
  });
});
