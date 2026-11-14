import { Prisma, type PrismaClient } from '@prisma/client';
import { effectivePostStatus, isActiveFinalized } from '@pf/shared';
import { buildPartyThread, buildWeeklyReminder, buildRunReminder, type WebhookPayload } from './messages.js';
import { pingableId, rosterMember } from './pingable.js';
import { SEND_TIMEOUT_MS, UNKNOWN_CHANNEL, type SendResult, type WebhookSender } from './sender.js';
import { errName, type Logger } from '../log.js';
import { weeklyRecipientIds } from './weeklyRecipients.js';
import { parseSnapshot } from '../posts/snapshot.js';
import { toBossDTOs } from '../posts/serialize.js';

type Db = PrismaClient | Prisma.TransactionClient;

const BACKOFF = [30_000, 120_000, 600_000, 3_600_000];
const MAX_ATTEMPTS = 5;
const DEFAULT_RETRY_AFTER_MS = 5_000;
const LEASE_MARGIN_MS = 30_000;
const DEADLINE_MARGIN_MS = 10_000;
const MIN_RETRY_AFTER_MS = 1_000;
const MAX_RETRY_AFTER_MS = 3_600_000;
const MAX_WEEKLY_REMINDER_AGE_MS = 15 * 60_000;
/** Same limit as the reminder job's lateness: a reminder still unsent this long after it was due is dropped, not sent late. */
const MAX_RUN_REMINDER_AGE_MS = 15 * 60_000;
const POST_DELIVERIES = new Set(['post.created', 'post.reopened', 'post.announcement', 'post.closed', 'post.weekly_reminder', 'post.party_thread', 'post.run_reminder', 'request.created', 'request.accepted']);
const ANNOUNCEMENTS = new Set(['post.created', 'post.reopened', 'post.announcement']);
const deliveryPostSelect = {
  id: true, notificationGuildId: true, partyForumGuildId: true, worldId: true,
  status: true, closedReason: true, expiresAt: true, deletedAt: true,
  weeklyTimeZone: true, weeklyAnchorAt: true, scheduledAt: true, title: true,
  reminderOffsets: true, partyThreadId: true, type: true, posterUserId: true,
} satisfies Prisma.PostSelect;
type ForumState = { status: string; closedReason: string | null; deletedAt: Date | null; expiresAt: Date; partyForumGuildId: string | null };

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

  /** Lease due deliveries, then release database locks before HTTP. */
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
    const fail = async (attempts: number, lastError: string, recheckForum = false) => {
      const data = { status: 'failed' as const, attempts, lastError };
      const postId = row.postId;
      if (row.eventType === 'post.party_thread' && postId) {
        const failed = await this.prisma.$transaction(async (tx) => {
          const locked = await this.lockCurrentThread(tx, row, postId);
          if (!locked) return false;
          const { current } = locked;
          if (recheckForum && isActiveFinalized(current, this.now()) && current?.partyForumGuildId === row.guildId) {
            await tx.webhookDelivery.updateMany({ where: guard, data: { nextAttemptAt: this.now() } });
            return false;
          }
          const { count } = await tx.webhookDelivery.updateMany({ where: guard, data });
          if (count) await tx.post.updateMany({ where: { id: postId }, data: { forumThreadRequested: false } });
          return count > 0;
        });
        if (!failed) return;
      } else await upd(data);
      counts.failed++;
    };
    const isForum = row.eventType === 'post.party_thread';
    const isReminder = row.eventType === 'post.run_reminder';
    const targetWebhook = isForum || isReminder ? row.partyForumWebhookUrl : row.webhookUrl;
    if (!targetWebhook || !row.active) {
      await fail(row.attempts + 1, 'Webhook not configured');
      return;
    }
    const postId = row.postId && POST_DELIVERIES.has(row.eventType) ? row.postId : null;
    // One read: the post's state, and whether this delivery's guild still serves the post's world.
    const post = postId ? await this.prisma.post.findUnique({
      where: { id: postId },
      select: { ...deliveryPostSelect, world: { select: { name: true, guilds: { where: { guildId: row.guildId }, select: { guildId: true } } } } },
    }) : null;
    // A closure notice goes to the guilds that saw the announcement, whatever the destination is now.
    if (postId && row.eventType !== 'post.closed') {
      const selected = isForum || isReminder ? post?.partyForumGuildId : post?.notificationGuildId;
      if (post && selected !== row.guildId) {
        // The poster moved the post's Discord destination: not a delivery failure.
        await this.prisma.webhookDelivery.deleteMany({ where: guard });
        return;
      }
      if (!post?.world.guilds.length) {
        await fail(row.attempts + 1, 'Discord destination changed or is unavailable');
        return;
      }
    }
    if (row.eventType === 'post.closed' && row.postId) {
      if (!post || effectivePostStatus(post, this.now()) === 'open') {
        await fail(row.attempts + 1, 'Post is no longer closed');
        return;
      }
    }
    if (row.eventType === 'post.weekly_reminder' && this.now().getTime() - row.createdAt.getTime() > MAX_WEEKLY_REMINDER_AGE_MS) {
      await fail(row.attempts + 1, 'Weekly reminder is no longer current');
      return;
    }
    if ((ANNOUNCEMENTS.has(row.eventType) || row.eventType === 'post.weekly_reminder' || isForum) && row.postId) {
      // Forum threads and weekly reminders also support active finalized parties.
      const weekly = row.payload._weekly;
      const activeFinalized = (row.eventType === 'post.weekly_reminder' || isForum) && isActiveFinalized(post, this.now());
      if (!post || (effectivePostStatus(post, this.now()) === 'closed' && !activeFinalized) || (ANNOUNCEMENTS.has(row.eventType) && effectivePostStatus(post, this.now()) !== 'open') || (isForum && !activeFinalized) || (row.eventType === 'post.weekly_reminder' &&
        (!weekly || post.weeklyTimeZone !== weekly.timeZone || post.weeklyAnchorAt?.toISOString() !== weekly.anchorAt || post.scheduledAt?.toISOString() !== weekly.nextAt))) {
        await fail(row.attempts + 1, 'Post no longer available', isForum);
        return;
      }
    }
    let payload = row.payload;
    let threadId: string | undefined;
    if (isReminder) {
      const meta = row.payload._reminder;
      const active = post && (isActiveFinalized(post, this.now()) || post.weeklyTimeZone && ['open', 'full'].includes(post.status) && effectivePostStatus(post, this.now()) !== 'closed');
      const poster = post ? await this.prisma.user.findUnique({ where: { id: post.posterUserId }, select: { banned: true, deletedAt: true } }) : null;
      if (!post || !active || post.type === 'lfp' || !poster || poster.banned || poster.deletedAt || !post.partyThreadId || !meta
        || post.scheduledAt?.toISOString() !== meta.runAt || post.scheduledAt <= this.now() || !post.reminderOffsets.includes(meta.offsetMinutes)
        || this.now().getTime() - (Date.parse(meta.runAt) - meta.offsetMinutes * 60_000) > MAX_RUN_REMINDER_AGE_MS) {
        await this.prisma.webhookDelivery.deleteMany({ where: guard });
        return;
      }
      const [bosses, members] = await Promise.all([
        this.prisma.postBoss.findMany({ where: { postId: post.id }, include: { bossDifficulty: { include: { boss: true } } } }),
        this.prisma.postMember.findMany({ where: { postId: post.id }, include: { user: { select: { discordId: true, typedDiscordId: true, banned: true, deletedAt: true } } }, orderBy: { joinedAt: 'asc' } }),
      ]);
      const pinged: string[] = [];
      const unpinged: string[] = [];
      for (const member of members) {
        // Banned and deleted members are left out entirely; "Unpinged" is for members with no Discord ID.
        if (member.user.banned || member.user.deletedAt) continue;
        const ping = pingableId(member.user);
        if (ping) pinged.push(ping.id);
        else unpinged.push(parseSnapshot(member.snapshot).ign);
      }
      payload = buildRunReminder({ post: { id: post.id, title: post.title, bosses: toBossDTOs({ bosses }) }, runAt: post.scheduledAt, pinged, unpinged, webOrigin: meta.webOrigin });
      threadId = post.partyThreadId;
    }
    if (isForum && row.postId) {
      // Loaded only once the thread is known to be current.
      const [bosses, members] = post ? await Promise.all([
        this.prisma.postBoss.findMany({ where: { postId: row.postId }, include: { bossDifficulty: { include: { boss: true } } } }),
        this.prisma.postMember.findMany({ where: { postId: row.postId }, include: { user: { select: { discordId: true, typedDiscordId: true, username: true, banned: true, deletedAt: true } } }, orderBy: { joinedAt: 'asc' } }),
      ]) : [[], []];
      const poster = members.find((member) => member.role === 'poster');
      if (!post || !poster) {
        await fail(row.attempts + 1, 'Post no longer available');
        return;
      }
      // Older queued rows keep their existing public link.
      const webOrigin = row.payload._forum?.webOrigin ?? row.payload.content?.match(/Party details: (https?:\/\/\S+)\/posts\/[^\s]+/)?.[1];
      if (!webOrigin) {
        await fail(row.attempts + 1, 'Party link unavailable');
        return;
      }
      const thread = buildPartyThread({
        id: post.id, title: post.title, scheduledAt: post.scheduledAt?.toISOString() ?? null, world: { name: post.world.name },
        poster: { snapshot: parseSnapshot(poster.snapshot) },
        bosses: toBossDTOs({ bosses }),
      }, webOrigin, members.map((member) => rosterMember(parseSnapshot(member.snapshot).ign, member.user)));
      payload = { ...thread.message, thread_name: thread.name };
    }
    if (row.eventType === 'post.weekly_reminder' && row.postId) {
      const weekly = row.payload._weekly;
      if (!weekly?.post || !weekly.webOrigin) {
        await fail(row.attempts + 1, 'Weekly reminder is no longer current');
        return;
      }
      // The destination, its world and its webhook were checked above.
      const ids = await weeklyRecipientIds(this.prisma, row.postId);
      if (!ids.length) {
        // No remaining recipients is not a delivery failure.
        await this.prisma.webhookDelivery.deleteMany({ where: guard });
        return;
      }
      // Rebuilt for the members who are in the party now; the stored text is only a record.
      payload = buildWeeklyReminder({ recipientDiscordIds: ids, post: weekly.post, webOrigin: weekly.webOrigin });
    }
    let res: SendResult;
    try {
      res = await this.sender.send(targetWebhook, payload, threadId ? { threadId } : undefined);
    } catch (err) {
      res = { ok: false, status: null, error: errName(err) };
    }
    if (res.ok) {
      if (isForum && row.postId) {
        const channelId = res.channelId;
        const postId = row.postId;
        const saved = await this.prisma.$transaction(async (tx) => {
          if (!(await this.lockCurrentThread(tx, row, postId))) return false;
          await tx.webhookDelivery.updateMany({ where: guard, data: { status: 'sent', sentAt: this.now(), lastError: null } });
          if (channelId) await tx.post.updateMany({ where: { id: postId, forumThreadRequested: true, partyForumGuildId: row.guildId }, data: { partyThreadId: channelId } });
          return true;
        });
        if (!saved) return;
      } else await upd({ status: 'sent', sentAt: this.now(), lastError: null });
      if (row.postId && ANNOUNCEMENTS.has(row.eventType)) {
        // This guild's channel now shows the post, so it gets the closure notice.
        await this.prisma.$executeRaw`
          UPDATE "Post" SET "announcedGuildIds" = array_append("announcedGuildIds", ${row.guildId})
          WHERE id = ${row.postId} AND NOT (${row.guildId} = ANY("announcedGuildIds"))`;
      }
      counts.sent++;
    } else if (res.status === 404 || res.status === 401) {
      // Only a deleted thread forgets the thread; a deleted or rotated webhook keeps it for when it's fixed.
      if (isReminder && res.status === 404 && res.discordCode === UNKNOWN_CHANNEL && row.postId && threadId) {
        await this.prisma.post.updateMany({ where: { id: row.postId, partyThreadId: threadId }, data: { partyThreadId: null } });
      }
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

  /**
   * Locks the post (finalization locks it too before touching its deliveries) and checks the queued
   * thread is still this run's: a reopen and re-finalize gives the row a new token. When it isn't,
   * the row is retried now with its new content and this returns null. `current` is undefined when the post is gone.
   */
  private async lockCurrentThread(tx: Prisma.TransactionClient, row: Claimed, postId: string): Promise<{ current: ForumState | undefined } | null> {
    const [current] = await tx.$queryRaw<ForumState[]>`SELECT status, "closedReason", "deletedAt", "expiresAt", "partyForumGuildId" FROM "Post" WHERE id = ${postId} FOR UPDATE`;
    const delivery = await tx.webhookDelivery.findUnique({ where: { id: row.id }, select: { payload: true } });
    if ((delivery?.payload as WebhookPayload | undefined)?._forum?.requestId === row.payload._forum?.requestId) return { current };
    await tx.webhookDelivery.updateMany({ where: { id: row.id, status: 'pending' }, data: { nextAttemptAt: this.now() } });
    return null;
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
