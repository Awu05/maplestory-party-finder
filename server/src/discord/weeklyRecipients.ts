import type { Prisma, PrismaClient } from '@prisma/client';
import { findDestination } from './destinations.js';
import { pingableId } from './pingable.js';

type Db = PrismaClient | Prisma.TransactionClient;

/** The Discord ids of the post's current, unbanned members, in join order, once each. */
export async function weeklyRecipientIds(db: Db, postId: string): Promise<string[]> {
  const members = await db.postMember.findMany({
    where: { postId },
    include: { user: { select: { discordId: true, typedDiscordId: true, banned: true, deletedAt: true } } },
    orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
  });
  const recipients = new Set<string>();
  for (const member of members) {
    const discordId = pingableId(member.user)?.id;
    if (discordId) recipients.add(discordId);
  }
  return [...recipients];
}

/** Mention current members together in the selected notification guild. */
export async function weeklyRecipients(db: Db, post: { id: string; worldId: number; notificationGuildId: string | null }): Promise<Map<string, string[]>> {
  const guild = await findDestination(db, post.notificationGuildId, post.worldId, 'notifications');
  if (!guild) return new Map();
  const ids = await weeklyRecipientIds(db, post.id);
  return ids.length ? new Map([[guild.id, ids]]) : new Map();
}
