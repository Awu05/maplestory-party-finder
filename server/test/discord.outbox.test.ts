import { beforeEach, describe, expect, it } from 'vitest';
import { FakeWebhookSender, makeGuild, makePost, prisma, resetDb } from './helpers.js';
import { WebhookWorker, enqueueDelivery } from '../src/discord/outbox.js';
import { HttpWebhookSender } from '../src/discord/sender.js';
import type { WebhookPayload } from '../src/discord/messages.js';

const URL_ = 'https://discord.com/api/webhooks/123/secret-token';
const payload: WebhookPayload = { content: 'hi', allowed_mentions: { parse: [] } };
const T0 = new Date('2026-01-01T00:00:00Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

let sender: FakeWebhookSender;
let clock: Date;
const worker = () => new WebhookWorker({ prisma, sender, now: () => clock });

async function setup(over: Parameters<typeof makeGuild>[0] = { webhookUrl: URL_, active: true }) {
  const guild = await makeGuild(over);
  await enqueueDelivery(prisma, guild.id, 'test', payload);
  const row = await prisma.webhookDelivery.findFirstOrThrow({ where: { guildId: guild.id } });
  await prisma.webhookDelivery.update({ where: { id: row.id }, data: { nextAttemptAt: T0 } });
  return { guild, id: row.id };
}
const get = (id: string) => prisma.webhookDelivery.findUniqueOrThrow({ where: { id } });

beforeEach(async () => {
  await resetDb();
  sender = new FakeWebhookSender();
  clock = T0;
});

it('sends to an existing thread and captures its channel ID', async () => {
  let url = '';
  const http = new HttpWebhookSender(async (input) => {
    url = String(input);
    return new Response(JSON.stringify({ channel_id: '123456789012345678' }), { status: 200 });
  });
  expect(await http.send(URL_, payload, { threadId: '123456789012345678' })).toEqual({ ok: true, channelId: '123456789012345678' });
  expect(new URL(url).searchParams.get('thread_id')).toBe('123456789012345678');
  expect(new URL(url).searchParams.get('wait')).toBe('true');
});

describe('WebhookWorker', () => {
  it.each(['closed', 'full', 'open'] as const)('sends closure notices only while recruitment is closed (%s)', async (status) => {
    const guild = await makeGuild({ webhookUrl: URL_ });
    const post = await makePost({ status, closedReason: status === 'closed' ? 'finalized' : status === 'full' ? 'full' : null });
    await prisma.post.update({ where: { id: post.id }, data: { notificationGuildId: guild.id } });
    await prisma.guildWorld.create({ data: { guildId: guild.id, worldId: post.worldId } });
    await enqueueDelivery(prisma, guild.id, 'post.closed', payload, post.id);
    await prisma.webhookDelivery.updateMany({ data: { nextAttemptAt: T0 } });
    const result = await worker().runOnce();
    expect(result.sent).toBe(status === 'open' ? 0 : 1);
    expect(sender.calls).toHaveLength(status === 'open' ? 0 : 1);
  });
  it('sends a pending delivery', async () => {
    const { id } = await setup();
    expect(await worker().runOnce()).toEqual({ sent: 1, retried: 0, failed: 0 });
    const row = await get(id);
    expect(row.status).toBe('sent');
    expect(row.sentAt).not.toBeNull();
    expect(sender.calls).toHaveLength(1);
    expect(sender.calls[0]!.url).toBe(URL_);
    expect(sender.calls[0]!.payload).toEqual(payload);
  });

  it('retries a 500 with backoff and does not resend after success', async () => {
    const { id } = await setup();
    sender.queue({ ok: false, status: 500, error: 'HTTP 500' });
    expect(await worker().runOnce()).toEqual({ sent: 0, retried: 1, failed: 0 });
    let row = await get(id);
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt).toEqual(at(30_000));
    clock = at(10_000);
    await worker().runOnce();
    expect(sender.calls).toHaveLength(1);
    clock = at(31_000);
    await worker().runOnce();
    expect(sender.calls).toHaveLength(2);
    row = await get(id);
    expect(row.status).toBe('sent');
    clock = at(10 * 3_600_000);
    await worker().runOnce();
    expect(sender.calls).toHaveLength(2);
  });

  it('429 reschedules by retryAfterMs and counts an attempt', async () => {
    const { id } = await setup();
    sender.queue({ ok: false, status: 429, retryAfterMs: 5000, error: 'HTTP 429' });
    expect(await worker().runOnce()).toEqual({ sent: 0, retried: 1, failed: 0 });
    const row = await get(id);
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe('HTTP 429');
    expect(row.nextAttemptAt).toEqual(at(5000));
  });

  it('5 consecutive 429s fail the delivery with HTTP 429', async () => {
    const { id } = await setup();
    for (let i = 0; i < 6; i++) sender.queue({ ok: false, status: 429, retryAfterMs: 2000, error: 'HTTP 429' });
    for (let i = 0; i < 5; i++) {
      await worker().runOnce();
      const row = await get(id);
      expect(row.attempts).toBe(i + 1);
      if (i < 4) {
        expect(row.status).toBe('pending');
        expect(row.nextAttemptAt).toEqual(new Date(clock.getTime() + 2000));
        clock = row.nextAttemptAt;
      }
    }
    const row = await get(id);
    expect(row).toMatchObject({ status: 'failed', attempts: 5, lastError: 'HTTP 429' });
    clock = at(10 * 3_600_000);
    await worker().runOnce();
    expect(sender.calls).toHaveLength(5);
  });

  it('429 without retryAfterMs defaults to 5s', async () => {
    const { id } = await setup();
    sender.queue({ ok: false, status: 429, error: 'HTTP 429' });
    await worker().runOnce();
    expect((await get(id)).nextAttemptAt).toEqual(at(5000));
  });

  it('404 fails immediately without leaking the url', async () => {
    const { id } = await setup();
    sender.queue({ ok: false, status: 404, error: 'HTTP 404' });
    expect(await worker().runOnce()).toEqual({ sent: 0, retried: 0, failed: 1 });
    const row = await get(id);
    expect(row.status).toBe('failed');
    expect(row.lastError).toBe('HTTP 404');
    expect(row.attempts).toBe(1);
    expect(row.lastError).not.toContain('discord.com/api/webhooks');
  });

  it('5 consecutive 500s fail the delivery', async () => {
    const { id } = await setup();
    for (let i = 0; i < 5; i++) sender.queue({ ok: false, status: 500, error: 'HTTP 500' });
    const backoff = [30_000, 120_000, 600_000, 3_600_000];
    for (let i = 0; i < 5; i++) {
      await worker().runOnce();
      const row = await get(id);
      expect(row.attempts).toBe(i + 1);
      if (i < 4) {
        expect(row.status).toBe('pending');
        expect(row.nextAttemptAt).toEqual(new Date(clock.getTime() + backoff[i]!));
        clock = row.nextAttemptAt;
      }
    }
    expect((await get(id)).status).toBe('failed');
    expect(sender.calls).toHaveLength(5);
  });

  it('fails without sending when the webhook was removed or deactivated', async () => {
    const a = await setup({ webhookUrl: null, active: true });
    const b = await setup({ webhookUrl: URL_, active: false });
    expect(await worker().runOnce()).toEqual({ sent: 0, retried: 0, failed: 2 });
    for (const { id } of [a, b]) {
      const row = await get(id);
      expect(row.status).toBe('failed');
      expect(row.lastError).toBe('Webhook not configured');
      expect(row.attempts).toBe(1);
    }
    expect(sender.calls).toHaveLength(0);
  });

  it('leases claimed rows so a second worker does not resend while the first is sending', async () => {
    const { id } = await setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = new FakeWebhookSender();
    const orig = slow.send.bind(slow);
    slow.send = async (u, p) => {
      await gate;
      return orig(u, p);
    };
    const p1 = new WebhookWorker({ prisma, sender: slow, now: () => clock }).runOnce();
    await new Promise((r) => setTimeout(r, 300));
    expect(await worker().runOnce()).toEqual({ sent: 0, retried: 0, failed: 0 });
    release();
    expect(await p1).toEqual({ sent: 1, retried: 0, failed: 0 });
    expect(slow.calls).toHaveLength(1);
    expect(sender.calls).toHaveLength(0);
    expect((await get(id)).status).toBe('sent');
  });
});

describe('WebhookWorker robustness', () => {
  it('stop() during a run waits only for the in-flight row; the rest stay pending', async () => {
    const ids = [(await setup()).id, (await setup()).id, (await setup()).id];
    const slow = new FakeWebhookSender();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const firstSend = new Promise<void>((r) => (started = r));
    const orig = slow.send.bind(slow);
    slow.send = async (u, p) => {
      started();
      await gate;
      return orig(u, p);
    };
    const w = new WebhookWorker({ prisma, sender: slow, now: () => clock, batchSize: 3 });
    w.start(10);
    await firstSend;
    const stopped = w.stop();
    release();
    await stopped;
    expect(slow.calls).toHaveLength(1);
    const rows = await Promise.all(ids.map(get));
    expect(rows.filter((r) => r.status === 'sent')).toHaveLength(1);
    expect(rows.filter((r) => r.status === 'pending')).toHaveLength(2);
  });

  it('sends post.created only while recruiting, skipping closed, finalized, and full parties', async () => {
    const guild = await makeGuild({ webhookUrl: URL_, active: true });
    // The worker's clock is T0; the posts' expiry is measured against it.
    const banned = await makePost({ status: 'closed', closedReason: 'banned' });
    const deleted = await makePost({ deletedAt: new Date() });
    const manual = await makePost({ status: 'closed', closedReason: 'manual' });
    const charDeleted = await makePost({ status: 'closed', closedReason: 'character_deleted' });
    const expired = await makePost({ expiresAt: at(-1000) });
    const live = await makePost();
    const full = await makePost({ status: 'full', closedReason: 'full' });
    const finalized = await makePost({ status: 'closed', closedReason: 'finalized' });
    const ids: string[] = [];
    for (const post of [banned, deleted, manual, charDeleted, expired, full, finalized, live]) {
      await prisma.post.update({ where: { id: post.id }, data: { notificationGuildId: guild.id } });
      await prisma.guildWorld.upsert({ where: { guildId_worldId: { guildId: guild.id, worldId: post.worldId } }, create: { guildId: guild.id, worldId: post.worldId }, update: {} });
      await enqueueDelivery(prisma, guild.id, 'post.created', payload, post.id);
      const row = await prisma.webhookDelivery.findFirstOrThrow({ where: { postId: post.id } });
      await prisma.webhookDelivery.update({ where: { id: row.id }, data: { nextAttemptAt: T0 } });
      ids.push(row.id);
    }
    expect(await worker().runOnce()).toEqual({ sent: 1, retried: 0, failed: 7 });
    expect(sender.calls).toHaveLength(1);
    for (const id of ids.slice(0, 7)) {
      const row = await get(id);
      expect(row.status).toBe('failed');
      expect(row.lastError).toBe('Post no longer available');
      expect(row.attempts).toBe(1);
    }
    expect((await get(ids[7]!)).status).toBe('sent');
  });

  it('stops sending past the lease deadline and leaves rows pending', async () => {
    const ids = [(await setup()).id, (await setup()).id, (await setup()).id];
    const slow = new FakeWebhookSender();
    const orig = slow.send.bind(slow);
    slow.send = async (u, p) => {
      clock = new Date(clock.getTime() + 30_000);
      return orig(u, p);
    };
    const w = new WebhookWorker({ prisma, sender: slow, now: () => clock, batchSize: 3 });
    expect(await w.runOnce()).toEqual({ sent: 2, retried: 0, failed: 0 });
    expect(slow.calls).toHaveLength(2);
    const rows = await Promise.all(ids.map(get));
    expect(rows.filter((r) => r.status === 'pending')).toHaveLength(1);
  });

  it('treats a throwing sender as a retryable failure and continues the batch', async () => {
    const a = await setup();
    const b = await setup();
    let n = 0;
    const s = new FakeWebhookSender();
    const orig = s.send.bind(s);
    s.send = async (u, p) => {
      if (n++ === 0) throw new TypeError(`boom ${URL_}`);
      return orig(u, p);
    };
    const res = await new WebhookWorker({ prisma, sender: s, now: () => clock }).runOnce();
    expect(res).toEqual({ sent: 1, retried: 1, failed: 0 });
    const rows = [await get(a.id), await get(b.id)];
    const thrown = rows.find((r) => r.attempts === 1)!;
    expect(thrown.status).toBe('pending');
    expect(thrown.lastError).toBe('TypeError');
    expect(thrown.nextAttemptAt).toEqual(at(30_000));
    expect(rows.filter((r) => r.status === 'sent')).toHaveLength(1);
  });

  it('clamps 429 retryAfterMs to at least 1s', async () => {
    const { id } = await setup();
    sender.queue({ ok: false, status: 429, retryAfterMs: 5, error: 'HTTP 429' });
    await worker().runOnce();
    expect((await get(id)).nextAttemptAt).toEqual(at(1000));
  });

  it('logs a sanitized error when a run throws', async () => {
    const logged: { obj: object; msg: string }[] = [];
    const bad = { $transaction: async () => { throw new Error(`db down ${URL_}`); } } as unknown as typeof prisma;
    const w = new WebhookWorker({ prisma: bad, sender, log: { error: (obj, msg) => logged.push({ obj, msg }) } });
    w.start(10);
    await new Promise((r) => setTimeout(r, 100));
    await w.stop();
    expect(logged.length).toBeGreaterThan(0);
    expect(logged[0]).toEqual({ obj: { errName: 'Error' }, msg: 'webhook worker run failed' });
    expect(JSON.stringify(logged)).not.toContain('webhooks');
  });
});

describe('HttpWebhookSender', () => {
  it('reports the error class name without the url', async () => {
    const fetchStub = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const res = await new HttpWebhookSender(fetchStub).send(URL_, payload);
    expect(res).toEqual({ ok: false, status: null, error: 'TypeError' });
    expect(JSON.stringify(res)).not.toContain('webhooks');
  });

  it('posts with wait=true and parses retry_after on 429', async () => {
    let seen = '';
    const fetchStub = (async (u: string) => {
      seen = u;
      return new Response(JSON.stringify({ retry_after: 1.5 }), { status: 429 });
    }) as unknown as typeof fetch;
    const res = await new HttpWebhookSender(fetchStub).send(URL_, payload);
    expect(seen).toBe(`${URL_}?wait=true`);
    expect(res).toEqual({ ok: false, status: 429, retryAfterMs: 1500, error: 'HTTP 429' });
  });
});

it('reports the Discord error code of a 404', async () => {
  const http = new HttpWebhookSender(async () => new Response(JSON.stringify({ message: 'Unknown Channel', code: 10003 }), { status: 404 }));
  expect(await http.send(URL_, payload, { threadId: '123456789012345678' })).toEqual({ ok: false, status: 404, error: 'HTTP 404', discordCode: 10003 });
});
