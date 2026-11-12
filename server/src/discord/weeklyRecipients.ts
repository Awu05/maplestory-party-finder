import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/** Mention current members together in the selected notification guild. */
export async function weeklyRecipients(db: Db, postId: string): Promise<Map<string, string[]>> {
  const members = await db.postMember.findMany({
    where: { postId },
    include: { user: { select: { discordId: true, banned: true } } },
    orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
  });
  const post = await db.post.findUnique({ where: { id: postId }, select: { worldId: true, notificationGuildId: true } });
  if (!post?.notificationGuildId) return new Map();
  const guild = await db.guild.findFirst({ where: { id: post.notificationGuildId, active: true, webhookUrl: { not: null }, worlds: { some: { worldId: post.worldId } } }, select: { id: true } });
  if (!guild) return new Map();
  const recipients = new Set<string>();
  for (const member of members) {
    const discordId = member.user.discordId;
    if (discordId && !member.user.banned) recipients.add(discordId);
  }
  return recipients.size ? new Map([[guild.id, [...recipients]]]) : new Map();
}
