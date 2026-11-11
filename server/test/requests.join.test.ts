import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Character, Post, World } from '@prisma/client';
import {
  addMember, buildTestApp, loginAs, makeCharacter, makePost, makeWorld, prisma, resetDb, type RecordingEvents,
} from './helpers.js';

let app: FastifyInstance;
let events: RecordingEvents;
let u1: string;
let u2: string;
let u1Id: string;
let u2Id: string;
let kronos: World;
let alice: Character;
let bob: Character;
let zed: Character;
let post: Post;

beforeEach(async () => {
  await resetDb();
  ({ app, events } = await buildTestApp());
  u1 = await loginAs(app, 'u-1', 'one');
  u2 = await loginAs(app, 'u-2', 'two');
  u1Id = (await prisma.user.findUniqueOrThrow({ where: { discordId: 'u-1' } })).id;
  u2Id = (await prisma.user.findUniqueOrThrow({ where: { discordId: 'u-2' } })).id;
  kronos = await makeWorld();
  const bera = await makeWorld({ nexonWorldId: 1, name: 'Bera' });
  alice = await makeCharacter({ ownerId: u1Id, worldId: kronos.id, ign: 'Alice' });
  bob = await makeCharacter({ ownerId: u2Id, worldId: kronos.id, ign: 'Bob', combatPower: 2_500_000n });
  zed = await makeCharacter({ ownerId: u2Id, worldId: bera.id, ign: 'Zed' });
  post = await makePost({ posterCharacterId: alice.id, partySize: 3 });
});
afterAll(async () => {
  await prisma.$disconnect();
});

const call = (url: string, cookie?: string, body?: unknown) =>
  app.inject({ method: 'POST', url, headers: cookie ? { cookie } : {}, ...(body === undefined ? {} : { payload: body as object }) });
const getPost = (id: string, cookie?: string) => app.inject({ method: 'GET', url: `/api/posts/${id}`, headers: cookie ? { cookie } : {} });
const requestJoin = (postId: string, characterId: string, cookie: string) => call(`/api/posts/${postId}/requests`, cookie, { characterId });
const expectError = (res: { statusCode: number; json: () => any }, status: number, code: string) => {
  expect(res.statusCode).toBe(status);
  expect(res.json().error.code).toBe(code);
};
/** A third user with a Kronos character and a pending request on `postId`. */
const otherApplicant = async (postId: string, discordId: string) => {
  const cookie = await loginAs(app, discordId, discordId);
  const userId = (await prisma.user.findUniqueOrThrow({ where: { discordId } })).id;
  const c = await makeCharacter({ ownerId: userId, worldId: kronos.id });
  const res = await requestJoin(postId, c.id, cookie);
  expect(res.statusCode).toBe(201);
  return { cookie, character: c, requestId: res.json().id as string };
};

describe('create join request', () => {
  it('u-2 requests with Bob -> 201 pending; event; poster sees it in incomingRequests', async () => {
    const res = await requestJoin(post.id, bob.id, u2);
    expect(res.statusCode).toBe(201);
    const dto = res.json();
    expect(dto).toMatchObject({ kind: 'join_request', status: 'pending', postId: post.id, lfpPostId: null, decidedAt: null });
    expect(dto.character).toMatchObject({ id: bob.id, ign: 'Bob' });
    expect(events.events).toContainEqual({ type: 'request.created', requestId: dto.id });

    const detail = (await getPost(post.id, u1)).json();
    expect(detail.incomingRequests).toHaveLength(1);
    expect(detail.incomingRequests[0].id).toBe(dto.id);
    expect(detail.incomingRequests[0].character).toMatchObject({ id: bob.id, ign: 'Bob' });
    expect(detail.sentInvites).toEqual([]);
    // Non-posters never see incoming requests.
    expect((await getPost(post.id, u2)).json().incomingRequests).toEqual([]);
    expect((await getPost(post.id)).json().incomingRequests).toEqual([]);
  });

  it('allows a guildless applicant to request to join', async () => {
    await prisma.character.update({ where: { id: bob.id }, data: { guildId: null } });
    expect((await requestJoin(post.id, bob.id, u2)).statusCode).toBe(201);
  });

  it('Zed (other world) -> 400 WRONG_WORLD', async () => {
    expectError(await requestJoin(post.id, zed.id, u2), 400, 'WRONG_WORLD');
  });

  it("u-2 using u-1's character -> 403 NOT_OWNER", async () => {
    const aliceAlt = await makeCharacter({ ownerId: u1Id, worldId: kronos.id });
    expectError(await requestJoin(post.id, aliceAlt.id, u2), 403, 'NOT_OWNER');
  });

  it("poster's own character -> 409 ALREADY_MEMBER", async () => {
    expectError(await requestJoin(post.id, alice.id, u1), 409, 'ALREADY_MEMBER');
  });

  it('second request with Bob -> 409 ALREADY_PENDING', async () => {
    expect((await requestJoin(post.id, bob.id, u2)).statusCode).toBe(201);
    expectError(await requestJoin(post.id, bob.id, u2), 409, 'ALREADY_PENDING');
    expect(await prisma.request.count()).toBe(1);
  });

  it('request on an lfp post -> 409 WRONG_POST_TYPE', async () => {
    const lfp = await makePost({ type: 'lfp', partySize: null, worldId: kronos.id });
    expectError(await requestJoin(lfp.id, bob.id, u2), 409, 'WRONG_POST_TYPE');
  });

  it('expired-but-stored-open post -> 409 POST_CLOSED', async () => {
    await prisma.post.update({ where: { id: post.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expectError(await requestJoin(post.id, bob.id, u2), 409, 'POST_CLOSED');
  });

  it('soft-deleted post -> 404 NOT_FOUND for a non-member', async () => {
    await prisma.post.update({ where: { id: post.id }, data: { deletedAt: new Date() } });
    expectError(await requestJoin(post.id, bob.id, u2), 404, 'NOT_FOUND');
  });

  it('unauthenticated -> 401; unknown post -> 404', async () => {
    expect((await requestJoin(post.id, bob.id, '')).statusCode).toBe(401);
    expectError(await requestJoin('nope', bob.id, u2), 404, 'NOT_FOUND');
  });
});

describe('accept', () => {
  it('poster accepts -> Bob in members with cpAtJoin; request accepted; event', async () => {
    const reqId = (await requestJoin(post.id, bob.id, u2)).json().id;
    events.clear();
    const res = await call(`/api/requests/${reqId}/accept`, u1);
    expect(res.statusCode).toBe(200);
    const detail = res.json();
    expect(detail.id).toBe(post.id);
    const member = detail.members.find((m: any) => m.characterId === bob.id);
    expect(member).toMatchObject({ role: 'member', cpAtJoin: 2_500_000, snapshot: { ign: 'Bob' } });
    expect(detail.incomingRequests).toEqual([]);
    expect(detail.status).toBe('open');
    const row = await prisma.request.findUniqueOrThrow({ where: { id: reqId } });
    expect(row.status).toBe('accepted');
    expect(row.decidedAt).not.toBeNull();
    expect(events.events).toEqual([{ type: 'request.accepted', requestId: reqId }]);
  });

  it('non-poster accept -> 403 NOT_ALLOWED', async () => {
    const reqId = (await requestJoin(post.id, bob.id, u2)).json().id;
    expectError(await call(`/api/requests/${reqId}/accept`, u2), 403, 'NOT_ALLOWED');
    expectError(await call('/api/requests/nope/accept', u1), 404, 'NOT_FOUND');
  });

  it('accepting a pending request after expiry -> 409 POST_CLOSED', async () => {
    const reqId = (await requestJoin(post.id, bob.id, u2)).json().id;
    await prisma.post.update({ where: { id: post.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expectError(await call(`/api/requests/${reqId}/accept`, u1), 409, 'POST_CLOSED');
    expect((await prisma.request.findUniqueOrThrow({ where: { id: reqId } })).status).toBe('pending');
  });

  it('accepting twice -> 409 NOT_PENDING', async () => {
    const reqId = (await requestJoin(post.id, bob.id, u2)).json().id;
    expect((await call(`/api/requests/${reqId}/accept`, u1)).statusCode).toBe(200);
    expectError(await call(`/api/requests/${reqId}/accept`, u1), 409, 'NOT_PENDING');
  });

  it('character already a member -> 409 ALREADY_MEMBER and the request is declined', async () => {
    const reqId = (await requestJoin(post.id, bob.id, u2)).json().id;
    // Bob joined some other way meanwhile (e.g. via an invite).
    await addMember(post.id, bob.id);
    expectError(await call(`/api/requests/${reqId}/accept`, u1), 409, 'ALREADY_MEMBER');
    expect((await prisma.request.findUniqueOrThrow({ where: { id: reqId } })).status).toBe('declined');
  });

  it('accept filling the party -> full, other pending auto-declined; then new request 409 POST_FULL', async () => {
    const first = (await requestJoin(post.id, bob.id, u2)).json().id;
    const second = await otherApplicant(post.id, 'u-3');
    expect((await call(`/api/requests/${first}/accept`, u1)).statusCode).toBe(200);
    const third = await otherApplicant(post.id, 'u-4');
    events.clear();

    const res = await call(`/api/requests/${second.requestId}/accept`, u1);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('full');
    expect(res.json().members).toHaveLength(3);
    const row = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
    expect(row).toMatchObject({ status: 'full', closedReason: 'full' });
    expect((await prisma.request.findUniqueOrThrow({ where: { id: third.requestId } })).status).toBe('declined');
    expect(events.events).toEqual([
      { type: 'request.accepted', requestId: second.requestId },
      { type: 'post.closed', postId: post.id, reason: 'full' },
      { type: 'request.declined', requestId: third.requestId, auto: true, actorUserId: u1Id },
    ]);

    const late = await loginAs(app, 'u-5', 'five');
    const lateId = (await prisma.user.findUniqueOrThrow({ where: { discordId: 'u-5' } })).id;
    const c = await makeCharacter({ ownerId: lateId, worldId: kronos.id });
    expectError(await requestJoin(post.id, c.id, late), 409, 'POST_FULL');
  });

  it('two accepts racing for the last slot: exactly one wins; party never overfills', async () => {
    const tight = await makePost({ posterCharacterId: alice.id, partySize: 2 });
    const a = (await requestJoin(tight.id, bob.id, u2)).json().id;
    const b = await otherApplicant(tight.id, 'u-3');

    const results = await Promise.all([call(`/api/requests/${a}/accept`, u1), call(`/api/requests/${b.requestId}/accept`, u1)]);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 409]);
    const loser = results.find((r) => r.statusCode === 409)!;
    expect(['POST_FULL', 'NOT_PENDING']).toContain(loser.json().error.code);
    expect(await prisma.postMember.count({ where: { postId: tight.id } })).toBe(2);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: tight.id } })).status).toBe('full');
  });
});

describe('decline and cancel', () => {
  it('decline -> declined; event; can re-request afterwards', async () => {
    const reqId = (await requestJoin(post.id, bob.id, u2)).json().id;
    expectError(await call(`/api/requests/${reqId}/decline`, u2), 403, 'NOT_ALLOWED');
    events.clear();
    const res = await call(`/api/requests/${reqId}/decline`, u1);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: reqId, status: 'declined' });
    expect(res.json().decidedAt).not.toBeNull();
    expect(events.events).toEqual([{ type: 'request.declined', requestId: reqId, auto: false, actorUserId: u1Id }]);
    expectError(await call(`/api/requests/${reqId}/decline`, u1), 409, 'NOT_PENDING');
    expect((await requestJoin(post.id, bob.id, u2)).statusCode).toBe(201);
  });

  it('applicant cancels; poster cancel of a join_request -> 403; cancel twice -> 409 NOT_PENDING', async () => {
    const reqId = (await requestJoin(post.id, bob.id, u2)).json().id;
    expectError(await call(`/api/requests/${reqId}/cancel`, u1), 403, 'NOT_ALLOWED');
    events.clear();
    const res = await call(`/api/requests/${reqId}/cancel`, u2);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: reqId, status: 'cancelled' });
    expect(events.events).toEqual([{ type: 'request.cancelled', requestId: reqId }]);
    expectError(await call(`/api/requests/${reqId}/cancel`, u2), 409, 'NOT_PENDING');
  });
});

describe('detail myPending', () => {
  it("shows u-2's pending request on detail for u-2 only", async () => {
    const reqId = (await requestJoin(post.id, bob.id, u2)).json().id;
    const mine = (await getPost(post.id, u2)).json();
    expect(mine.myPending.map((r: any) => r.id)).toEqual([reqId]);
    expect((await getPost(post.id, u1)).json().myPending).toEqual([]);
    expect((await getPost(post.id)).json().myPending).toEqual([]);
  });
});
