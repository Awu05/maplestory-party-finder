import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FLEXIBLE_TTL_MS } from '@pf/shared';
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

const call = (method: 'GET' | 'POST' | 'DELETE', url: string, cookie?: string) =>
  app.inject({ method, url, headers: cookie ? { cookie } : {} });
const pendingRequest = async (postId: string, over: Record<string, unknown> = {}) => {
  const c = await makeCharacter();
  return prisma.request.create({
    data: { kind: 'join_request', postId, characterId: c.id, createdByUserId: c.ownerId, ...over },
  });
};

describe('close', () => {
  it('closes, auto-declines pending requests and emits events', async () => {
    const p = await makePost({ posterUserId });
    const r = await pendingRequest(p.id);
    const res = await call('POST', `/api/posts/${p.id}/close`, posterCookie);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('closed');
    const row = await prisma.post.findUniqueOrThrow({ where: { id: p.id } });
    expect(row).toMatchObject({ status: 'closed', closedReason: 'manual' });
    const req = await prisma.request.findUniqueOrThrow({ where: { id: r.id } });
    expect(req.status).toBe('declined');
    expect(req.decidedAt).not.toBeNull();
    expect(events.events).toContainEqual({ type: 'request.declined', requestId: r.id, auto: true, actorUserId: posterUserId });
    expect(events.events).toContainEqual({ type: 'post.closed', postId: p.id, reason: 'manual' });
  });

  it('also declines pending invites that reference the post as LFP post', async () => {
    const lfp = await makePost({ posterUserId, type: 'lfp', partySize: null });
    const rec = await makePost();
    const inv = await pendingRequest(rec.id, { kind: 'invite', lfpPostId: lfp.id });
    await call('POST', `/api/posts/${lfp.id}/close`, posterCookie);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe('declined');
    expect(events.events).toContainEqual({ type: 'request.declined', requestId: inv.id, auto: true, actorUserId: posterUserId });
  });

  it('non-poster -> 403 NOT_OWNER; twice -> 409 POST_CLOSED', async () => {
    const p = await makePost({ posterUserId });
    const other = await loginAs(app, 'other-1', 'other');
    const forbidden = await call('POST', `/api/posts/${p.id}/close`, other);
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.json().error.code).toBe('NOT_OWNER');
    expect((await call('POST', `/api/posts/${p.id}/close`, posterCookie)).statusCode).toBe(200);
    const again = await call('POST', `/api/posts/${p.id}/close`, posterCookie);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('POST_CLOSED');
  });
});

describe('delete', () => {
  it('hard-deletes a post with only the poster', async () => {
    const p = await makePost({ posterUserId });
    await pendingRequest(p.id);
    const res = await call('DELETE', `/api/posts/${p.id}`, posterCookie);
    expect(res.statusCode).toBe(204);
    expect(await prisma.post.count({ where: { id: p.id } })).toBe(0);
    expect(await prisma.request.count()).toBe(0);
  });

  it('hard-delete keeps invites that referenced it as LFP post, declined', async () => {
    const lfp = await makePost({ posterUserId, type: 'lfp', partySize: null });
    const rec = await makePost();
    const inv = await pendingRequest(rec.id, { kind: 'invite', lfpPostId: lfp.id });
    expect((await call('DELETE', `/api/posts/${lfp.id}`, posterCookie)).statusCode).toBe(204);
    const row = await prisma.request.findUniqueOrThrow({ where: { id: inv.id } });
    expect(row).toMatchObject({ status: 'declined', lfpPostId: null });
    expect(events.events).toContainEqual({ type: 'request.declined', requestId: inv.id, auto: true, actorUserId: posterUserId });
  });

  it('soft-deletes a post with members: hidden from board, visible to members, 404 to strangers', async () => {
    const p = await makePost({ posterUserId });
    const member = await makeCharacter();
    await addMember(p.id, member.id);
    const r = await pendingRequest(p.id);
    const res = await call('DELETE', `/api/posts/${p.id}`, posterCookie);
    expect(res.statusCode).toBe(204);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).deletedAt).not.toBeNull();
    expect((await prisma.request.findUniqueOrThrow({ where: { id: r.id } })).status).toBe('declined');
    expect(events.events).toContainEqual({ type: 'post.closed', postId: p.id, reason: 'deleted' });
    expect(events.events).toContainEqual({ type: 'request.declined', requestId: r.id, auto: true, actorUserId: posterUserId });

    expect((await call('GET', '/api/posts')).json()).toHaveLength(0);

    const ownerOfMember = await prisma.user.findUniqueOrThrow({ where: { id: member.ownerId } });
    const memberCookie = await loginAs(app, ownerOfMember.discordId!, 'member');
    const detail = await call('GET', `/api/posts/${p.id}`, memberCookie);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().deleted).toBe(true);
    expect(detail.json().members).toHaveLength(2);

    const stranger = await loginAs(app, 'stranger-1', 'stranger');
    expect((await call('GET', `/api/posts/${p.id}`, stranger)).statusCode).toBe(404);
  });

  it('non-poster -> 403 NOT_OWNER', async () => {
    const p = await makePost({ posterUserId });
    const other = await loginAs(app, 'other-1', 'other');
    const res = await call('DELETE', `/api/posts/${p.id}`, other);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_OWNER');
  });
});

describe('renew', () => {
  it('extends a flexible post to now + 7d', async () => {
    const p = await makePost({ posterUserId, scheduledAt: null });
    const before = Date.now();
    const res = await call('POST', `/api/posts/${p.id}/renew`, posterCookie);
    expect(res.statusCode).toBe(200);
    const exp = new Date(res.json().expiresAt).getTime();
    expect(exp).toBeGreaterThanOrEqual(before + FLEXIBLE_TTL_MS);
    expect(exp).toBeLessThanOrEqual(Date.now() + FLEXIBLE_TTL_MS);
  });

  it('scheduled -> 409 NOT_FLEXIBLE; closed -> 409 POST_CLOSED', async () => {
    const sched = await makePost({ posterUserId });
    const r1 = await call('POST', `/api/posts/${sched.id}/renew`, posterCookie);
    expect(r1.statusCode).toBe(409);
    expect(r1.json().error.code).toBe('NOT_FLEXIBLE');
    const closed = await makePost({ posterUserId, scheduledAt: null, status: 'closed' });
    const r2 = await call('POST', `/api/posts/${closed.id}/renew`, posterCookie);
    expect(r2.statusCode).toBe(409);
    expect(r2.json().error.code).toBe('POST_CLOSED');
  });

  it('non-poster -> 403 NOT_OWNER', async () => {
    const p = await makePost({ posterUserId, scheduledAt: null });
    const other = await loginAs(app, 'other-1', 'other');
    expect((await call('POST', `/api/posts/${p.id}/renew`, other)).statusCode).toBe(403);
  });

  it('renewing an expired flexible post puts it back on the board', async () => {
    const p = await makePost({ posterUserId, scheduledAt: null, expiresAt: new Date(Date.now() - 1000) });
    expect((await call('GET', '/api/posts')).json()).toHaveLength(0);
    expect((await call('POST', `/api/posts/${p.id}/renew`, posterCookie)).statusCode).toBe(200);
    expect((await call('GET', '/api/posts')).json().map((x: { id: string }) => x.id)).toEqual([p.id]);
  });
});

describe('reopen', () => {
  it('reopens a finalized or past party, preserves members, and clears its old schedule and reminders', async () => {
    const p = await makePost({ posterUserId, status: 'closed', closedReason: 'finalized', scheduledAt: new Date(Date.now() - 86_400_000), expiresAt: new Date(Date.now() - 1000), weeklyTimeZone: 'UTC', weeklyAnchorAt: new Date(Date.now() - 86_400_000) });
    await addMember(p.id, (await makeCharacter({ worldId: p.worldId, guildId: p.guildId })).id);
    const pending = await pendingRequest(p.id);
    const before = Date.now();
    const response = await call('POST', `/api/posts/${p.id}/reopen`, posterCookie);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'open', memberCount: 2, scheduledAt: null, weeklyTimeZone: null });
    expect(new Date(response.json().expiresAt).getTime()).toBeGreaterThanOrEqual(before + FLEXIBLE_TTL_MS);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).weeklyAnchorAt).toBeNull();
    expect((await prisma.request.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe('declined');
    expect(events.events).toContainEqual({ type: 'post.reopened', postId: p.id });
    expect((await call('GET', '/api/posts')).json().map((post: { id: string }) => post.id)).toContain(p.id);
  });

  it('reopens full parties as full without putting them on the board', async () => {
    const p = await makePost({ posterUserId, status: 'closed', closedReason: 'manual', partySize: 2 });
    const member = await addMember(p.id, (await makeCharacter({ worldId: p.worldId, guildId: p.guildId })).id);
    const response = await call('POST', `/api/posts/${p.id}/reopen`, posterCookie);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'full', memberCount: 2, scheduledAt: null });
    expect((await call('GET', '/api/posts')).json()).toHaveLength(0);
    expect((await call('DELETE', `/api/posts/${p.id}/members/${member.id}`, posterCookie)).statusCode).toBe(200);
    expect((await call('GET', '/api/posts')).json().map((post: { id: string }) => post.id)).toContain(p.id);
  });

  it('rejects non-owners, deleted posts, and posts that are already open', async () => {
    const p = await makePost({ posterUserId, status: 'closed', closedReason: 'manual' });
    const other = await loginAs(app, 'other-1', 'other');
    expect((await call('POST', `/api/posts/${p.id}/reopen`, other)).statusCode).toBe(403);
    const deleted = await makePost({ posterUserId, deletedAt: new Date() });
    expect((await call('POST', `/api/posts/${deleted.id}/reopen`, posterCookie)).statusCode).toBe(404);
    const open = await makePost({ posterUserId, scheduledAt: null });
    expect((await call('POST', `/api/posts/${open.id}/reopen`, posterCookie)).statusCode).toBe(409);
  });

  it('refuses to reopen a manually closed LFP post while its character is in another live party', async () => {
    const lfp = await makePost({ posterUserId, type: 'lfp', partySize: null, scheduledAt: null, status: 'closed', closedReason: 'manual' });
    const party = await makePost({ scheduledAt: null });
    const membership = await addMember(party.id, lfp.posterCharacterId!);
    const response = await call('POST', `/api/posts/${lfp.id}/reopen`, posterCookie);
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toMatchObject({ code: 'IN_PARTY', message: 'Leave your current party before reopening this post.' });
    expect((await prisma.post.findUniqueOrThrow({ where: { id: lfp.id } })).status).toBe('closed');
    await prisma.postMember.delete({ where: { id: membership.id } });
    expect((await call('POST', `/api/posts/${lfp.id}/reopen`, posterCookie)).statusCode).toBe(200);
  });

  it('rejects a party whose posting character has been deleted', async () => {
    const p = await makePost({ posterUserId, status: 'closed', closedReason: 'manual' });
    await prisma.character.delete({ where: { id: p.posterCharacterId! } });
    const response = await call('POST', `/api/posts/${p.id}/reopen`, posterCookie);
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('CHARACTER_UNAVAILABLE');
  });
});

describe('admin', () => {
  it('hard-deletes even a soft-deleted party post; non-admin -> 403', async () => {
    const p = await makePost({ posterUserId, deletedAt: new Date() });
    await addMember(p.id, (await makeCharacter()).id);
    const nonAdmin = await loginAs(app, 'other-1', 'other');
    expect((await call('DELETE', `/api/admin/posts/${p.id}`, nonAdmin)).statusCode).toBe(403);
    const admin = await loginAs(app, 'admin-1', 'admin');
    expect((await call('GET', `/api/posts/${p.id}`, admin)).statusCode).toBe(200);
    expect((await call('DELETE', `/api/admin/posts/${p.id}`, admin)).statusCode).toBe(204);
    expect(await prisma.post.count()).toBe(0);
    expect(await prisma.postMember.count()).toBe(0);
  });
});

describe('canRenew', () => {
  it('poster of a flexible, unclosed post can renew, even once expired; not scheduled, closed, deleted or others', async () => {
    const other = await loginAs(app, 'other-1', 'other');
    const canRenew = async (over: Record<string, unknown>, cookie = posterCookie) => {
      const p = await makePost({ posterUserId, ...over });
      if (over.deletedAt) await addMember(p.id, (await makeCharacter()).id);
      return (await call('GET', `/api/posts/${p.id}`, cookie)).json().canRenew;
    };
    expect(await canRenew({ scheduledAt: null })).toBe(true);
    expect(await canRenew({ scheduledAt: null, expiresAt: new Date(Date.now() - 1000) })).toBe(true);
    expect(await canRenew({ scheduledAt: null, status: 'full', closedReason: 'full' })).toBe(true);
    expect(await canRenew({})).toBe(false);
    expect(await canRenew({ scheduledAt: null, status: 'closed', closedReason: 'manual' })).toBe(false);
    expect(await canRenew({ scheduledAt: null, deletedAt: new Date() })).toBe(false);
    expect(await canRenew({ scheduledAt: null }, other)).toBe(false);
  });
});
