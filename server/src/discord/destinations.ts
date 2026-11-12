import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../http/errors.js';

type Db = PrismaClient | Prisma.TransactionClient;
export async function validateDestination(db: Db, guildId: string | null, worldId: number, kind: 'notification' | 'forum'): Promise<void> {
  if (!guildId) return;
  const guild = await db.guild.findFirst({ where: {
    id: guildId, active: true, worlds: { some: { worldId } },
    ...(kind === 'notification' ? { webhookUrl: { not: null } } : { partyForumWebhookUrl: { not: null } }),
  }, select: { id: true } });
  if (!guild) throw new AppError(400, 'INVALID_DISCORD_DESTINATION', `Choose an available ${kind === 'notification' ? 'notification guild' : 'party chat guild'} for this world, or None.`);
}
