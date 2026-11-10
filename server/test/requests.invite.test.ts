import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Character, Post } from '@prisma/client';
import { addMember, buildTestApp, loginAs, makeCharacter, makePost, makeWorld, prisma, resetDb, type RecordingEvents } from './helpers.js';

let app: FastifyInstance;
let events: RecordingEvents;
let u1: string;
let u2: string;
let u3: string;
let u2Id: string;
let u3Id: string;
let bob: Character;
let lfp: Post;
let postA: Post;
let postB: Post;
let beraPost: Post;

beforeEach(async () => {
  await resetDb();
  ({ app, events } = await buildTestApp());
  u1 = await loginAs(app, 'u-1', 'one');
  u2 = await loginAs(app, 'u-2', 'two');
  u3 = await loginAs(app, 'u-3', 'three');
  const id = async (d: string) => (await prisma.user.findUniqueOrThrow({ where: { discordId: d } })).id;
  u2Id = await id('u-2');
  u3Id = await id('u-3');
  const kronos = await makeWorld();
  const bera = await makeWorld({ nexonWorldId: 1, name: 'Bera' });
  const alice = await makeCharacter({ ownerId: await id('u-1'), worldId: kronos.id, ign: 'Alice' });
  bob = await makeCharacter({ ownerId: await id('u-2'), worldId: kronos.id, ign: 'Bob' });
  const carol = await makeCharacter({ ownerId: u3Id, worldId: kronos.id, ign: 'Carol' });
  const dana = await makeCharacter({ ownerId: await id('u-1'), worldId: bera.id, ign: 'Dana' });
  lfp = await makePost({ type: 'lfp', partySize: null, posterCharacterId: bob.id });
  postA = await makePost({ posterCharacterId: alice.id, partySize: 3 });
  postB = await makePost({ posterCharacterId: carol.id, partySize: 3 });
  beraPost = await makePost({ posterCharacterId: dana.id, partySize: 3 });
});
afterAll(async () => {
  await prisma.$disconnect();
});

const call = (url: string, cookie: string, body?: unknown) =>
  app.inject({ method: 'POST', url, headers: { cookie }, ...(body === undefined ? {} : { payload: body as object }) });
const invite = (lfpId: string, recruitingPostId: string, cookie: string) => call(`/api/posts/${lfpId}/invites`, cookie, { recruitingPostId });
const getPost = (id: string, cookie: string) => app.inject({ method: 'GET', url: `/api/posts/${id}`, headers: { cookie } });
const expectError = (res: { statusCode: number; json: () => any }, status: number, code: string) => {
  expect(res.statusCode).toBe(status);
  expect(res.json().error.code).toBe(code);
};

describe('create invite', () => {
  it('u-1 invites from A -> 201 invite; detail(A).sentInvites has Bob', async () => {
    const res = await invite(lfp.id, postA.id, u1);
    expect(res.statusCode).toBe(201);
    const dto = res.json();
    expect(dto).toMatchObject({ kind: 'invite', status: 'pending', postId: postA.id, lfpPostId: lfp.id });
    expect(dto.character.ign).toBe('Bob');
    expect(events.events).toContainEqual({ type: 'request.created', requestId: dto.id });
    const detail = (await getPost(postA.id, u1)).json();
    expect(detail.sentInvites.map((r: any) => r.character.ign)).toEqual(['Bob']);
  });

  it('guildless poster character -> 400 NO_GUILD', async () => {
    await prisma.character.update({ where: { id: bob.id }, data: { guildId: null } });
    const res = await invite(lfp.id, postA.id, u1);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('NO_GUILD');
  });

  it("someone else's recruiting post -> 403 NOT_OWNER", async () => {
    expectError(await invite(lfp.id, postB.id, u1), 403, 'NOT_OWNER');
  });

  it('Bera recruiting post -> 400 WRONG_WORLD', async () => {
    expectError(await invite(lfp.id, beraPost.id, u1), 400, 'WRONG_WORLD');
  });

  it('target that is a recruiting post -> 409 WRONG_POST_TYPE', async () => {
    expectError(await invite(postB.id, postA.id, u1), 409, 'WRONG_POST_TYPE');
  });

  it('swapped post ids racing a real invite never deadlock', async () => {
    for (let i = 0; i < 5; i++) {
      const lfpPost = await makePost({ type: 'lfp', partySize: null, posterCharacterId: bob.id });
      const rec = await makePost({ posterCharacterId: postA.posterCharacterId!, partySize: 3 });
      const [ok, swapped] = await Promise.all([invite(lfpPost.id, rec.id, u1), invite(rec.id, lfpPost.id, u1)]);
      expect(ok.statusCode).toBe(201);
      expectError(swapped, 409, 'WRONG_POST_TYPE');
    }
  });

  it('duplicate invite -> 409 ALREADY_PENDING', async () => {
    expect((await invite(lfp.id, postA.id, u1)).statusCode).toBe(201);
    expectError(await invite(lfp.id, postA.id, u1), 409, 'ALREADY_PENDING');
  });

  it('closed LFP post -> 409 POST_CLOSED', async () => {
    await prisma.post.update({ where: { id: lfp.id }, data: { status: 'closed', closedReason: 'manual' } });
    expectError(await invite(lfp.id, postA.id, u1), 409, 'POST_CLOSED');
  });
});

describe('invite decisions', () => {
  it('inviter cancels -> cancelled; invitee cannot cancel', async () => {
    const id = (await invite(lfp.id, postA.id, u1)).json().id;
    expectError(await call(`/api/requests/${id}/cancel`, u2), 403, 'NOT_ALLOWED');
    const res = await call(`/api/requests/${id}/cancel`, u1);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('cancelled');
  });

  it('invitee declines -> declined', async () => {
    const id = (await invite(lfp.id, postA.id, u1)).json().id;
    const res = await call(`/api/requests/${id}/decline`, u2);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('declined');
  });

  it('inviter and other users cannot accept -> 403 NOT_ALLOWED', async () => {
    const id = (await invite(lfp.id, postA.id, u1)).json().id;
    expectError(await call(`/api/requests/${id}/accept`, u1), 403, 'NOT_ALLOWED');
    expectError(await call(`/api/requests/${id}/accept`, u3), 403, 'NOT_ALLOWED');
  });

  it('invitee accepts -> Bob in A, LFP closed lfp_matched, B invite auto-declined, off the board', async () => {
    const inviteA = (await invite(lfp.id, postA.id, u1)).json().id;
    const inviteB = (await invite(lfp.id, postB.id, u3)).json().id;
    events.events.length = 0;
    const res = await call(`/api/requests/${inviteA}/accept`, u2);
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json().members)).toContain('Bob');
    const row = await prisma.post.findUniqueOrThrow({ where: { id: lfp.id } });
    expect(row).toMatchObject({ status: 'closed', closedReason: 'lfp_matched' });
    expect((await prisma.request.findUniqueOrThrow({ where: { id: inviteB } })).status).toBe('declined');
    expect(events.events).toContainEqual({ type: 'post.closed', postId: lfp.id, reason: 'lfp_matched' });
    expect(events.events).toContainEqual({ type: 'request.declined', requestId: inviteB, auto: true, actorUserId: u2Id });
    const board = await app.inject({ method: 'GET', url: '/api/posts?type=lfp', headers: { cookie: u2 } });
    expect(JSON.stringify(board.json())).not.toContain(lfp.id);
  });

  it('accept after the LFP post was closed -> 409 POST_CLOSED, invite stays pending', async () => {
    const id = (await invite(lfp.id, postA.id, u1)).json().id;
    await prisma.post.update({ where: { id: lfp.id }, data: { status: 'closed', closedReason: 'manual' } });
    events.events.length = 0;
    expectError(await call(`/api/requests/${id}/accept`, u2), 409, 'POST_CLOSED');
    expect((await prisma.request.findUniqueOrThrow({ where: { id } })).status).toBe('pending');
    expect((await prisma.post.findUniqueOrThrow({ where: { id: lfp.id } })).closedReason).toBe('manual');
    expect(await prisma.postMember.count({ where: { postId: postA.id } })).toBe(1);
    expect(events.events).toEqual([]);
  });

  it('accept after the LFP post expired -> 409 POST_CLOSED, invite stays pending, nobody joins', async () => {
    const id = (await invite(lfp.id, postA.id, u1)).json().id;
    await prisma.post.update({ where: { id: lfp.id }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    events.events.length = 0;
    expectError(await call(`/api/requests/${id}/accept`, u2), 409, 'POST_CLOSED');
    expect((await prisma.request.findUniqueOrThrow({ where: { id } })).status).toBe('pending');
    expect(await prisma.post.findUniqueOrThrow({ where: { id: lfp.id } })).toMatchObject({ status: 'open', closedReason: null });
    expect(await prisma.postMember.count({ where: { postId: postA.id } })).toBe(1);
    expect(events.events).toEqual([]);
  });

  it('accept after the LFP post was soft-deleted -> 409 POST_CLOSED', async () => {
    const id = (await invite(lfp.id, postA.id, u1)).json().id;
    await prisma.post.update({ where: { id: lfp.id }, data: { deletedAt: new Date() } });
    expectError(await call(`/api/requests/${id}/accept`, u2), 409, 'POST_CLOSED');
    expect((await prisma.request.findUniqueOrThrow({ where: { id } })).status).toBe('pending');
  });

  it('accept when status is open but members == partySize -> 409 POST_FULL', async () => {
    const id = (await invite(lfp.id, postA.id, u1)).json().id;
    const c2 = await makeCharacter({ ownerId: u3Id, worldId: postA.worldId });
    const c3 = await makeCharacter({ ownerId: u3Id, worldId: postA.worldId });
    await addMember(postA.id, c2.id);
    await addMember(postA.id, c3.id);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: postA.id } })).status).toBe('open');
    expectError(await call(`/api/requests/${id}/accept`, u2), 409, 'POST_FULL');
  });
});

describe('invite vs LFP-side auto-decline', () => {
  const terminalEvents = (requestId: string) =>
    events.events.filter(
      (e) => (e.type === 'request.declined' || e.type === 'request.cancelled' || e.type === 'request.accepted') && e.requestId === requestId,
    );

  it('an invite cancelled before the LFP post closes gets no request.declined on close', async () => {
    const id = (await invite(lfp.id, postA.id, u1)).json().id;
    expect((await call(`/api/requests/${id}/cancel`, u1)).statusCode).toBe(200);
    expect((await call(`/api/posts/${lfp.id}/close`, u2)).statusCode).toBe(200);
    expect(terminalEvents(id)).toEqual([{ type: 'request.cancelled', requestId: id }]);
    expect((await prisma.request.findUniqueOrThrow({ where: { id } })).status).toBe('cancelled');
  });

  it('cancel racing the LFP close: exactly one terminal event, matching the final status', async () => {
    for (let i = 0; i < 8; i++) {
      const lfpPost = await makePost({ type: 'lfp', partySize: null, posterCharacterId: bob.id });
      const id = (await invite(lfpPost.id, postA.id, u1)).json().id;
      events.events.length = 0;
      const [cancelRes, closeRes] = await Promise.all([
        call(`/api/requests/${id}/cancel`, u1),
        call(`/api/posts/${lfpPost.id}/close`, u2),
      ]);
      expect(closeRes.statusCode).toBe(200);
      const status = (await prisma.request.findUniqueOrThrow({ where: { id } })).status;
      const terminal = terminalEvents(id);
      expect(terminal).toHaveLength(1);
      if (cancelRes.statusCode === 200) {
        expect(status).toBe('cancelled');
        expect(terminal[0]).toEqual({ type: 'request.cancelled', requestId: id });
      } else {
        expect(cancelRes.json().error.code).toBe('NOT_PENDING');
        expect(status).toBe('declined');
        expect(terminal[0]).toEqual({ type: 'request.declined', requestId: id, auto: true, actorUserId: u2Id });
      }
    }
  });
});

describe('LFP post detail invites', () => {
  it('invitee sees receivedInvites with the recruiting post; each recruiter sees only their own sent invite', async () => {
    await prisma.guild.updateMany({ data: { webhookUrl: 'https://discord.com/api/webhooks/1/secret' } });
    const inviteA = (await invite(lfp.id, postA.id, u1)).json().id;
    const inviteB = (await invite(lfp.id, postB.id, u3)).json().id;

    const asInvitee = await getPost(lfp.id, u2);
    expect(asInvitee.body).not.toContain('webhook');
    const dto = asInvitee.json();
    expect(dto.receivedInvites.map((r: any) => r.id).sort()).toEqual([inviteA, inviteB].sort());
    expect(dto.receivedInvites.find((r: any) => r.id === inviteA).post).toMatchObject({ id: postA.id, type: 'recruiting' });
    expect(dto.sentInvitesToThis).toEqual([]);

    const asRecruiter = (await getPost(lfp.id, u1)).json();
    expect(asRecruiter.receivedInvites).toEqual([]);
    expect(asRecruiter.sentInvitesToThis.map((r: any) => r.id)).toEqual([inviteA]);
    expect(asRecruiter.sentInvitesToThis[0].post.id).toBe(postA.id);

    const asVisitor = (await getPost(lfp.id, '')).json();
    expect(asVisitor.receivedInvites).toEqual([]);
    expect(asVisitor.sentInvitesToThis).toEqual([]);
  });

  it('leaves out decided invites and invites from ended recruiting posts', async () => {
    const inviteA = (await invite(lfp.id, postA.id, u1)).json().id;
    (await invite(lfp.id, postB.id, u3)).json();
    await prisma.post.update({ where: { id: postB.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await getPost(lfp.id, u2)).json().receivedInvites.map((r: any) => r.id)).toEqual([inviteA]);
    await call(`/api/requests/${inviteA}/decline`, u2);
    expect((await getPost(lfp.id, u2)).json().receivedInvites).toEqual([]);
  });
});
