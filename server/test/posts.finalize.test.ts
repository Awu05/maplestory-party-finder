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
  it('poster finalizes 2 days ahead: sets scheduledAt and expiresAt, emits post.finalized', async () => {
    const p = await open();
    const at = iso(2 * DAY);
    const res = await finalize(p.id, at);
    expect(res.statusCode).toBe(200);
    expect(res.json().scheduledAt).toBe(at);
    const row = await prisma.post.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.scheduledAt!.toISOString()).toBe(at);
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

  it('a full post stays full', async () => {
    const p = await open({ partySize: 2, status: 'full' });
    const c = await makeCharacter();
    await addMember(p.id, c.id);
    expect((await finalize(p.id, iso(2 * DAY))).statusCode).toBe(200);
    expect((await prisma.post.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('full');
  });
});
