import { Prisma, type PrismaClient } from '@prisma/client';
import { effectivePostStatus } from '@pf/shared';
import type { WebhookPayload } from './messages.js';
import { SEND_TIMEOUT_MS, type SendResult, type WebhookSender } from './sender.js';

type Db = PrismaClient | Prisma.TransactionClient;

const BACKOFF = [30_000, 120_000, 600_000, 3_600_000];
const MAX_ATTEMPTS = 5;
const DEFAULT_RETRY_AFTER_MS = 5_000;
const LEASE_MARGIN_MS = 30_000;
const DEADLINE_MARGIN_MS = 10_000;
const MIN_RETRY_AFTER_MS = 1_000;
const MAX_RETRY_AFTER_MS = 3_600_000;

type Logger = { error(obj: object, msg: string): void };

export async function enqueueDelivery(db: Db, guildId: string, eventType: string, payload: WebhookPayload, postId?: string): Promise<void> {
  await db.webhookDelivery.create({
    data: { guildId, eventType, payload: payload as unknown as Prisma.InputJsonValue, ...(postId ? { postId } : {}) },
  });
}

const errName = (err: unknown): string => (err instanceof Error ? err.constructor.name : 'Error');

type Claimed = { id: string; payload: WebhookPayload; attempts: number; eventType: string; postId: string | null; webhookUrl: string | null; active: boolean };

export class WebhookWorker {
  private readonly prisma: PrismaClient;
  private readonly sender: WebhookSender;
  private readonly now: () => Date;
  private readonly batchSize: number;
  private readonly log?: Logger;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<unknown> | null = null;
  private stopping = false;

  constructor(opts: { prisma: PrismaClient; sender: WebhookSender; now?: () => Date; batchSize?: number; log?: Logger }) {
    this.log = opts.log;
    this.prisma = opts.prisma;
    this.sender = opts.sender;
    this.now = opts.now ?? (() => new Date());
    this.batchSize = opts.batchSize ?? 10;
  }

  /**
   * Claims due rows in a short transaction (FOR UPDATE SKIP LOCKED), sends outside it so no row
   * locks are held during HTTP, then records each outcome with a guarded update. Inside the claim
   * transaction nextAttemptAt is bumped to now + a lease of batchSize x send timeout + 30s (a lease), so a concurrent worker won't pick
   * the same rows while we send; every outcome update overwrites nextAttemptAt (or ends pending).
   */
  async runOnce(): Promise<{ sent: number; retried: number; failed: number }> {
    const now = this.now();
    const leaseMs = this.batchSize * SEND_TIMEOUT_MS + LEASE_MARGIN_MS;
    const deadline = now.getTime() + leaseMs - DEADLINE_MARGIN_MS;
    const claimed = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Claimed[]>`
        SELECT d.id, d.payload, d.attempts, d."eventType", d."postId", g."webhookUrl", g.active
        FROM "WebhookDelivery" d
        JOIN "Guild" g ON g.id = d."guildId"
        WHERE d.status = 'pending' AND d."nextAttemptAt" <= ${now}
        ORDER BY d."nextAttemptAt"
        LIMIT ${this.batchSize}
        FOR UPDATE OF d SKIP LOCKED`;
      if (rows.length > 0) {
        await tx.$executeRaw`
          UPDATE "WebhookDelivery" SET "nextAttemptAt" = ${new Date(now.getTime() + leaseMs)}
          WHERE id IN (${Prisma.join(rows.map((r) => r.id))})`;
      }
      return rows;
    });

    const counts = { sent: 0, retried: 0, failed: 0 };
    for (const row of claimed) {
      // Shutting down or past the lease deadline: leave the rest pending; their lease expiry makes them reclaimable.
      if (this.stopping || this.now().getTime() >= deadline) break;
      try {
        await this.process(row, counts);
      } catch (err) {
        this.log?.error({ errName: errName(err) }, 'webhook delivery update failed');
      }
    }
    return counts;
  }

  private async process(row: Claimed, counts: { sent: number; retried: number; failed: number }): Promise<void> {
    const guard = { id: row.id, status: 'pending' as const };
    const upd = (data: Prisma.WebhookDeliveryUncheckedUpdateManyInput) => this.prisma.webhookDelivery.updateMany({ where: guard, data });
    if (!row.webhookUrl || !row.active) {
      await upd({ status: 'failed', attempts: row.attempts + 1, lastError: 'Webhook not configured' });
      counts.failed++;
      return;
    }
    if (row.eventType === 'post.created' && row.postId) {
      // Announce only a post that is still live (open or full): not deleted, closed for any reason, or expired.
      const post = await this.prisma.post.findUnique({ where: { id: row.postId }, select: { status: true, expiresAt: true, deletedAt: true } });
      if (!post || effectivePostStatus(post, this.now()) === 'closed') {
        await upd({ status: 'failed', attempts: row.attempts + 1, lastError: 'Post no longer available' });
        counts.failed++;
        return;
      }
    }
    let res: SendResult;
    try {
      res = await this.sender.send(row.webhookUrl, row.payload);
    } catch (err) {
      res = { ok: false, status: null, error: errName(err) };
    }
    if (res.ok) {
      await upd({ status: 'sent', sentAt: this.now(), lastError: null });
      counts.sent++;
    } else if (res.status === 404 || res.status === 401) {
      await upd({ status: 'failed', attempts: row.attempts + 1, lastError: res.error });
      counts.failed++;
    } else {
      // A 429 counts as an attempt too (else a webhook that is always rate-limited retries forever),
      // but waits as long as Discord asked rather than the backoff.
      const attempts = row.attempts + 1;
      const wait =
        res.status === 429
          ? Math.min(Math.max(res.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS, MIN_RETRY_AFTER_MS), MAX_RETRY_AFTER_MS)
          : BACKOFF[attempts - 1]!;
      if (attempts >= MAX_ATTEMPTS) {
        await upd({ status: 'failed', attempts, lastError: res.error });
        counts.failed++;
      } else {
        await upd({ attempts, nextAttemptAt: new Date(this.now().getTime() + wait), lastError: res.error });
        counts.retried++;
      }
    }
  }

  start(intervalMs = 5000): void {
    if (this.timer) return;
    this.stopping = false;
    this.timer = setInterval(() => {
      if (this.inFlight) return;
      this.inFlight = this.runOnce()
        .catch((err) => this.log?.error({ errName: errName(err) }, 'webhook worker run failed'))
        .finally(() => {
          this.inFlight = null;
        });
    }, intervalMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.inFlight;
  }
}
