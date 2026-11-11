import type { Prisma, PrismaClient } from '@prisma/client';
import type { PostSummaryRow } from '../posts/serialize.js';
import { toPostSummaryDTO } from '../posts/serialize.js';
import type { Storage } from '../storage/storage.js';
import { buildNewPostMessage, buildPostClosedMessage } from './messages.js';

/** Queue the same world-scoped announcement and configured boss-role pings used for new posts. */
export async function enqueuePostAnnouncement(db: PrismaClient | Prisma.TransactionClient, row: PostSummaryRow, storage: Storage, webOrigin: string, now: Date, eventType: 'post.created' | 'post.announcement' | 'post.reopened' = 'post.created'): Promise<number> {
  const guilds = await db.guild.findMany({
    where: { active: true, webhookUrl: { not: null }, worlds: { some: { worldId: row.worldId } } },
    select: { id: true, bossRoleIds: true }, orderBy: { id: 'asc' },
  });
  if (!guilds.length) return 0;
  const post = toPostSummaryDTO(row, null, storage, now);
  await db.webhookDelivery.createMany({ data: guilds.map((guild) => {
    const mappings = guild.bossRoleIds as Record<string, string>;
    const roles = row.bosses.map((boss) => mappings[String(boss.bossDifficulty.bossId)]).filter((id): id is string => typeof id === 'string');
    const payload = buildNewPostMessage(post, webOrigin, roles);
    if (eventType === 'post.reopened') payload.content = [payload.content, 'Party reopened.'].filter(Boolean).join(' ');
    return { guildId: guild.id, eventType, payload: payload as unknown as Prisma.InputJsonValue, postId: row.id };
  }) });
  return guilds.length;
}

export async function enqueuePostClosure(db: PrismaClient, row: PostSummaryRow, storage: Storage, webOrigin: string, reason: string): Promise<void> {
  const guilds = await db.guild.findMany({
    where: { active: true, webhookUrl: { not: null }, worlds: { some: { worldId: row.worldId } } },
    select: { id: true },
  });
  if (!guilds.length) return;
  const payload = buildPostClosedMessage(toPostSummaryDTO(row, null, storage, new Date()), webOrigin, reason);
  await db.webhookDelivery.createMany({ data: guilds.map((guild) => ({
    guildId: guild.id, eventType: 'post.closed', postId: row.id, payload: payload as unknown as Prisma.InputJsonValue,
  })) });
}
