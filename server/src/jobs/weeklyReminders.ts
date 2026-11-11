import type { PrismaClient } from '@prisma/client';
import { postExpiresAt } from '@pf/shared';
import { buildWeeklyReminder, weeklyReminderPost } from '../discord/messages.js';
import { enqueueDelivery } from '../discord/outbox.js';
import { weeklyRecipients } from '../discord/weeklyRecipients.js';
import { postSummaryInclude, toPostSummaryDTO } from '../posts/serialize.js';
import type { Storage } from '../storage/storage.js';
import { errName, type Logger } from '../log.js';

const MAX_LATENESS_MS = 15 * 60_000;
const WEEK_MS = 7 * 86_400_000;
type Occurrence = { id: string; scheduledAt: Date; weeklyAnchorAt: Date; weeklyTimeZone: string };

/** Claims each occurrence and enqueues its reminders in the same transaction. */
export class WeeklyReminderJob {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<unknown> | null = null;
  private stopping = false;

  constructor(private readonly opts: { prisma: PrismaClient; storage: Storage; webOrigin: string; log?: Logger }) {}

  async runOnce(now = new Date()): Promise<number> {
    const { prisma, storage, webOrigin } = this.opts;
    let processed = 0;
    for (let attempt = 0; !this.stopping && attempt < 100; attempt++) {
      const claim: { occurrence: Occurrence | null } = { occurrence: null };
      let claimed: boolean;
      try {
        claimed = await prisma.$transaction(async (tx) => {
          const [due] = await tx.$queryRaw<Occurrence[]>`
            SELECT p.id, p."scheduledAt", p."weeklyAnchorAt", p."weeklyTimeZone" FROM "Post" p
            WHERE p."weeklyTimeZone" IS NOT NULL AND p."weeklyAnchorAt" IS NOT NULL
              AND p."scheduledAt" <= ${now} AND p.type = 'recruiting'
              AND (p.status IN ('open', 'full') OR (p.status = 'closed' AND p."closedReason" = 'finalized')) AND p."deletedAt" IS NULL
              AND EXISTS (SELECT 1 FROM "User" u WHERE u.id = p."posterUserId" AND NOT u.banned)
            ORDER BY p."scheduledAt", p.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED`;
          if (!due) return false;
          claim.occurrence = due;
          const row = await tx.post.findUniqueOrThrow({ where: { id: due.id }, include: postSummaryInclude });
          // Keep the original local-time anchor across DST transitions.
          const [next] = await tx.$queryRaw<{ nextAt: Date }[]>`
            WITH local_times AS (
              SELECT ("weeklyAnchorAt" AT TIME ZONE 'UTC') AT TIME ZONE "weeklyTimeZone" AS anchor,
                ${now}::timestamptz AT TIME ZONE "weeklyTimeZone" AS wall_now,
                "weeklyTimeZone" AS zone
              FROM "Post" WHERE id = ${row.id}
            )
            SELECT (anchor + INTERVAL '7 days' * GREATEST(1,
              FLOOR(EXTRACT(EPOCH FROM (wall_now - anchor)) / 604800)::int + 1))
              AT TIME ZONE zone AS "nextAt" FROM local_times`;
          if (!next || next.nextAt <= now) throw new Error('Invalid next weekly occurrence');

          if (now.getTime() - row.scheduledAt!.getTime() <= MAX_LATENESS_MS) {
            const recipients = await weeklyRecipients(tx, row.id);
            const post = weeklyReminderPost(toPostSummaryDTO(row, null, storage, now));
            // Recipients are checked again at delivery.
            for (const [guildId, ids] of recipients) {
              await enqueueDelivery(tx, guildId, 'post.weekly_reminder', {
                ...buildWeeklyReminder({ recipientDiscordIds: ids, post, webOrigin }),
                _weekly: { nextAt: next.nextAt.toISOString(), anchorAt: row.weeklyAnchorAt!.toISOString(), timeZone: row.weeklyTimeZone!, post, webOrigin },
              }, row.id);
            }
          }
          // Missed occurrences are skipped; a restart never sends a backlog of old reminders.
          await tx.post.update({ where: { id: row.id }, data: {
            scheduledAt: next.nextAt,
            expiresAt: postExpiresAt(next.nextAt, now),
          } });
          return true;
        });
      } catch (error) {
        if (claim.occurrence === null) throw error;
        // Skip a broken occurrence so other parties can still be processed.
        this.opts.log?.error({ postId: claim.occurrence.id, errName: errName(error) }, 'weekly reminder for post failed; skipped a week');
        await this.skipFailedPost(claim.occurrence, now);
        continue;
      }
      if (!claimed) break;
      processed++;
    }
    return processed;
  }

  /** Fall back to elapsed weeks only if the claimed schedule is unchanged. */
  private async skipFailedPost(occurrence: Occurrence, now: Date): Promise<void> {
    const { prisma } = this.opts;
    const behind = now.getTime() - occurrence.scheduledAt.getTime();
    const next = new Date(occurrence.scheduledAt.getTime() + WEEK_MS * (Math.floor(behind / WEEK_MS) + 1));
    await prisma.post.updateMany({
      where: { ...occurrence, deletedAt: null, OR: [{ status: { in: ['open', 'full'] } }, { status: 'closed', closedReason: 'finalized' }] },
      data: { scheduledAt: next, expiresAt: postExpiresAt(next, now) },
    });
  }

  start(checkEveryMs = 30_000): void {
    if (this.timer) return;
    this.stopping = false;
    const tick = () => {
      if (this.inFlight) return;
      this.inFlight = this.runOnce()
        .catch((error: unknown) => this.opts.log?.error({ errName: errName(error) }, 'weekly reminder job failed'))
        .finally(() => { this.inFlight = null; });
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
