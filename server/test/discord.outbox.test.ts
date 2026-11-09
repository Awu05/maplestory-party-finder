import { beforeEach, describe, expect, it } from 'vitest';
import { FakeWebhookSender, makeGuild, prisma, resetDb } from './helpers.js';
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

describe('WebhookWorker', () => {
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

  it('429 reschedules by retryAfterMs without counting an attempt', async () => {
    const { id } = await setup();
    sender.queue({ ok: false, status: 429, retryAfterMs: 5000, error: 'HTTP 429' });
    await worker().runOnce();
    const row = await get(id);
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(0);
    expect(row.nextAttemptAt).toEqual(at(5000));
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
