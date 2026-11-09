import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { NotificationListDTO } from '@pf/shared';
import { buildTestApp, loginAs, makeUser, prisma, resetDb } from './helpers.js';

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

const get = (url: string, c: string | null = cookie) => app.inject({ method: 'GET', url, headers: c ? { cookie: c } : {} });
const markRead = (payload: unknown, c: string | null = cookie) =>
  app.inject({ method: 'POST', url: '/api/notifications/read', payload: payload as object, headers: c ? { cookie: c } : {} });

const t0 = Date.parse('2026-01-01T00:00:00Z');
function note(uid: string, i: number, over: Record<string, unknown> = {}) {
  return prisma.notification.create({
    data: { userId: uid, kind: 'invite', text: `n${i}`, link: `/posts/${i}`, createdAt: new Date(t0 + i * 1000), ...over },
  });
}

describe('GET /api/notifications', () => {
  it('lists only my notifications newest first with unreadCount', async () => {
    const other = await makeUser();
    await note(userId, 1);
    await note(userId, 2, { readAt: new Date() });
    await note(userId, 3);
    await note(other.id, 4);
    const body = (await get('/api/notifications')).json() as NotificationListDTO;
    expect(body.items.map((n) => n.text)).toEqual(['n3', 'n2', 'n1']);
    expect(body.items.map((n) => n.read)).toEqual([false, true, false]);
    expect(body.unreadCount).toBe(2);
    expect(body.items[0]).toEqual({
      id: expect.any(String), kind: 'invite', text: 'n3', link: '/posts/3',
      createdAt: new Date(t0 + 3000).toISOString(), read: false,
    });
  });

  it('limit honored; unreadCount still counts all unread', async () => {
    for (let i = 1; i <= 5; i++) await note(userId, i);
    const body = (await get('/api/notifications?limit=2')).json() as NotificationListDTO;
    expect(body.items.map((n) => n.text)).toEqual(['n5', 'n4']);
    expect(body.unreadCount).toBe(5);
    expect((await get('/api/notifications?limit=0')).statusCode).toBe(400);
    expect((await get('/api/notifications?limit=101')).statusCode).toBe(400);
  });

  it('visitor gets 401', async () => {
    expect((await get('/api/notifications', null)).statusCode).toBe(401);
    expect((await markRead({ all: true }, null)).statusCode).toBe(401);
  });
});

describe('POST /api/notifications/read', () => {
  it('ids marks those; all marks all; other user is unaffected', async () => {
    const other = await makeUser();
    const a = await note(userId, 1);
    const b = await note(userId, 2);
    const c = await note(userId, 3);
    const o = await note(other.id, 4);
    const unread = async () => (await prisma.notification.findMany({ where: { readAt: null }, orderBy: { text: 'asc' } })).map((n) => n.text);

    expect((await markRead({ ids: [a.id, o.id] })).statusCode).toBe(204);
    expect(await unread()).toEqual(['n2', 'n3', 'n4']);

    expect((await markRead({ all: true })).statusCode).toBe(204);
    expect(await unread()).toEqual(['n4']);
    expect(b.id).not.toBe(c.id);
  });

  it('does not change readAt of already-read notifications', async () => {
    const earlier = new Date('2026-02-02T00:00:00Z');
    const a = await note(userId, 1, { readAt: earlier });
    await markRead({ all: true });
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: a.id } })).readAt).toEqual(earlier);
  });

  it('requires exactly one of ids or all:true', async () => {
    for (const body of [{}, { ids: [] }, { all: false }, { ids: ['x'], all: true }, { ids: [1] }, { ids: Array(101).fill('x') }]) {
      const res = await markRead(body);
      expect(res.statusCode, JSON.stringify(body).slice(0, 40)).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION');
    }
  });
});
