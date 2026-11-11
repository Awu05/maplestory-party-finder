import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/** Route each person through one usable guild webhook, including deleted-character snapshots. */
export async function weeklyRecipients(db: Db, postId: string): Promise<Map<string, string[]>> {
  const members = await db.postMember.findMany({
    where: { postId },
    include: { character: { select: { guildId: true } }, user: { select: { discordId: true, banned: true } } },
    orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
  });
  const guilds = await db.guild.findMany({ where: { active: true, webhookUrl: { not: null } }, select: { id: true, name: true } });
  const ids = new Set(guilds.map((g) => g.id));
  const byName = new Map(guilds.map((g) => [g.name, g.id]));
  const result = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const member of members) {
    const snapshot = member.snapshot as { guildName?: unknown } | null;
    const guildId = member.character ? member.character.guildId : member.reminderGuildId ?? (typeof snapshot?.guildName === 'string' ? byName.get(snapshot.guildName) : undefined);
    const discordId = member.user.discordId;
    if (!guildId || !ids.has(guildId) || !discordId || member.user.banned || seen.has(discordId)) continue;
    seen.add(discordId);
    const group = result.get(guildId) ?? [];
    group.push(discordId);
    result.set(guildId, group);
  }
  return result;
}
