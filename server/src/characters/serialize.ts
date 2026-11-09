import type { Prisma } from '@prisma/client';
import type { CharacterDTO } from '@pf/shared';
import type { Storage } from '../storage/storage.js';

export const characterInclude = {
  world: true,
  // Only the public fields the DTO needs (no guild webhookUrl, no owner discordId/banned).
  guild: { select: { id: true, name: true, iconUrl: true } },
  owner: { select: { username: true } },
  bosses: { include: { bossDifficulty: { include: { boss: true } } } },
} satisfies Prisma.CharacterInclude;

export type CharacterRow = Prisma.CharacterGetPayload<{ include: typeof characterInclude }>;

export function toCharacterDTO(row: CharacterRow, viewerUserId: string | null, storage: Storage): CharacterDTO {
  const bosses = [...row.bosses].sort(
    (a, b) =>
      a.bossDifficulty.boss.sortOrder - b.bossDifficulty.boss.sortOrder ||
      a.bossDifficulty.boss.id - b.bossDifficulty.boss.id ||
      a.bossDifficulty.sortOrder - b.bossDifficulty.sortOrder ||
      a.bossDifficulty.id - b.bossDifficulty.id,
  );
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
    note: row.note,
    playTimes: [...row.playTimes].sort((a, b) => a - b),
    bosses: bosses.map((b) => ({
      bossDifficultyId: b.bossDifficultyId,
      bossName: b.bossDifficulty.boss.name,
      difficulty: b.bossDifficulty.difficulty,
      experience: b.experience,
    })),
    owner: { discordUsername: row.owner.username },
    isOwner: viewerUserId !== null && row.ownerId === viewerUserId,
    syncStatus: row.syncStatus,
    lastSyncedAt: row.lastSyncedAt.toISOString(),
  };
}
