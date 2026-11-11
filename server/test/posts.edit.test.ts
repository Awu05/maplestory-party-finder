import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { FLEXIBLE_TTL_MS } from '@pf/shared';
import { addMember, buildTestApp, loginAs, makeBossDifficulty, makeCharacter, makeGuild, makePost, makeWorld, prisma, resetDb, type RecordingEvents } from './helpers.js';

let app: FastifyInstance;
let events: RecordingEvents;
let cookie: string;
let userId: string;
const HOUR = 3_600_000;

beforeEach(async () => {
  await resetDb();
  ({ app, events } = await buildTestApp());
  cookie = await loginAs(app, 'poster-1', 'poster');
  userId = (await prisma.user.findUniqueOrThrow({ where: { discordId: 'poster-1' } })).id;
});
afterAll(async () => {
  await prisma.$disconnect();
});

const patch = (id: string, body: unknown, c: string | null = cookie) =>
  app.inject({ method: 'PATCH', url: `/api/posts/${id}`, payload: body as object, headers: { ...(c ? { cookie: c } : {}), 'x-availability-version': '2' } });
const pending = async (postId: string, over: Record<string, unknown> = {}) => {
  const c = await makeCharacter();
  return prisma.request.create({ data: { kind: 'join_request', postId, characterId: c.id, createdByUserId: c.ownerId, ...over } });
};
const reqStatus = async (id: string) => (await prisma.request.findUniqueOrThrow({ where: { id } })).status;

describe('PATCH /api/posts/:id', () => {
  it('does not overwrite half-hour slots from a stale browser tab', async () => {
    const p = await makePost({ posterUserId: userId, freeTimes: [136, 137], freeTimesZone: 'UTC' });
    const res = await app.inject({ method: 'PATCH', url: `/api/posts/${p.id}`, headers: { cookie }, payload: { freeTimes: [68], freeTimesZone: 'UTC' } });
    expect(res.statusCode).toBe(409);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).freeTimes).toEqual([136, 137]);
  });
  it('poster edits note, bosses, free times -> 200, post.updated', async () => {
    const b1 = await makeBossDifficulty({ partyCap: 6 });
    const b2 = await makeBossDifficulty({ partyCap: 6 });
    const p = await makePost({ posterUserId: userId, bossDifficultyIds: [b1.id], scheduledAt: null });
    const res = await patch(p.id, {
      note: 'new note', bossDifficultyIds: [b2.id], freeTimes: [100, 20, 100], freeTimesZone: 'America/New_York',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ note: 'new note', freeTimes: [20, 100], freeTimesZone: 'America/New_York' });
    const row = await prisma.post.findUniqueOrThrow({ where: { id: p.id }, include: { bosses: true } });
    expect(row).toMatchObject({ freeTimes: [20, 100], freeTimesZone: 'America/New_York' });
    expect(row.bosses.map((b) => b.bossDifficultyId)).toEqual([b2.id]);
    expect(events.events).toContainEqual({ type: 'post.updated', postId: p.id });
  });

  it.each([
    ['note', { note: 'changed' }],
    ['free times', { freeTimes: [68], freeTimesZone: 'America/New_York' }],
    ['note with a scheduledAt in the body', { note: 'x', scheduledAt: new Date(Date.now() + 48 * HOUR).toISOString() }],
    ['note with a null scheduledAt in the body', { note: 'x', scheduledAt: null }],
  ])('editing a finalized post (%s) leaves scheduledAt and expiresAt byte-equal', async (_n, body) => {
    const p = await makePost({ posterUserId: userId, scheduledAt: new Date(Date.now() + 24 * HOUR) });
    expect((await patch(p.id, body)).statusCode).toBe(200);
    const row = await prisma.post.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.scheduledAt!.toISOString()).toBe(p.scheduledAt!.toISOString());
    expect(row.expiresAt.toISOString()).toBe(p.expiresAt.toISOString());
  });

  it('a body with only scheduledAt has nothing to change -> 400 VALIDATION', async () => {
    const p = await makePost({ posterUserId: userId });
    const res = await patch(p.id, { scheduledAt: new Date(Date.now() + 48 * HOUR).toISOString() });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
    expect((await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).scheduledAt!.toISOString()).toBe(p.scheduledAt!.toISOString());
  });

  it('free times: clearing drops the zone; times alone reuse the stored zone; a missing zone -> 400', async () => {
    const p = await makePost({ posterUserId: userId, scheduledAt: null, freeTimes: [20], freeTimesZone: 'America/New_York' });
    expect((await patch(p.id, { freeTimes: [21] })).statusCode).toBe(200);
    expect(await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ freeTimes: [21], freeTimesZone: 'America/New_York' });
    expect((await patch(p.id, { freeTimesZone: 'europe/berlin' })).statusCode).toBe(200);
    expect(await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ freeTimes: [21], freeTimesZone: 'Europe/Berlin' });
    expect((await patch(p.id, { freeTimes: [] })).statusCode).toBe(200);
    expect(await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ freeTimes: [], freeTimesZone: null });
    // No zone stored or sent.
    const noZone = await patch(p.id, { freeTimes: [30] });
    expect(noZone.statusCode).toBe(400);
    expect(noZone.json().error.code).toBe('VALIDATION');
    for (const body of [
      { freeTimes: [30], freeTimesZone: null }, { freeTimes: [30], freeTimesZone: 'Mars/Base' }, { freeTimes: [30], freeTimesZone: '+05:30' }, { freeTimes: [336] },
    ]) {
      const res = await patch(p.id, body);
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION');
    }
    // Clearing the zone while times remain is refused.
    expect((await patch(p.id, { freeTimes: [30], freeTimesZone: 'America/New_York' })).statusCode).toBe(200);
    const clearZone = await patch(p.id, { freeTimesZone: null });
    expect(clearZone.statusCode).toBe(400);
    expect(clearZone.json().error.code).toBe('VALIDATION');
  });

  it('empty body -> 400 VALIDATION', async () => {
    const p = await makePost({ posterUserId: userId });
    const res = await patch(p.id, {});
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('non-poster -> 403 NOT_OWNER; visitor -> 401', async () => {
    const p = await makePost({ posterUserId: userId });
    const other = await loginAs(app, 'other-1', 'other');
    const res = await patch(p.id, { note: 'x' }, other);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_OWNER');
    expect((await patch(p.id, { note: 'x' }, null)).statusCode).toBe(401);
  });

  it('a scheduledAt in the body never finalizes an unfinalized post', async () => {
    const p = await makePost({ posterUserId: userId, scheduledAt: null });
    const when = new Date(Date.now() + 10 * HOUR);
    expect((await patch(p.id, { note: 'n', scheduledAt: when.toISOString() })).statusCode).toBe(200);
    const row = await prisma.post.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.scheduledAt).toBeNull();
    expect(row.expiresAt.toISOString()).toBe(p.expiresAt.toISOString());
  });

  it('bosses with a lower cap than partySize -> 400 VALIDATION', async () => {
    const limbo = await makeBossDifficulty({ partyCap: 3 });
    const p = await makePost({ posterUserId: userId, partySize: 4 });
    const res = await patch(p.id, { bossDifficultyIds: [limbo.id] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('partySize below member count -> 409 PARTY_TOO_SMALL', async () => {
    const p = await makePost({ posterUserId: userId, partySize: 4 });
    await addMember(p.id, (await makeCharacter()).id);
    await addMember(p.id, (await makeCharacter()).id);
    const res = await patch(p.id, { partySize: 2 });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PARTY_TOO_SMALL');
  });

  it('partySize equal to member count -> full, pending requests auto-declined', async () => {
    const p = await makePost({ posterUserId: userId, partySize: 4 });
    await addMember(p.id, (await makeCharacter()).id);
    const r = await pending(p.id);
    expect((await patch(p.id, { partySize: 2 })).statusCode).toBe(200);
    expect(await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: 'full', closedReason: 'full', partySize: 2 });
    expect(await reqStatus(r.id)).toBe('declined');
    expect(events.events).toContainEqual({ type: 'request.declined', requestId: r.id, auto: true, actorUserId: userId });
    expect(events.events).toContainEqual({ type: 'post.closed', postId: p.id, reason: 'full' });
  });

  it('an edit that leaves members == unchanged partySize also makes it full', async () => {
    const p = await makePost({ posterUserId: userId, partySize: 2 });
    await addMember(p.id, (await makeCharacter()).id);
    // stored open with members == partySize (inconsistent); any edit resolves it to full
    expect((await patch(p.id, { note: 'n' })).statusCode).toBe(200);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('full');
    expect(events.events.filter((e) => e.type === 'post.closed')).toEqual([{ type: 'post.closed', postId: p.id, reason: 'full' }]);
    events.clear();
    // Already full: a further edit is no new transition.
    expect((await patch(p.id, { note: 'm' })).statusCode).toBe(200);
    expect(events.events.some((e) => e.type === 'post.closed')).toBe(false);
  });

  it('raising partySize on a full post reopens it', async () => {
    const p = await makePost({ posterUserId: userId, partySize: 2, status: 'full', closedReason: 'full' });
    await addMember(p.id, (await makeCharacter()).id);
    expect((await patch(p.id, { partySize: 4 })).statusCode).toBe(200);
    expect(await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: 'open', closedReason: null });
    expect(events.events).toContainEqual({ type: 'post.reopened', postId: p.id });
    const board = await app.inject({ method: 'GET', url: '/api/posts' });
    expect(board.json().map((x: { id: string }) => x.id)).toContain(p.id);
  });

  it('type change with no members declines pending invites; -> lfp clears partySize/minCp', async () => {
    const p = await makePost({ posterUserId: userId, partySize: 4, minCp: 500n });
    const r = await pending(p.id);
    const lfp = await makePost();
    const inv = await pending(p.id, { kind: 'invite', lfpPostId: lfp.id });
    const res = await patch(p.id, { type: 'lfp' });
    expect(res.statusCode).toBe(200);
    expect(await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ type: 'lfp', partySize: null, minCp: null });
    expect(await reqStatus(r.id)).toBe('declined');
    expect(await reqStatus(inv.id)).toBe('declined');
    expect(events.events).toContainEqual({ type: 'request.declined', requestId: inv.id, auto: true, actorUserId: userId });
    // back to recruiting needs partySize; lfp rejects partySize
    expect((await patch(p.id, { type: 'recruiting' })).statusCode).toBe(400);
    expect((await patch(p.id, { partySize: 3 })).statusCode).toBe(400);
    expect((await patch(p.id, { type: 'recruiting', partySize: 3 })).statusCode).toBe(200);
  });

  it('a finalized recruiting post switched to LFP drops its final time and gets the flexible expiry', async () => {
    const p = await makePost({ posterUserId: userId, partySize: 4, minCp: 500n, scheduledAt: new Date(Date.now() + 24 * HOUR) });
    const before = Date.now();
    const res = await patch(p.id, { type: 'lfp' });
    const after = Date.now();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ type: 'lfp', scheduledAt: null });
    const row = await prisma.post.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.scheduledAt).toBeNull();
    expect(row.expiresAt.getTime()).toBeGreaterThanOrEqual(before + FLEXIBLE_TTL_MS);
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(after + FLEXIBLE_TTL_MS);
  });

  it('type change on an LFP post declines pending invites that answer it', async () => {
    const lfp = await makePost({ posterUserId: userId, type: 'lfp', partySize: null });
    const rec = await makePost();
    const inv = await prisma.request.create({
      data: { kind: 'invite', postId: rec.id, characterId: lfp.posterCharacterId!, lfpPostId: lfp.id, createdByUserId: rec.posterUserId },
    });
    expect((await patch(lfp.id, { type: 'recruiting', partySize: 3 })).statusCode).toBe(200);
    expect(await reqStatus(inv.id)).toBe('declined');
    expect(events.events).toContainEqual({ type: 'request.declined', requestId: inv.id, auto: true, actorUserId: userId });
  });

  it('character change on an LFP post (same world) declines invites for the old character', async () => {
    const lfp = await makePost({ posterUserId: userId, type: 'lfp', partySize: null });
    const rec = await makePost();
    const inv = await prisma.request.create({
      data: { kind: 'invite', postId: rec.id, characterId: lfp.posterCharacterId!, lfpPostId: lfp.id, createdByUserId: rec.posterUserId },
    });
    const other = await makeCharacter({ ownerId: userId, worldId: lfp.worldId, guildId: lfp.guildId });
    expect((await patch(lfp.id, { characterId: other.id })).statusCode).toBe(200);
    expect(await reqStatus(inv.id)).toBe('declined');
    expect(events.events).toContainEqual({ type: 'request.declined', requestId: inv.id, auto: true, actorUserId: userId });
  });

  it('the lfpPostId decline is scoped: invites answering other LFP posts, and decided invites, are untouched', async () => {
    for (const edit of ['type', 'character'] as const) {
      const lfp = await makePost({ posterUserId: userId, type: 'lfp', partySize: null });
      const otherLfp = await makePost({ type: 'lfp', partySize: null });
      const rec = await makePost();
      const invite = (lfpPost: typeof lfp, over: Record<string, unknown> = {}) =>
        prisma.request.create({
          data: {
            kind: 'invite', postId: rec.id, characterId: lfpPost.posterCharacterId!, lfpPostId: lfpPost.id, createdByUserId: rec.posterUserId, ...over,
          },
        });
      const mine = await invite(lfp);
      const bystander = await invite(otherLfp);
      const rec2 = await makePost();
      const accepted = await invite(lfp, { postId: rec2.id, status: 'accepted', decidedAt: new Date() });
      events.clear();
      const body =
        edit === 'type'
          ? { type: 'recruiting', partySize: 3 }
          : { characterId: (await makeCharacter({ ownerId: userId, worldId: lfp.worldId, guildId: lfp.guildId })).id };
      expect((await patch(lfp.id, body)).statusCode).toBe(200);
      expect(await reqStatus(mine.id)).toBe('declined');
      expect(await reqStatus(bystander.id)).toBe('pending');
      expect(await reqStatus(accepted.id)).toBe('accepted');
      expect(events.events.filter((e) => e.type === 'request.declined')).toEqual([
        { type: 'request.declined', requestId: mine.id, auto: true, actorUserId: userId },
      ]);
    }
  });

  it('character change on a recruiting post (same world) keeps its pending requests', async () => {
    const p = await makePost({ posterUserId: userId });
    const r = await pending(p.id);
    const other = await makeCharacter({ ownerId: userId, worldId: p.worldId, guildId: p.guildId });
    expect((await patch(p.id, { characterId: other.id })).statusCode).toBe(200);
    expect(await reqStatus(r.id)).toBe('pending');
  });

  it('type or character change with a member -> 409 HAS_MEMBERS', async () => {
    const p = await makePost({ posterUserId: userId });
    await addMember(p.id, (await makeCharacter()).id);
    const mine = await makeCharacter({ ownerId: userId });
    const a = await patch(p.id, { type: 'lfp' });
    expect(a.statusCode).toBe(409);
    expect(a.json().error.code).toBe('HAS_MEMBERS');
    expect((await patch(p.id, { characterId: mine.id })).json().error.code).toBe('HAS_MEMBERS');
  });

  it('character change to another world updates world, poster snapshot, declines pending', async () => {
    const p = await makePost({ posterUserId: userId });
    const r = await pending(p.id);
    const w2 = await makeWorld({ nexonWorldId: 46, name: 'Scania' });
    const g2 = await makeGuild({ worldIds: [w2.id] });
    const c2 = await makeCharacter({ ownerId: userId, worldId: w2.id, guildId: g2.id, ign: 'Newbie', combatPower: 2_000_000n });
    expect((await patch(p.id, { characterId: c2.id })).statusCode).toBe(200);
    const row = await prisma.post.findUniqueOrThrow({ where: { id: p.id }, include: { members: true } });
    expect(row).toMatchObject({ worldId: w2.id, guildId: g2.id, posterCharacterId: c2.id });
    expect(row.members).toHaveLength(1);
    expect(row.members[0]).toMatchObject({ characterId: c2.id, cpAtJoin: 2_000_000n });
    expect(row.members[0]!.snapshot).toMatchObject({ ign: 'Newbie', worldName: 'Scania', guildName: g2.name });
    expect(await reqStatus(r.id)).toBe('declined');
  });

  it("another user's character -> 403 NOT_OWNER", async () => {
    const p = await makePost({ posterUserId: userId });
    const theirs = await makeCharacter();
    const res = await patch(p.id, { characterId: theirs.id });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_OWNER');
  });

  it('manually closed -> 409 POST_CLOSED', async () => {
    const closed = await makePost({ posterUserId: userId, status: 'closed', closedReason: 'manual' });
    const res = await patch(closed.id, { note: 'x' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('POST_CLOSED');
  });

  it('a note-only edit on a 6-day-old flexible post leaves expiresAt unchanged', async () => {
    const createdAt = new Date(Date.now() - 6 * 24 * HOUR);
    const p = await makePost({ posterUserId: userId, scheduledAt: null, createdAt });
    expect((await patch(p.id, { note: 'still here' })).statusCode).toBe(200);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).expiresAt.getTime()).toBe(p.expiresAt.getTime());
  });

  it('a note-only edit on an expired flexible post -> 409 POST_CLOSED, unchanged', async () => {
    const createdAt = new Date(Date.now() - 8 * 24 * HOUR);
    const p = await makePost({ posterUserId: userId, scheduledAt: null, createdAt });
    expect(p.expiresAt.getTime()).toBeLessThan(Date.now());
    const res = await patch(p.id, { note: 'revive me' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('POST_CLOSED');
    const row = await prisma.post.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.expiresAt.getTime()).toBe(p.expiresAt.getTime());
    expect(row.note).toBe(p.note);
  });

  it('an expired finalized post cannot be edited back onto the board, even with a future scheduledAt -> 409 POST_CLOSED', async () => {
    const p = await makePost({ posterUserId: userId, scheduledAt: new Date(Date.now() - 10 * HOUR) });
    expect(p.expiresAt.getTime()).toBeLessThan(Date.now());
    const when = new Date(Date.now() + 2 * HOUR);
    const res = await patch(p.id, { scheduledAt: when.toISOString(), note: 'again' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('POST_CLOSED');
    const row = await prisma.post.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.scheduledAt!.toISOString()).toBe(p.scheduledAt!.toISOString());
    expect(row.expiresAt.toISOString()).toBe(p.expiresAt.toISOString());
    expect(row.note).toBe(p.note);
  });

  it('minCp null clears it', async () => {
    const p = await makePost({ posterUserId: userId, minCp: 500n });
    expect((await patch(p.id, { minCp: null })).statusCode).toBe(200);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).minCp).toBeNull();
    expect((await patch(p.id, { minCp: 900 })).statusCode).toBe(200);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).minCp).toBe(900n);
  });
});
