import type { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../http/errors.js';

type Db = PrismaClient | Prisma.TransactionClient;
export type DestinationKind = 'notifications' | 'partyForum';

/** The guild if it is active, serves `worldId` and has the webhook for `kind` configured; else null. */
export async function findDestination(db: Db, guildId: string | null | undefined, worldId: number, kind: DestinationKind): Promise<{ id: string; bossRoleIds: Prisma.JsonValue } | null> {
  if (!guildId) return null;
  return db.guild.findFirst({ where: {
    id: guildId, active: true, worlds: { some: { worldId } },
    ...(kind === 'notifications' ? { webhookUrl: { not: null } } : { partyForumWebhookUrl: { not: null } }),
  }, select: { id: true, bossRoleIds: true } });
}

export async function validateDestination(db: Db, guildId: string | null, worldId: number, kind: DestinationKind): Promise<void> {
  if (!guildId) return;
  if (!(await findDestination(db, guildId, worldId, kind))) {
    throw new AppError(400, 'INVALID_DISCORD_DESTINATION', `Choose an available ${kind === 'notifications' ? 'notification guild' : 'party chat guild'} for this world, or None.`);
  }
}
