import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addMember, buildTestApp, loginAs, makeCharacter, makePost, prisma, resetDb, type RecordingEvents } from './helpers.js';

let app: FastifyInstance;
let events: RecordingEvents;
let posterCookie: string;
let posterUserId: string;

beforeEach(async () => {
  await resetDb();
  ({ app, events } = await buildTestApp());
  posterCookie = await loginAs(app, 'poster-1', 'poster');
  posterUserId = (await prisma.user.findUniqueOrThrow({ where: { discordId: 'poster-1' } })).id;
});
afterAll(async () => {
  await prisma.$disconnect();
});

const del = (url: string, cookie?: string) => app.inject({ method: 'DELETE', url, headers: cookie ? { cookie } : {} });

async function partyWithMember(postOver: Record<string, unknown> = {}) {
  const post = await makePost({ posterUserId, ...postOver });
  const memberCookie = await loginAs(app, 'member-1', 'member');
  const owner = await prisma.user.findUniqueOrThrow({ where: { discordId: 'member-1' } });
  const character = await makeCharacter({ ownerId: owner.id, ign: 'Mem' });
  const member = await addMember(post.id, character.id);
  return { post, member, memberCookie };
}

describe('leave / remove member', () => {
  it('member leaves -> removed; member.left removedBy self', async () => {
    const { post, member, memberCookie } = await partyWithMember();
    const res = await del(`/api/posts/${post.id}/members/${member.id}`, memberCookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().members).toHaveLength(1);
    expect(await prisma.postMember.count({ where: { id: member.id } })).toBe(0);
    expect(events.events).toContainEqual({
      type: 'member.left', postId: post.id, memberId: member.id, userId: member.userId, ign: 'Mem', removedBy: 'self',
    });
  });

  it('poster removes member -> removedBy poster', async () => {
    const { post, member } = await partyWithMember();
    const res = await del(`/api/posts/${post.id}/members/${member.id}`, posterCookie);
    expect(res.statusCode).toBe(200);
    expect(events.events).toContainEqual(expect.objectContaining({ type: 'member.left', removedBy: 'poster', userId: member.userId }));
  });

  it('stranger -> 403 NOT_ALLOWED; poster leaving own row -> 409 CANNOT_LEAVE_OWN_POST', async () => {
    const { post, member } = await partyWithMember();
    const stranger = await loginAs(app, 'stranger-1', 'stranger');
    const forbidden = await del(`/api/posts/${post.id}/members/${member.id}`, stranger);
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe('NOT_ALLOWED');
    const posterRow = await prisma.postMember.findFirstOrThrow({ where: { postId: post.id, role: 'poster' } });
    const own = await del(`/api/posts/${post.id}/members/${posterRow.id}`, posterCookie);
    expect(own.statusCode).toBe(409);
    expect(own.json().error.code).toBe('CANNOT_LEAVE_OWN_POST');
  });

  it('deleted post -> 409 POST_CLOSED', async () => {
    const { post, member, memberCookie } = await partyWithMember({ deletedAt: new Date() });
    const res = await del(`/api/posts/${post.id}/members/${member.id}`, memberCookie);
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('POST_CLOSED');
  });

  it('leaving a full post reopens it (open, on board, post.reopened)', async () => {
    const { post, member, memberCookie } = await partyWithMember({ status: 'full', closedReason: 'full' });
    const res = await del(`/api/posts/${post.id}/members/${member.id}`, memberCookie);
    expect(res.json().status).toBe('open');
    expect(await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).toMatchObject({ status: 'open', closedReason: null });
    const board = await app.inject({ method: 'GET', url: '/api/posts' });
    expect(board.json().map((p: { id: string }) => p.id)).toContain(post.id);
    expect(events.events).toContainEqual({ type: 'post.reopened', postId: post.id });
  });

  it('ended party (expired or manually closed) -> 409 POST_CLOSED, member kept, no events', async () => {
    const { post, member, memberCookie } = await partyWithMember({
      status: 'full', closedReason: 'full', scheduledAt: new Date(Date.now() - 86_400_000), expiresAt: new Date(Date.now() - 1000),
    });
    const expired = await del(`/api/posts/${post.id}/members/${member.id}`, memberCookie);
    expect(expired.statusCode).toBe(409);
    expect(expired.json().error.code).toBe('POST_CLOSED');
    await prisma.post.update({ where: { id: post.id }, data: { status: 'closed', closedReason: 'manual', expiresAt: new Date(Date.now() + 86_400_000) } });
    const closed = await del(`/api/posts/${post.id}/members/${member.id}`, posterCookie);
    expect(closed.statusCode).toBe(409);
    expect(closed.json().error.code).toBe('POST_CLOSED');
    expect(await prisma.postMember.findUnique({ where: { id: member.id } })).not.toBeNull();
    expect(events.events).toEqual([]);
  });
});

describe('character deletion keeps party records', () => {
  it('Bob deleted: party keeps snapshot, his LFP closes, his requests vanish, events emitted', async () => {
    const u1 = await loginAs(app, 'u-1', 'one');
    const u2 = await loginAs(app, 'u-2', 'two');
    const user1 = await prisma.user.findUniqueOrThrow({ where: { discordId: 'u-1' } });
    const user2 = await prisma.user.findUniqueOrThrow({ where: { discordId: 'u-2' } });
    const party = await makePost({ posterUserId: user1.id });
    const bob = await makeCharacter({ ownerId: user2.id, ign: 'Bob', combatPower: 5_000_000n });
    await addMember(party.id, bob.id);
    const lfp = await makePost({ posterUserId: user2.id, posterCharacterId: bob.id, type: 'lfp', partySize: null });
    const invite = await prisma.request.create({
      data: { kind: 'invite', postId: party.id, characterId: bob.id, lfpPostId: lfp.id, createdByUserId: user1.id },
    });
    // A pending join request on Bob's own recruiting post, from another character, is declined too.
    const rec = await makePost({ posterUserId: user2.id, posterCharacterId: bob.id });
    const joiner = await makeCharacter();
    const join = await prisma.request.create({
      data: { kind: 'join_request', postId: rec.id, characterId: joiner.id, createdByUserId: joiner.ownerId },
    });

    const res = await del(`/api/characters/${bob.id}`, u2);
    expect(res.statusCode).toBe(204);

    const parties = await app.inject({ method: 'GET', url: '/api/me/parties', headers: { cookie: u1 } });
    const lineup = parties.json().find((p: { id: string }) => p.id === party.id).members;
    const bobMember = lineup.find((m: { snapshot: { ign: string } }) => m.snapshot.ign === 'Bob');
    expect(bobMember).toMatchObject({ character: null, characterId: null, cpAtJoin: 5_000_000 });
    expect(await prisma.post.findUniqueOrThrow({ where: { id: lfp.id } })).toMatchObject({ status: 'closed', closedReason: 'character_deleted' });
    expect(await prisma.request.count({ where: { characterId: bob.id } })).toBe(0);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: join.id } })).status).toBe('declined');
    expect(await prisma.request.findUnique({ where: { id: invite.id } })).toBeNull();
    expect(events.events).toContainEqual({ type: 'post.closed', postId: lfp.id, reason: 'character_deleted' });
    expect(events.events).toContainEqual({ type: 'post.closed', postId: rec.id, reason: 'character_deleted' });
    expect(events.events).toContainEqual({ type: 'request.declined', requestId: join.id, auto: true, actorUserId: user2.id });
  });
});

describe('character deletion racing a close', () => {
  it('emits post.closed exactly once per post', async () => {
    for (let i = 0; i < 8; i++) {
      const c = await makeCharacter({ ownerId: posterUserId });
      const post = await makePost({ posterUserId, posterCharacterId: c.id });
      events.events.length = 0;
      await Promise.all([
        app.inject({ method: 'POST', url: `/api/posts/${post.id}/close`, headers: { cookie: posterCookie } }),
        del(`/api/characters/${c.id}`, posterCookie),
      ]);
      expect(events.events.filter((e) => e.type === 'post.closed' && e.postId === post.id)).toHaveLength(1);
    }
  });
});
