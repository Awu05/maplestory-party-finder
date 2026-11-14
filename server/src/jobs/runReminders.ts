import type { PrismaClient } from '@prisma/client';
import { reminderLabel } from '@pf/shared';
import { buildRunReminder, bossesLabel } from '../discord/messages.js';
import { enqueueDelivery } from '../discord/outbox.js';
import { findDestination } from '../discord/destinations.js';
import { toBossDTOs } from '../posts/serialize.js';
import { errName, type Logger } from '../log.js';

export const MAX_REMINDER_LATENESS_MS = 15 * 60_000;
/** A post whose reminder keeps failing is given up on for that run after this many tries in a row. */
const MAX_FAILURES = 3;
const CLEANUP_EVERY_MS = 3_600_000;
type Due = { id: string; runAt: Date; due: number[] };

export class RunReminderJob {
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<unknown> | null = null;
  private stopping = false;
  private lastCleanup = 0;
  /** Consecutive failures per post and run, kept between passes so a one-off error is retried. */
  private readonly failures = new Map<string, number>();

  constructor(private readonly opts: { prisma: PrismaClient; webOrigin: string; log?: Logger }) {}

  async runOnce(now = new Date()): Promise<number> {
    const { prisma, webOrigin } = this.opts;
    if (now.getTime() - this.lastCleanup >= CLEANUP_EVERY_MS) {
      await prisma.postReminderSent.deleteMany({ where: { runAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } } });
      this.lastCleanup = now.getTime();
    }
    let processed = 0;
    // Posts that failed in this pass wait for the next one, so the others still get their reminders.
    const failedThisPass: string[] = [];
    for (let attempt = 0; !this.stopping && attempt < 100; attempt++) {
      const claim: { due: Due | null } = { due: null };
      let claimed: boolean;
      try {
        claimed = await prisma.$transaction(async (tx) => {
          // The query alone decides which reminders are due; `due` lists them, soonest to the run first.
          const [due] = await tx.$queryRaw<Due[]>`
            SELECT p.id, p."scheduledAt" AS "runAt",
              ARRAY(SELECT o FROM unnest(p."reminderOffsets") AS o WHERE p."scheduledAt" - o * INTERVAL '1 minute' <= ${now} ORDER BY o) AS due
            FROM "Post" p
            WHERE p."scheduledAt" > ${now} AND p."expiresAt" > ${now} AND p."deletedAt" IS NULL
              AND NOT (p.id = ANY(${failedThisPass}::text[]))
              AND p.type IN ('recruiting', 'carrying')
              AND (p.status = 'closed' AND p."closedReason" = 'finalized'
                OR p."weeklyTimeZone" IS NOT NULL AND p.status IN ('open', 'full'))
              AND EXISTS (SELECT 1 FROM "User" u WHERE u.id = p."posterUserId" AND NOT u.banned AND u."deletedAt" IS NULL)
              AND EXISTS (SELECT 1 FROM unnest(p."reminderOffsets") AS o
                WHERE p."scheduledAt" - o * INTERVAL '1 minute' <= ${now}
                  AND NOT EXISTS (SELECT 1 FROM "PostReminderSent" s
                    WHERE s."postId" = p.id AND s."offsetMinutes" = o AND s."runAt" = p."scheduledAt"))
            ORDER BY p."scheduledAt", p.id LIMIT 1 FOR UPDATE OF p SKIP LOCKED`;
          if (!due) return false;
          claim.due = due;
          const { runAt } = due;
          const post = await tx.post.findUniqueOrThrow({ where: { id: due.id }, include: {
            bosses: { include: { bossDifficulty: { include: { boss: true } } } },
            members: { select: { userId: true } },
          } });
          const sent = await tx.postReminderSent.findMany({ where: { postId: post.id, runAt }, select: { offsetMinutes: true } });
          const remaining = due.due.filter((offset) => !sent.some((row) => row.offsetMinutes === offset));
          // The unique key is the claim: a row someone else already wrote means that reminder isn't ours to send.
          const { count } = await tx.postReminderSent.createMany({ data: remaining.map((offsetMinutes) => ({ postId: post.id, offsetMinutes, runAt })), skipDuplicates: true });
          // Only the reminder closest to the run is sent; earlier ones that are also due are just recorded.
          const closest = due.due[0]!;
          if (count !== remaining.length || !remaining.includes(closest) || now.getTime() - (runAt.getTime() - closest * 60_000) > MAX_REMINDER_LATENESS_MS) return true;
          const bosses = toBossDTOs(post);
          const title = post.title.trim() || bossesLabel({ bosses });
          // The time actually left, which is less than the offset when the reminder fires late.
          const left = reminderLabel(Math.max(1, Math.ceil((runAt.getTime() - now.getTime()) / 60_000)));
          await tx.notification.createMany({ data: [...new Set(post.members.map((m) => m.userId))].map((userId) => ({
            userId, kind: 'reminder', text: `Reminder: ${title} starts in ${left}`, link: `/posts/${post.id}`,
          })) });
          const guild = post.partyThreadId ? await findDestination(tx, post.partyForumGuildId, post.worldId, 'partyForum') : null;
          if (guild) await enqueueDelivery(tx, guild.id, 'post.run_reminder', {
            ...buildRunReminder({ post: { id: post.id, title: post.title, bosses }, runAt, pinged: [], unpinged: [], webOrigin }),
            _reminder: { runAt: runAt.toISOString(), offsetMinutes: closest, webOrigin },
          }, post.id);
          return true;
        });
      } catch (error) {
        const due = claim.due;
        if (due === null) throw error;
        failedThisPass.push(due.id);
        const key = `${due.id} ${due.runAt.toISOString()}`;
        const failures = (this.failures.get(key) ?? 0) + 1;
        if (failures < MAX_FAILURES) {
          this.failures.set(key, failures);
          this.opts.log?.error({ postId: due.id, errName: errName(error) }, 'run reminder for post failed; will retry');
          continue;
        }
        this.failures.delete(key);
        this.opts.log?.error({ postId: due.id, errName: errName(error) }, 'run reminder for post kept failing; skipped');
        // Recorded as handled, so this run's due reminders stop blocking the post.
        await prisma.postReminderSent.createMany({ data: due.due.map((offsetMinutes) => ({ postId: due.id, offsetMinutes, runAt: due.runAt })), skipDuplicates: true });
        continue;
      }
      if (!claimed) break;
      this.failures.delete(`${claim.due!.id} ${claim.due!.runAt.toISOString()}`);
      processed++;
    }
    return processed;
  }

  start(checkEveryMs = 30_000): void {
    if (this.timer) return;
    this.stopping = false;
    const tick = () => {
      if (this.inFlight) return;
      this.inFlight = this.runOnce()
        .catch((error: unknown) => this.opts.log?.error({ errName: errName(error) }, 'run reminder job failed'))
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
