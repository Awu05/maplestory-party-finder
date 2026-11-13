import type { PrismaClient } from '@prisma/client';
import { syncCharacterFromNexon } from '../characters/service.js';
import type { NexonClient } from '../nexon/client.js';
import { DAY_MS } from '@pf/shared';
import { errName, type Logger } from '../log.js';

const JOB_NAME = 'daily-sync';
const NOTIFICATION_RETENTION_MS = 60 * DAY_MS;
const DELIVERY_RETENTION_MS = 30 * DAY_MS;

export class DailySyncJob {
  private readonly prisma: PrismaClient;
  private readonly nexon: NexonClient;
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly throttleMs: number;
  private readonly log?: Logger;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<unknown> | null = null;
  private stopping = false;

  constructor(opts: {
    prisma: PrismaClient;
    nexon: NexonClient;
    now?: () => Date;
    sleep?: (ms: number) => Promise<void>;
    throttleMs?: number;
    log?: Logger;
  }) {
    this.prisma = opts.prisma;
    this.nexon = opts.nexon;
    this.now = opts.now ?? (() => new Date());
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.throttleMs = opts.throttleMs ?? 2000;
    this.log = opts.log;
  }

  /** Never throws. 'skipped' when the last run started within 24h. */
  async runIfDue(): Promise<'skipped' | { synced: number; stale: number }> {
    try {
      const now = this.now();
      const last = await this.prisma.jobRun.findUnique({ where: { name: JOB_NAME } });
      if (last && now.getTime() - last.lastRunAt.getTime() < DAY_MS) return 'skipped';
      // Claim the slot first so a crash mid-run doesn't cause a re-run storm.
      await this.prisma.jobRun.upsert({
        where: { name: JOB_NAME },
        create: { name: JOB_NAME, lastRunAt: now },
        update: { lastRunAt: now },
      });
      try {
        const result = await this.run(now);
        await this.prisma.jobRun.update({ where: { name: JOB_NAME }, data: { lastResult: result } });
        return result;
      } catch (err) {
        this.log?.error({ errName: errName(err) }, 'daily sync run failed');
        await this.prisma.jobRun.update({ where: { name: JOB_NAME }, data: { lastResult: { error: errName(err) } } });
        return { synced: 0, stale: 0 };
      }
    } catch (err) {
      this.log?.error({ errName: errName(err) }, 'daily sync check failed');
      return 'skipped';
    }
  }

  private async run(now: Date): Promise<{ synced: number; stale: number }> {
    const characters = await this.prisma.character.findMany({
      where: { source: 'nexon', owner: { banned: false, deletedAt: null } },
      orderBy: { lastSyncedAt: 'asc' },
      select: { id: true },
    });
    let synced = 0;
    let stale = 0;
    for (const [i, { id }] of characters.entries()) {
      if (this.stopping) break; // shutdown: record the partial result, the next run re-syncs oldest first
      try {
        if ((await syncCharacterFromNexon(this.prisma, this.nexon, id, { fresh: true })) === 'ok') synced++;
        else stale++;
      } catch (err) {
        stale++;
        this.log?.error({ characterId: id, errName: errName(err) }, 'daily sync of character failed');
      }
      if (i < characters.length - 1 && !this.stopping) await this.sleep(this.throttleMs);
    }
    if (this.stopping) return { synced, stale };
    await this.prisma.notification.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - NOTIFICATION_RETENTION_MS) } } });
    await this.prisma.webhookDelivery.deleteMany({
      where: { status: { in: ['sent', 'failed'] }, createdAt: { lt: new Date(now.getTime() - DELIVERY_RETENTION_MS) } },
    });
    return { synced, stale };
  }

  start(checkEveryMs = 3_600_000): void {
    if (this.timer) return;
    this.stopping = false;
    const tick = () => {
      if (this.inFlight) return;
      this.inFlight = this.runIfDue().finally(() => {
        this.inFlight = null;
      });
    };
    tick();
    this.timer = setInterval(tick, checkEveryMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.inFlight;
  }
}
