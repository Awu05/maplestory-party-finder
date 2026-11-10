import type { Prisma, PrismaClient } from '@prisma/client';
import type { PostSummaryDTO } from '@pf/shared';
import type { DomainEvent, DomainEvents } from '../events.js';
import { bossLabel, buildAcceptPing, buildNewPostMessage, buildRequestPing, type WebhookPayload } from '../discord/messages.js';
import { enqueueDelivery } from '../discord/outbox.js';
import { postSummaryInclude, toPostSummaryDTO } from '../posts/serialize.js';
import type { Storage } from '../storage/storage.js';

type Logger = { error(obj: object, msg: string): void };

type NotificationKind = 'join_request' | 'invite' | 'accepted' | 'declined' | 'auto_declined' | 'removed' | 'member_left';

const requestDispatchInclude = {
  character: { select: { ownerId: true, guildId: true, ign: true, jobName: true, level: true, combatPower: true } },
  post: { include: postSummaryInclude },
} satisfies Prisma.RequestInclude;

type RequestDispatchRow = Prisma.RequestGetPayload<{ include: typeof requestDispatchInclude }>;

const errName = (err: unknown): string => (err instanceof Error ? err.constructor.name : 'Error');
/** Safe diagnostics only: the error class, a string code (e.g. Prisma's P2003), and the event's ids. */
const errCode = (err: unknown): { code?: string } => {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? { code } : {};
};
const eventIds = (e: DomainEvent): { postId?: string; requestId?: string } =>
  'requestId' in e ? { requestId: e.requestId } : { postId: e.postId };
const bossesLabel = (post: PostSummaryDTO): string => post.bosses.map(bossLabel).join(' + ');
const postPath = (postId: string): string => `/posts/${postId}`;

/**
 * Turns DomainEvents into in-app Notifications and WebhookDelivery outbox rows. emit() never blocks
 * or throws: each event is handled asynchronously (its steps sequentially) and failures are logged
 * by event type and error class only. Rows are re-read fresh; an event whose rows are gone is skipped.
 */
export class EventDispatcher implements DomainEvents {
  private readonly prisma: PrismaClient;
  private readonly storage: Storage;
  private readonly webOrigin: string;
  private readonly log: Logger;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(opts: { prisma: PrismaClient; storage: Storage; webOrigin: string; log: Logger }) {
    this.prisma = opts.prisma;
    this.storage = opts.storage;
    this.webOrigin = opts.webOrigin;
    this.log = opts.log;
  }

  emit(e: DomainEvent): void {
    const p: Promise<void> = this.handle(e)
      .catch((err) => {
        try {
          this.log.error({ event: e.type, ...eventIds(e), errName: errName(err), ...errCode(err) }, 'event dispatch failed');
        } catch {
          // A failing logger must not surface as an unhandled rejection.
        }
      })
      .finally(() => this.inFlight.delete(p));
    this.inFlight.add(p);
  }

  /** Resolves once every handler in flight (including ones started while draining) has settled. */
  async drain(): Promise<void> {
    while (this.inFlight.size > 0) await Promise.all([...this.inFlight]);
  }

  private async handle(e: DomainEvent): Promise<void> {
    switch (e.type) {
      case 'post.created':
        return this.postCreated(e.postId);
      case 'request.created':
      case 'request.accepted':
      case 'request.declined': {
        const row = await this.prisma.request.findUnique({ where: { id: e.requestId }, include: requestDispatchInclude });
        if (!row) return; // e.g. cascade-deleted with its character
        if (e.type === 'request.created') return this.requestCreated(row);
        if (e.type === 'request.accepted') return this.requestAccepted(row);
        return this.requestDeclined(row, e.auto, e.actorUserId);
      }
      case 'member.left':
        return this.memberLeft(e);
      default:
        return; // post.updated, post.closed, post.reopened, request.cancelled notify no one
    }
  }

  private dto(row: RequestDispatchRow['post']): PostSummaryDTO {
    return toPostSummaryDTO(row, null, this.storage, new Date());
  }

  private async postCreated(postId: string): Promise<void> {
    const row = await this.prisma.post.findUnique({ where: { id: postId }, include: postSummaryInclude });
    if (!row) return;
    const payload = buildNewPostMessage(this.dto(row), this.webOrigin);
    const guilds = await this.prisma.guild.findMany({
      where: { active: true, webhookUrl: { not: null }, worlds: { some: { worldId: row.worldId } } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    for (const g of guilds) await enqueueDelivery(this.prisma, g.id, 'post.created', payload, postId);
  }

  private async requestCreated(row: RequestDispatchRow): Promise<void> {
    const post = this.dto(row.post);
    const ch = row.character;
    const actor = row.createdByUserId;
    const applicant = { ign: ch.ign, jobName: ch.jobName, level: ch.level, combatPower: Number(ch.combatPower) };
    const build = (kind: 'join_request' | 'invite') => (recipientDiscordId: string) =>
      buildRequestPing({ recipientDiscordId, kind, applicant, post, webOrigin: this.webOrigin });
    if (row.kind === 'join_request') {
      const recipient = row.post.posterUserId;
      await this.notify(recipient, actor, 'join_request', `${ch.ign} wants to join your ${bossesLabel(post)} run`, row.postId);
      await this.ping(row.post.guildId, recipient, actor, 'request.created', build('join_request'));
    } else {
      const recipient = ch.ownerId;
      await this.notify(recipient, actor, 'invite', `${post.poster.snapshot.ign} invited ${ch.ign} to ${bossesLabel(post)}`, row.postId);
      await this.ping(ch.guildId, recipient, actor, 'request.created', build('invite'));
    }
  }

  private async requestAccepted(row: RequestDispatchRow): Promise<void> {
    const post = this.dto(row.post);
    const ch = row.character;
    if (row.kind === 'join_request') {
      const actor = row.post.posterUserId;
      const text = `${ch.ign} was accepted into ${post.poster.snapshot.ign}'s ${bossesLabel(post)} run`;
      await this.notify(ch.ownerId, actor, 'accepted', text, row.postId);
      await this.ping(ch.guildId, ch.ownerId, actor, 'request.accepted', (recipientDiscordId) =>
        buildAcceptPing({ recipientDiscordId, ign: ch.ign, post, webOrigin: this.webOrigin }),
      );
    } else {
      // The invitee accepted it themselves: the poster gets an in-app notification only.
      await this.notify(row.post.posterUserId, ch.ownerId, 'accepted', `${ch.ign} accepted your invite`, row.postId);
    }
  }

  private async requestDeclined(row: RequestDispatchRow, auto: boolean, actorUserId: string | null): Promise<void> {
    const post = this.dto(row.post);
    const ch = row.character;
    if (auto) {
      // Only the applicant or invitee hears about an auto-decline, and never when they caused it
      // (e.g. accepting one invite auto-declines their other invites).
      await this.notify(ch.ownerId, actorUserId, 'auto_declined', `The ${bossesLabel(post)} party filled or the post closed`, row.postId);
    } else if (row.kind === 'join_request') {
      await this.notify(ch.ownerId, actorUserId, 'declined', `${ch.ign}'s request to join the ${bossesLabel(post)} run was declined`, row.postId);
    } else {
      await this.notify(row.post.posterUserId, actorUserId, 'declined', `${ch.ign} declined your invite`, row.postId);
    }
  }

  private async memberLeft(e: Extract<DomainEvent, { type: 'member.left' }>): Promise<void> {
    const row = await this.prisma.post.findUnique({ where: { id: e.postId }, include: postSummaryInclude });
    if (!row) return;
    const bosses = bossesLabel(this.dto(row));
    if (e.removedBy === 'poster') {
      await this.notify(e.userId, row.posterUserId, 'removed', `${e.ign} was removed from the ${bosses} party`, row.id);
    } else {
      await this.notify(row.posterUserId, e.userId, 'member_left', `${e.ign} left your ${bosses} party`, row.id);
    }
  }

  private async notify(userId: string, actorUserId: string | null, kind: NotificationKind, text: string, postId: string): Promise<void> {
    if (userId === actorUserId) return;
    await this.prisma.notification.create({ data: { userId, kind, text, link: postPath(postId) } });
  }

  /** Enqueues a ping to `guildId` mentioning the recipient, unless the guild can't receive it or the recipient is the actor. */
  private async ping(
    guildId: string,
    recipientUserId: string,
    actorUserId: string,
    eventType: string,
    build: (recipientDiscordId: string) => WebhookPayload,
  ): Promise<void> {
    if (recipientUserId === actorUserId) return;
    const guild = await this.prisma.guild.findUnique({ where: { id: guildId }, select: { active: true, webhookUrl: true } });
    if (!guild?.active || !guild.webhookUrl) return;
    const user = await this.prisma.user.findUnique({ where: { id: recipientUserId }, select: { discordId: true } });
    if (!user?.discordId) return;
    await enqueueDelivery(this.prisma, guildId, eventType, build(user.discordId));
  }
}
