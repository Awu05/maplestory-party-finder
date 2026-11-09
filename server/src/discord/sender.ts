import type { WebhookPayload } from './messages.js';

export type SendResult = { ok: true } | { ok: false; status: number | null; retryAfterMs?: number; error: string };

export interface WebhookSender {
  send(webhookUrl: string, payload: WebhookPayload): Promise<SendResult>;
}

const TIMEOUT_MS = 8000;

export class HttpWebhookSender implements WebhookSender {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async send(webhookUrl: string, payload: WebhookPayload): Promise<SendResult> {
    try {
      const res = await this.fetchImpl(`${webhookUrl}?wait=true`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return { ok: true };
      const result: SendResult = { ok: false, status: res.status, error: `HTTP ${res.status}` };
      if (res.status === 429) {
        const body = (await res.json().catch(() => null)) as { retry_after?: unknown } | null;
        if (typeof body?.retry_after === 'number') result.retryAfterMs = Math.ceil(body.retry_after * 1000);
      }
      return result;
    } catch (err) {
      // Only the class name: error messages from fetch can embed the webhook URL.
      return { ok: false, status: null, error: err instanceof Error ? err.constructor.name : 'Error' };
    }
  }
}
