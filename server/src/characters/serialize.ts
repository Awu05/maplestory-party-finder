import type { Prisma } from '@prisma/client';
import type { CharacterDTO } from '@pf/shared';
import type { Storage } from '../storage/storage.js';

export const characterInclude = {
  world: true,
  // Only the public fields the DTO needs (no guild webhookUrl, no owner discordId/banned).
  guild: { select: { id: true, name: true, iconUrl: true } },
  owner: { select: { username: true } },
} satisfies Prisma.CharacterInclude;

export type CharacterRow = Prisma.CharacterGetPayload<{ include: typeof characterInclude }>;

export function toCharacterDTO(row: CharacterRow, viewerUserId: string | null, storage: Storage): CharacterDTO {
  return {
    id: row.id,
    ign: row.ign,
    world: { id: row.world.id, name: row.world.name },
    jobName: row.jobName,
    level: row.level,
    imageUrl: row.imageUrl,
    combatPower: Number(row.combatPower),
    cpUpdatedAt: row.cpUpdatedAt.toISOString(),
    guild: { id: row.guild.id, name: row.guild.name, iconUrl: row.guild.iconUrl },
    screenshotUrl: row.screenshotKey ? storage.publicUrl(row.screenshotKey) : null,
    owner: { discordUsername: row.owner.username },
    isOwner: viewerUserId !== null && row.ownerId === viewerUserId,
    syncStatus: row.syncStatus,
    lastSyncedAt: row.lastSyncedAt.toISOString(),
  };
}
