import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { WebhookHealthDTO } from '@pf/shared';
import { buildTestApp, loginAs, makeGuild, prisma, resetDb, type FakeWebhookSender } from './helpers.js';

const URL_ = 'https://discord.com/api/webhooks/123/secret-token';
let app: FastifyInstance;
let sender: FakeWebhookSender;
let admin: string;

beforeEach(async () => {
  await resetDb();
  ({ app, webhookSender: sender } = await buildTestApp());
  admin = await loginAs(app, 'admin-1', 'admin');
});
afterAll(async () => {
  await prisma.$disconnect();
});

const test = (id: string, c: string | null = admin) =>
  app.inject({ method: 'POST', url: `/api/admin/guilds/${id}/test-webhook`, headers: c ? { cookie: c } : {} });
const health = (c: string | null = admin) =>
  app.inject({ method: 'GET', url: '/api/admin/webhooks/health', headers: c ? { cookie: c } : {} });

describe('admin webhooks', () => {
  it('test-webhook ok → {ok:true}, sender called with test payload, delivery recorded sent', async () => {
    const g = await makeGuild({ webhookUrl: URL_ });
    const res = await test(g.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]!.url).toBe(URL_);
    expect(JSON.stringify(sender.calls[0]!.payload)).toContain(g.name);
    const d = await prisma.webhookDelivery.findFirstOrThrow({ where: { guildId: g.id } });
    expect(d).toMatchObject({ eventType: 'test', status: 'sent', attempts: 1 });
    expect(d.sentAt).not.toBeNull();
  });

  it('test-webhook 404 → {ok:false, error:"HTTP 404"} without the URL', async () => {
    const g = await makeGuild({ webhookUrl: URL_ });
    sender.queue({ ok: false, status: 404, error: 'HTTP 404' });
    const res = await test(g.id);
    expect(res.json()).toEqual({ ok: false, error: 'HTTP 404' });
    expect(res.body).not.toContain('discord.com/api/webhooks');
    const d = await prisma.webhookDelivery.findFirstOrThrow({ where: { guildId: g.id } });
    expect(d).toMatchObject({ status: 'failed', lastError: 'HTTP 404', attempts: 1 });
  });

  it('no webhook → 400 NO_WEBHOOK', async () => {
    const g = await makeGuild();
    const res = await test(g.id);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('NO_WEBHOOK');
    expect(sender.calls).toHaveLength(0);
  });

  it('non-admin → 403, visitor → 401', async () => {
    const g = await makeGuild({ webhookUrl: URL_ });
    const user = await loginAs(app, 'u-1', 'one');
    expect((await test(g.id, user)).statusCode).toBe(403);
    expect((await test(g.id, null)).statusCode).toBe(401);
    expect((await health(user)).statusCode).toBe(403);
    expect((await health(null)).statusCode).toBe(401);
  });

  it('health reports failures without leaking the webhook URL', async () => {
    const a = await makeGuild({ name: 'Alpha', webhookUrl: URL_ });
    const b = await makeGuild({ name: 'Beta' });
    sender.queue({ ok: false, status: 404, error: 'HTTP 404' });
    await test(a.id);
    await test(a.id);
    const old = new Date(Date.now() - 48 * 3_600_000);
    await prisma.webhookDelivery.create({
      data: { guildId: a.id, eventType: 'post.created', payload: {}, status: 'failed', attempts: 5, lastError: 'old', createdAt: old },
    });
    await prisma.webhookDelivery.create({ data: { guildId: a.id, eventType: 'post.created', payload: {} } });
    for (let i = 0; i < 12; i++) {
      await prisma.webhookDelivery.create({
        data: { guildId: b.id, eventType: 'post.created', payload: {}, status: 'failed', lastError: `e${i}`, createdAt: new Date(Date.now() - i * 1000) },
      });
    }
    const res = await health();
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain('discord.com/api/webhooks');
    const h = res.json() as WebhookHealthDTO[];
    expect(h.map((x) => x.guildName)).toEqual(['Alpha', 'Beta']);
    const [ha, hb] = h as [WebhookHealthDTO, WebhookHealthDTO];
    expect(ha).toMatchObject({ hasWebhook: true, pending: 1, failedLast24h: 1 });
    expect(ha.lastSentAt).not.toBeNull();
    expect(ha.recentFailures.map((f) => f.lastError)).toEqual(['HTTP 404', 'old']);
    expect(hb).toMatchObject({ hasWebhook: false, lastSentAt: null, pending: 0, failedLast24h: 12 });
    expect(hb.recentFailures).toHaveLength(10);
    expect(hb.recentFailures[0]!.lastError).toBe('e0');
  });
});
