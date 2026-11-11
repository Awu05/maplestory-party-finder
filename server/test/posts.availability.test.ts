import { beforeEach, afterEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addMember, buildTestApp, loginAs, makeCharacter, makePost, prisma, resetDb } from './helpers.js';

let app: FastifyInstance;
let cookie: string;
let ownerCookie: string;
let postId: string;
let memberId: string;
beforeEach(async () => {
  await resetDb();
  ({ app } = await buildTestApp());
  ownerCookie = await loginAs(app, 'owner');
  cookie = await loginAs(app, 'member');
  const owner = await prisma.user.findUniqueOrThrow({ where: { discordId: 'owner' } });
  const member = await prisma.user.findUniqueOrThrow({ where: { discordId: 'member' } });
  const post = await makePost({ posterUserId: owner.id, freeTimes: [12, 13], freeTimesZone: 'UTC' });
  postId = post.id;
  memberId = (await addMember(post.id, (await makeCharacter({ ownerId: member.id })).id)).id;
});
afterEach(async () => { await app.close(); });
const save = (payload: unknown, auth = cookie, id = memberId) => app.inject({
  method: 'PUT', url: `/api/posts/${postId}/members/${id}/free-times`, headers: { cookie: auth }, payload: payload as object,
});

it('accepted members save their own zoned availability without replacing the poster’s times', async () => {
  const response = await save({ freeTimes: [68, 67, 68], freeTimesZone: 'America/New_York' });
  expect(response.statusCode).toBe(200);
  expect(response.json().members.find((m: { id: string }) => m.id === memberId)).toMatchObject({ freeTimes: [67, 68], freeTimesZone: 'America/New_York', isMine: true });
  expect(response.json()).toMatchObject({ freeTimes: [12, 13], freeTimesZone: 'UTC' });
  const reloaded = await app.inject({ url: `/api/posts/${postId}`, headers: { cookie: ownerCookie } });
  expect(reloaded.json().members.find((m: { id: string }) => m.id === memberId).freeTimes).toEqual([67, 68]);
  expect((await save({ freeTimes: [], freeTimesZone: null })).json().members.find((m: { id: string }) => m.id === memberId).freeTimes).toEqual([]);
});

it('only the owner of a current membership can edit it, including the poster’s own availability', async () => {
  expect((await save({ freeTimes: [1], freeTimesZone: 'UTC' }, ownerCookie)).statusCode).toBe(403);
  const poster = await prisma.postMember.findFirstOrThrow({ where: { postId, role: 'poster' } });
  const updated = await save({ freeTimes: [10], freeTimesZone: 'UTC' }, ownerCookie, poster.id);
  expect(updated.statusCode).toBe(200);
  expect(updated.json().freeTimes).toEqual([10]);
  const outsider = await loginAs(app, 'outsider');
  expect((await save({ freeTimes: [1], freeTimesZone: 'UTC' }, outsider)).statusCode).toBe(403);
  await prisma.postMember.delete({ where: { id: memberId } });
  expect((await save({ freeTimes: [1], freeTimesZone: 'UTC' })).statusCode).toBe(403);
});

it('validates slots, zones, authentication and closed parties', async () => {
  for (const payload of [
    { freeTimes: [-1], freeTimesZone: 'UTC' }, { freeTimes: [336], freeTimesZone: 'UTC' },
    { freeTimes: [1], freeTimesZone: null }, { freeTimes: [1], freeTimesZone: 'Not/AZone' },
  ]) expect((await save(payload)).statusCode).toBe(400);
  expect((await save({ freeTimes: [1], freeTimesZone: 'UTC' }, '')).statusCode).toBe(401);
  await prisma.post.update({ where: { id: postId }, data: { status: 'closed' } });
  expect((await save({ freeTimes: [1], freeTimesZone: 'UTC' })).statusCode).toBe(409);
});
