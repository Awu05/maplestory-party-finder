import type { WebhookPayload } from './messages.js';

export type SendResult = { ok: true; channelId?: string } | { ok: false; status: number | null; retryAfterMs?: number; error: string; discordCode?: number };

/** Discord's JSON error code for a channel (or thread) that no longer exists. */
export const UNKNOWN_CHANNEL = 10003;

export interface WebhookSender {
  send(webhookUrl: string, payload: WebhookPayload, opts?: { threadId?: string }): Promise<SendResult>;
}

export const SEND_TIMEOUT_MS = 8000;

export class HttpWebhookSender implements WebhookSender {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async send(webhookUrl: string, payload: WebhookPayload, opts?: { threadId?: string }): Promise<SendResult> {
    try {
      const url = new URL(webhookUrl);
      url.searchParams.set('wait', 'true');
      if (opts?.threadId) url.searchParams.set('thread_id', opts.threadId);
      const res = await this.fetchImpl(url.toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (res.ok) {
        const body = await res.json().catch(() => null) as { channel_id?: unknown } | null;
        return { ok: true, ...(typeof body?.channel_id === 'string' ? { channelId: body.channel_id } : {}) };
      }
      const result: SendResult = { ok: false, status: res.status, error: `HTTP ${res.status}` };
      if (res.status === 429 || res.status === 404) {
        const body = (await res.json().catch(() => null)) as { retry_after?: unknown; code?: unknown } | null;
        if (res.status === 429 && typeof body?.retry_after === 'number') result.retryAfterMs = Math.ceil(body.retry_after * 1000);
        // A 404 is either the webhook (10015) or the thread (10003); only the code tells them apart.
        if (typeof body?.code === 'number') result.discordCode = body.code;
      }
      return result;
    } catch (err) {
      // Only the class name: error messages from fetch can embed the webhook URL.
      return { ok: false, status: null, error: err instanceof Error ? err.constructor.name : 'Error' };
    }
  }
}
