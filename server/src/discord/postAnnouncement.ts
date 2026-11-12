import type { Prisma, PrismaClient } from '@prisma/client';
import type { PostSummaryRow } from '../posts/serialize.js';
import { toPostSummaryDTO } from '../posts/serialize.js';
import type { Storage } from '../storage/storage.js';
import { findDestination } from './destinations.js';
import { buildNewPostMessage, buildPostClosedMessage } from './messages.js';

/** Queue announcements only for the post's selected notification guild. */
export async function enqueuePostAnnouncement(db: PrismaClient | Prisma.TransactionClient, row: PostSummaryRow, storage: Storage, webOrigin: string, now: Date, eventType: 'post.created' | 'post.announcement' | 'post.reopened' = 'post.created'): Promise<number> {
  const guild = await findDestination(db, row.notificationGuildId, row.worldId, 'notifications');
  if (!guild) return 0;
  const mappings = guild.bossRoleIds as Record<string, string>;
  const roles = row.bosses.map((boss) => mappings[String(boss.bossDifficulty.bossId)]).filter((id): id is string => typeof id === 'string');
  const payload = buildNewPostMessage(toPostSummaryDTO(row, null, storage, now), webOrigin, roles);
  if (eventType === 'post.reopened') payload.content = [payload.content, 'Party reopened.'].filter(Boolean).join(' ');
  await db.webhookDelivery.create({ data: { guildId: guild.id, eventType, payload: payload as unknown as Prisma.InputJsonValue, postId: row.id } });
  return 1;
}

/**
 * Queue the closure notice for the guilds whose channel received this run's announcement (not the current
 * notification guild, which may never have seen it). Each guild hears of a closure once.
 */
export async function enqueuePostClosure(db: PrismaClient, row: PostSummaryRow, storage: Storage, webOrigin: string, reason: string): Promise<void> {
  // Read and cleared in one statement, so a concurrent closure cannot notify the same guild twice.
  const [announced] = await db.$queryRaw<{ ids: string[] }[]>`
    UPDATE "Post" p SET "announcedGuildIds" = '{}'
    FROM (SELECT id, "announcedGuildIds" FROM "Post" WHERE id = ${row.id} FOR UPDATE) old
    WHERE p.id = old.id RETURNING old."announcedGuildIds" AS ids`;
  if (!announced?.ids.length) return;
  const guilds = await db.guild.findMany({ where: { id: { in: announced.ids }, active: true, webhookUrl: { not: null } }, select: { id: true }, orderBy: { id: 'asc' } });
  if (!guilds.length) return;
  const payload = buildPostClosedMessage(toPostSummaryDTO(row, null, storage, new Date()), webOrigin, reason);
  await db.webhookDelivery.createMany({ data: guilds.map((guild) => ({
    guildId: guild.id, eventType: 'post.closed', postId: row.id, payload: payload as unknown as Prisma.InputJsonValue,
  })) });
}
