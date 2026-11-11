import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { SCHEDULED_GRACE_MS } from '@pf/shared';
import { addMember, buildTestApp, loginAs, makeBossDifficulty, makeCharacter, makePost, prisma, resetDb, type RecordingEvents } from './helpers.js';

let app: FastifyInstance;
let events: RecordingEvents;
let cookie: string;
let userId: string;
let lucid: number;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

beforeEach(async () => {
  await resetDb();
  ({ app, events } = await buildTestApp());
  cookie = await loginAs(app, 'poster-1', 'poster');
  userId = (await prisma.user.findUniqueOrThrow({ where: { discordId: 'poster-1' } })).id;
  lucid = (await makeBossDifficulty({ partyCap: 6 })).id;
});
afterAll(async () => {
  await prisma.$disconnect();
});

const finalize = (id: string, scheduledAt: string, c: string | null = cookie) =>
  app.inject({ method: 'PUT', url: `/api/posts/${id}/final-time`, payload: { scheduledAt }, headers: c ? { cookie: c } : {} });
const open = (over: Parameters<typeof makePost>[0] = {}) =>
  makePost({ posterUserId: userId, bossDifficultyIds: [lucid], scheduledAt: null, ...over });
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

describe('PUT /api/posts/:id/final-time', () => {
  it('saves a weekly time zone and can turn recurrence off', async () => {
    const p = await open();
    const at = iso(2 * DAY);
    const res = await app.inject({ method: 'PUT', url: `/api/posts/${p.id}/final-time`, headers: { cookie }, payload: {
      scheduledAt: at, repeatWeekly: true, timeZone: 'America/New_York',
    } });
    expect(res.statusCode).toBe(200);
    expect(res.json().weeklyTimeZone).toBe('America/New_York');
    const once = await finalize(p.id, at);
    expect(once.json().weeklyTimeZone).toBeNull();
  });

  it('requires a valid time zone for weekly schedules', async () => {
    const p = await open();
    for (const timeZone of [undefined, 'Not/AZone']) {
      const res = await app.inject({ method: 'PUT', url: `/api/posts/${p.id}/final-time`, headers: { cookie }, payload: {
        scheduledAt: iso(DAY), repeatWeekly: true, timeZone,
      } });
      expect(res.statusCode).toBe(400);
    }
  });

  it('poster finalizes 2 days ahead: sets scheduledAt and expiresAt, emits post.finalized', async () => {
    const p = await open();
    const at = iso(2 * DAY);
    const res = await finalize(p.id, at);
    expect(res.statusCode).toBe(200);
    expect(res.json().scheduledAt).toBe(at);
    const row = await prisma.post.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.scheduledAt!.toISOString()).toBe(at);
    expect(row).toMatchObject({ status: 'closed', closedReason: 'finalized' });
    expect(res.json()).toMatchObject({ status: 'closed', recruitmentClosed: true });
    expect((await app.inject({ method: 'GET', url: '/api/posts' })).json().map((post: { id: string }) => post.id)).not.toContain(p.id);
    expect((await app.inject({ method: 'GET', url: `/api/posts/${p.id}`, headers: { cookie } })).statusCode).toBe(200);
    expect(row.expiresAt.getTime()).toBe(Date.parse(at) + SCHEDULED_GRACE_MS);
    expect(events.events).toContainEqual({ type: 'post.finalized', postId: p.id, actorUserId: userId });
  });

  it('a second finalize updates both times and emits again', async () => {
    const p = await open();
    await finalize(p.id, iso(2 * DAY));
    const at2 = iso(3 * DAY);
    expect((await finalize(p.id, at2)).statusCode).toBe(200);
    const row = await prisma.post.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.scheduledAt!.toISOString()).toBe(at2);
    expect(row.expiresAt.getTime()).toBe(Date.parse(at2) + SCHEDULED_GRACE_MS);
    expect(events.events.filter((e) => e.type === 'post.finalized')).toHaveLength(2);
  });

  it.each([
    ['an empty body', {}],
    ['a null scheduledAt', { scheduledAt: null }],
    ['a non-ISO scheduledAt', { scheduledAt: 'tomorrow' }],
  ])('%s -> 400 VALIDATION, nothing changes', async (_n, payload) => {
    const p = await open();
    const res = await app.inject({ method: 'PUT', url: `/api/posts/${p.id}/final-time`, payload, headers: { cookie } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
    expect((await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).scheduledAt).toBeNull();
    expect(events.events).toEqual([]);
  });

  it('non-poster -> 403 NOT_OWNER', async () => {
    const p = await open();
    const other = await loginAs(app, 'other', 'other');
    const res = await finalize(p.id, iso(2 * DAY), other);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('NOT_OWNER');
  });

  it('LFP post -> 409 WRONG_POST_TYPE', async () => {
    const p = await open({ type: 'lfp', partySize: null });
    const res = await finalize(p.id, iso(2 * DAY));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('WRONG_POST_TYPE');
  });

  it.each([
    ['closed', { status: 'closed' as const, closedReason: 'manual' as const }],
    ['deleted', { deletedAt: new Date() }],
    ['expired', { expiresAt: new Date(Date.now() - HOUR) }],
  ])('%s post -> 409 POST_CLOSED', async (_n, over) => {
    const p = await open(over);
    const res = await finalize(p.id, iso(2 * DAY));
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('POST_CLOSED');
  });

  it.each([['10 minutes ago', -10 * 60_000], ['31 days ahead', 31 * DAY]])('%s -> 400 VALIDATION', async (_n, off) => {
    const p = await open();
    const res = await finalize(p.id, iso(off));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION');
  });

  it('finalizing a full post closes recruitment', async () => {
    const p = await open({ partySize: 2, status: 'full' });
    const c = await makeCharacter();
    await addMember(p.id, c.id);
    expect((await finalize(p.id, iso(2 * DAY))).statusCode).toBe(200);
    expect(await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: 'closed', closedReason: 'finalized' });
  });

  it('declines pending applicants and invites when recruitment closes', async () => {
    const p = await open();
    const applicant = await makeCharacter({ worldId: p.worldId, guildId: p.guildId });
    const request = await prisma.request.create({ data: { kind: 'join_request', postId: p.id, characterId: applicant.id, createdByUserId: applicant.ownerId } });
    expect((await finalize(p.id, iso(DAY))).statusCode).toBe(200);
    expect((await prisma.request.findUniqueOrThrow({ where: { id: request.id } })).status).toBe('declined');
    expect(events.events).toContainEqual({ type: 'request.declined', requestId: request.id, auto: true, actorUserId: userId });
  });

  it('allows the owner to end a finalized recurring party', async () => {
    const p = await open();
    await app.inject({ method: 'PUT', url: `/api/posts/${p.id}/final-time`, headers: { cookie }, payload: { scheduledAt: iso(DAY), repeatWeekly: true, timeZone: 'UTC' } });
    const response = await app.inject({ method: 'POST', url: `/api/posts/${p.id}/close`, headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: 'closed', closedReason: 'manual' });
  });

  it('allows a member to leave without reopening recruitment', async () => {
    const p = await open();
    const memberCookie = await loginAs(app, 'member-1', 'member');
    const user = await prisma.user.findUniqueOrThrow({ where: { discordId: 'member-1' } });
    const character = await makeCharacter({ ownerId: user.id, worldId: p.worldId, guildId: p.guildId });
    const member = await addMember(p.id, character.id);
    await finalize(p.id, iso(DAY));
    const result = await app.inject({ method: 'DELETE', url: `/api/posts/${p.id}/members/${member.id}`, headers: { cookie: memberCookie } });
    expect(result.statusCode).toBe(200);
    expect(await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ status: 'closed', closedReason: 'finalized' });
    expect((await app.inject({ method: 'GET', url: '/api/posts' })).json().map((post: { id: string }) => post.id)).not.toContain(p.id);
  });
});
