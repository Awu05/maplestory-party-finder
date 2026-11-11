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
      const claim: { id: string | null } = { id: null };
      let claimed: boolean;
      try {
        claimed = await prisma.$transaction(async (tx) => {
          const [due] = await tx.$queryRaw<{ id: string }[]>`
            SELECT p.id FROM "Post" p
            WHERE p."weeklyTimeZone" IS NOT NULL AND p."weeklyAnchorAt" IS NOT NULL
              AND p."scheduledAt" <= ${now} AND p.type = 'recruiting'
              AND (p.status IN ('open', 'full') OR (p.status = 'closed' AND p."closedReason" = 'finalized')) AND p."deletedAt" IS NULL
              AND EXISTS (SELECT 1 FROM "User" u WHERE u.id = p."posterUserId" AND NOT u.banned)
            ORDER BY p."scheduledAt", p.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED`;
          if (!due) return false;
          claim.id = due.id;
          const row = await tx.post.findUniqueOrThrow({ where: { id: due.id }, include: postSummaryInclude });
          // Calendar weeks in the saved zone, rather than 168 elapsed hours. Keep the original
          // anchor so a DST gap never permanently changes the chosen wall-clock time.
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
            // One delivery per guild that has someone to ping now. The worker re-reads the members at
            // send time (seconds later) and drops anyone who left; a guild only gained in between is missed.
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
        // Claiming itself failed: nothing post-specific to skip.
        if (claim.id === null) throw error;
        // One broken post (e.g. a zone Postgres rejects) must not block every other reminder: it
        // would be the oldest due row on every tick. Log it and push it a week on; it is retried then.
        this.opts.log?.error({ postId: claim.id, errName: errName(error) }, 'weekly reminder for post failed; skipped a week');
        await this.skipFailedPost(claim.id, now);
        continue;
      }
      if (!claimed) break;
      processed++;
    }
    return processed;
  }

  /**
   * Moves a post whose reminder failed to its first slot after `now` in whole 7-day steps (elapsed
   * time, not calendar weeks: its zone may be what failed), keeping expiresAt in step as a normal
   * advance does. Guarded on the old time so a concurrent change wins.
   */
  private async skipFailedPost(id: string, now: Date): Promise<void> {
    const { prisma } = this.opts;
    const post = await prisma.post.findUnique({ where: { id }, select: { scheduledAt: true } });
    if (!post?.scheduledAt) return;
    const behind = now.getTime() - post.scheduledAt.getTime();
    const next = new Date(post.scheduledAt.getTime() + WEEK_MS * Math.max(1, Math.floor(behind / WEEK_MS) + 1));
    await prisma.post.updateMany({
      where: { id, scheduledAt: post.scheduledAt },
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
