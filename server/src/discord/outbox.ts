import { Prisma, type PrismaClient } from '@prisma/client';
import { effectivePostStatus } from '@pf/shared';
import type { WebhookPayload } from './messages.js';
import { SEND_TIMEOUT_MS, type SendResult, type WebhookSender } from './sender.js';
import { errName, type Logger } from '../log.js';
import { weeklyRecipients } from './weeklyRecipients.js';

type Db = PrismaClient | Prisma.TransactionClient;

const BACKOFF = [30_000, 120_000, 600_000, 3_600_000];
const MAX_ATTEMPTS = 5;
const DEFAULT_RETRY_AFTER_MS = 5_000;
const LEASE_MARGIN_MS = 30_000;
const DEADLINE_MARGIN_MS = 10_000;
const MIN_RETRY_AFTER_MS = 1_000;
const MAX_RETRY_AFTER_MS = 3_600_000;
const MAX_WEEKLY_REMINDER_AGE_MS = 15 * 60_000;

export async function enqueueDelivery(db: Db, guildId: string, eventType: string, payload: WebhookPayload, postId?: string): Promise<void> {
  await db.webhookDelivery.create({
    data: { guildId, eventType, payload: payload as unknown as Prisma.InputJsonValue, ...(postId ? { postId } : {}) },
  });
}

type Claimed = { id: string; guildId: string; payload: WebhookPayload; attempts: number; eventType: string; postId: string | null; webhookUrl: string | null; partyForumWebhookUrl: string | null; active: boolean; createdAt: Date };

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
        SELECT d.id, d."guildId", d.payload, d.attempts, d."eventType", d."postId", d."createdAt", g."webhookUrl", g."partyForumWebhookUrl", g.active
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
    /**
     * Ends the delivery as failed. A failed forum thread (no webhook, inactive guild, rejected,
     * retries exhausted or the party ended) frees the post so its next finalize queues a new one.
     */
    const fail = async (attempts: number, lastError: string) => {
      const { count } = await upd({ status: 'failed', attempts, lastError });
      if (count > 0 && row.eventType === 'post.party_thread' && row.postId) {
        await this.prisma.post.updateMany({ where: { id: row.postId }, data: { forumThreadRequested: false } });
      }
      counts.failed++;
    };
    const targetWebhook = row.eventType === 'post.party_thread' ? row.partyForumWebhookUrl : row.webhookUrl;
    if (!targetWebhook || !row.active) {
      await fail(row.attempts + 1, 'Webhook not configured');
      return;
    }
    if (row.eventType === 'post.weekly_reminder' && this.now().getTime() - row.createdAt.getTime() > MAX_WEEKLY_REMINDER_AGE_MS) {
      await fail(row.attempts + 1, 'Weekly reminder is no longer current');
      return;
    }
    if ((row.eventType === 'post.created' || row.eventType === 'post.reopened' || row.eventType === 'post.announcement' || row.eventType === 'post.weekly_reminder' || row.eventType === 'post.party_thread') && row.postId) {
      // Announce only a post that is still live (open or full): not deleted, closed for any reason, or expired.
      // A manual announcement or a reopen announcement also needs it to still be recruiting (open, not full).
      const post = await this.prisma.post.findUnique({ where: { id: row.postId }, select: { status: true, closedReason: true, expiresAt: true, deletedAt: true, weeklyTimeZone: true, weeklyAnchorAt: true, scheduledAt: true } });
      const weekly = row.payload._weekly;
      const activeFinalized = (row.eventType === 'post.weekly_reminder' || row.eventType === 'post.party_thread') && post?.status === 'closed' && post.closedReason === 'finalized' && post.deletedAt === null && post.expiresAt > this.now();
      if (!post || (effectivePostStatus(post, this.now()) === 'closed' && !activeFinalized) || ((row.eventType === 'post.announcement' || row.eventType === 'post.reopened') && effectivePostStatus(post, this.now()) !== 'open') || (row.eventType === 'post.party_thread' && !activeFinalized) || (row.eventType === 'post.weekly_reminder' &&
        (!weekly || post.weeklyTimeZone !== weekly.timeZone || post.weeklyAnchorAt?.toISOString() !== weekly.anchorAt || post.scheduledAt?.toISOString() !== weekly.nextAt))) {
        await fail(row.attempts + 1, 'Post no longer available');
        return;
      }
    }
    let payload = row.payload;
    if (row.eventType === 'post.weekly_reminder' && row.postId) {
      const ids = (await weeklyRecipients(this.prisma, row.postId)).get(row.guildId) ?? [];
      if (!ids.length) {
        await upd({ status: 'failed', attempts: row.attempts + 1, lastError: 'No current recipients' });
        counts.failed++;
        return;
      }
      const { _weekly, ...message } = row.payload;
      payload = { ...message, content: (message.content ?? '').replace(/^(?:<@[^>]+>\s*)*/, `${ids.map((id) => `<@${id}>`).join(' ')} `), allowed_mentions: { parse: [], users: ids } };
    }
    let res: SendResult;
    try {
      res = await this.sender.send(targetWebhook, payload);
    } catch (err) {
      res = { ok: false, status: null, error: errName(err) };
    }
    if (res.ok) {
      await upd({ status: 'sent', sentAt: this.now(), lastError: null });
      counts.sent++;
    } else if (res.status === 404 || res.status === 401) {
      await fail(row.attempts + 1, res.error);
    } else {
      // A 429 counts as an attempt too (else a webhook that is always rate-limited retries forever),
      // but waits as long as Discord asked rather than the backoff.
      const attempts = row.attempts + 1;
      const wait =
        res.status === 429
          ? Math.min(Math.max(res.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS, MIN_RETRY_AFTER_MS), MAX_RETRY_AFTER_MS)
          : BACKOFF[attempts - 1]!;
      if (attempts >= MAX_ATTEMPTS) {
        await fail(attempts, res.error);
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
