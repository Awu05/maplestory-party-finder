import { Prisma, type PrismaClient } from '@prisma/client';
import type { WebhookPayload } from './messages.js';
import type { WebhookSender } from './sender.js';

type Db = PrismaClient | Prisma.TransactionClient;

const BACKOFF = [30_000, 120_000, 600_000, 3_600_000];
const MAX_ATTEMPTS = 5;
const DEFAULT_RETRY_AFTER_MS = 5_000;
const LEASE_MS = 60_000;

export async function enqueueDelivery(db: Db, guildId: string, eventType: string, payload: WebhookPayload): Promise<void> {
  await db.webhookDelivery.create({ data: { guildId, eventType, payload: payload as unknown as Prisma.InputJsonValue } });
}

type Claimed = { id: string; payload: WebhookPayload; attempts: number; webhookUrl: string | null; active: boolean };

export class WebhookWorker {
  private readonly prisma: PrismaClient;
  private readonly sender: WebhookSender;
  private readonly now: () => Date;
  private readonly batchSize: number;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<unknown> | null = null;

  constructor(opts: { prisma: PrismaClient; sender: WebhookSender; now?: () => Date; batchSize?: number }) {
    this.prisma = opts.prisma;
    this.sender = opts.sender;
    this.now = opts.now ?? (() => new Date());
    this.batchSize = opts.batchSize ?? 10;
  }

  /**
   * Claims due rows in a short transaction (FOR UPDATE SKIP LOCKED), sends outside it so no row
   * locks are held during HTTP, then records each outcome with a guarded update. Inside the claim
   * transaction nextAttemptAt is bumped to now + 60s (a lease), so a concurrent worker won't pick
   * the same rows while we send; every outcome update overwrites nextAttemptAt (or ends pending).
   */
  async runOnce(): Promise<{ sent: number; retried: number; failed: number }> {
    const now = this.now();
    const claimed = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Claimed[]>`
        SELECT d.id, d.payload, d.attempts, g."webhookUrl", g.active
        FROM "WebhookDelivery" d
        JOIN "Guild" g ON g.id = d."guildId"
        WHERE d.status = 'pending' AND d."nextAttemptAt" <= ${now}
        ORDER BY d."nextAttemptAt"
        LIMIT ${this.batchSize}
        FOR UPDATE OF d SKIP LOCKED`;
      if (rows.length > 0) {
        await tx.$executeRaw`
          UPDATE "WebhookDelivery" SET "nextAttemptAt" = ${new Date(now.getTime() + LEASE_MS)}
          WHERE id IN (${Prisma.join(rows.map((r) => r.id))})`;
      }
      return rows;
    });

    const counts = { sent: 0, retried: 0, failed: 0 };
    for (const row of claimed) {
      const guard = { id: row.id, status: 'pending' as const };
      if (!row.webhookUrl || !row.active) {
        await this.prisma.webhookDelivery.updateMany({ where: guard, data: { status: 'failed', lastError: 'Webhook not configured' } });
        counts.failed++;
        continue;
      }
      const res = await this.sender.send(row.webhookUrl, row.payload);
      if (res.ok) {
        await this.prisma.webhookDelivery.updateMany({ where: guard, data: { status: 'sent', sentAt: this.now(), lastError: null } });
        counts.sent++;
      } else if (res.status === 404 || res.status === 401) {
        await this.prisma.webhookDelivery.updateMany({ where: guard, data: { status: 'failed', lastError: res.error } });
        counts.failed++;
      } else if (res.status === 429) {
        const wait = res.retryAfterMs ?? DEFAULT_RETRY_AFTER_MS;
        await this.prisma.webhookDelivery.updateMany({
          where: guard,
          data: { nextAttemptAt: new Date(this.now().getTime() + wait), lastError: res.error },
        });
        counts.retried++;
      } else {
        const attempts = row.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await this.prisma.webhookDelivery.updateMany({ where: guard, data: { status: 'failed', attempts, lastError: res.error } });
          counts.failed++;
        } else {
          await this.prisma.webhookDelivery.updateMany({
            where: guard,
            data: { attempts, nextAttemptAt: new Date(this.now().getTime() + BACKOFF[attempts - 1]!), lastError: res.error },
          });
          counts.retried++;
        }
      }
    }
    return counts;
  }

  start(intervalMs = 5000): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.inFlight) return;
      this.inFlight = this.runOnce()
        .catch(() => undefined)
        .finally(() => {
          this.inFlight = null;
        });
    }, intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.inFlight;
  }
}
