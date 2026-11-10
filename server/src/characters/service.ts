import { Prisma, type PrismaClient } from '@prisma/client';
import type { NexonCharacterPreview } from '@pf/shared';
import { AppError } from '../http/errors.js';
import { NexonUnavailableError, type NexonClient, type NexonCharacter } from '../nexon/client.js';
import { closeLivePosts } from '../posts/lifecycle.js';
import { classToArchetype, type Archetype } from '@pf/shared';
import { characterInclude, type CharacterRow } from './serialize.js';

export interface CreateCharacterInput {
  ign: string;
  nexonWorldId: number;
  combatPower: number;
  guildId: string;
}

async function findOnNexon(nexon: NexonClient, ign: string): Promise<NexonCharacter[]> {
  try {
    return await nexon.findByName(ign);
  } catch (err) {
    if (err instanceof NexonUnavailableError) throw new AppError(502, 'NEXON_UNAVAILABLE', 'Nexon is unavailable, try again shortly');
    throw err;
  }
}

export async function lookupCharacters(
  deps: { prisma: PrismaClient; nexon: NexonClient },
  ign: string,
): Promise<NexonCharacterPreview[]> {
  const found = await findOnNexon(deps.nexon, ign);
  const worlds = await deps.prisma.world.findMany({ where: { nexonWorldId: { in: found.map((c) => c.nexonWorldId) } } });
  const names = new Map(worlds.map((w) => [w.nexonWorldId, w.name]));
  return found.map((c) => ({ ...c, worldName: names.get(c.nexonWorldId) ?? null }));
}

async function requireActiveGuild(prisma: PrismaClient, guildId: string) {
  const guild = await prisma.guild.findUnique({ where: { id: guildId } });
  if (!guild || !guild.active) throw new AppError(400, 'GUILD_INACTIVE', 'That guild is not accepting characters');
  return guild;
}

export async function createCharacter(
  deps: { prisma: PrismaClient; nexon: NexonClient },
  ownerId: string,
  input: CreateCharacterInput,
): Promise<CharacterRow> {
  const { prisma } = deps;

  const guild = await requireActiveGuild(prisma, input.guildId);

  const match = (await findOnNexon(deps.nexon, input.ign)).find((c) => c.nexonWorldId === input.nexonWorldId);
  if (!match) throw new AppError(404, 'CHARACTER_NOT_FOUND', 'Character not found on that world');

  const world = await prisma.world.findUnique({ where: { nexonWorldId: input.nexonWorldId } });
  if (!world) throw new AppError(400, 'UNKNOWN_WORLD', `World ${input.nexonWorldId} isn't set up yet — ask the admin`);
  if (!world.active) throw new AppError(400, 'WORLD_INACTIVE', 'That world is not active');

  const now = new Date();
  try {
    return await prisma.$transaction((tx) =>
      tx.character.create({
        data: {
          ownerId,
          ign: match.ign,
          ignLower: match.ign.toLowerCase(),
          worldId: world.id,
          jobName: match.jobName,
          level: match.level,
          imageUrl: match.imageUrl,
          combatPower: BigInt(input.combatPower),
          cpUpdatedAt: now,
          lastSyncedAt: now,
          guildId: guild.id,
        },
        include: characterInclude,
      }),
    );
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, 'ALREADY_CLAIMED', 'That character is already claimed');
    }
    throw err;
  }
}

export const REFRESH_COOLDOWN_MS = 600_000;

export interface ListCharactersFilter {
  guildId?: string;
  worldId?: number;
  archetype?: Archetype;
  q?: string;
  /** When set, only this owner's characters (including those in inactive guilds). */
  ownerId?: string;
}

export async function listCharacters(prisma: PrismaClient, filter: ListCharactersFilter): Promise<CharacterRow[]> {
  const rows = await prisma.character.findMany({
    where: {
      ...(filter.ownerId ? { ownerId: filter.ownerId } : { guild: { active: true }, owner: { banned: false } }),
      ...(filter.guildId ? { guildId: filter.guildId } : {}),
      ...(filter.worldId !== undefined ? { worldId: filter.worldId } : {}),
      ...(filter.q ? { ignLower: { startsWith: filter.q.toLowerCase() } } : {}),
    },
    include: characterInclude,
    orderBy: [{ combatPower: 'desc' }, { id: 'asc' }],
  });
  return filter.archetype ? rows.filter((r) => classToArchetype(r.jobName) === filter.archetype) : rows;
}

export async function getCharacter(prisma: PrismaClient | Prisma.TransactionClient, id: string): Promise<CharacterRow> {
  const row = await prisma.character.findUnique({ where: { id }, include: characterInclude });
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Character not found');
  return row;
}

export async function getOwnedCharacter(prisma: PrismaClient | Prisma.TransactionClient, id: string, userId: string): Promise<CharacterRow> {
  const row = await getCharacter(prisma, id);
  if (row.ownerId !== userId) throw new AppError(403, 'NOT_OWNER', 'You do not own this character');
  return row;
}

export type UpdateCharacterInput = Partial<Omit<CreateCharacterInput, 'ign' | 'nexonWorldId'>>;

export async function updateCharacter(
  prisma: PrismaClient,
  row: CharacterRow,
  input: UpdateCharacterInput,
): Promise<CharacterRow> {
  if (input.guildId !== undefined && input.guildId !== row.guildId) await requireActiveGuild(prisma, input.guildId);

  // The edit form always sends combatPower; only a real change counts as a CP update.
  const cpChanged = input.combatPower !== undefined && BigInt(input.combatPower) !== row.combatPower;

  return prisma.character.update({
    where: { id: row.id },
    data: {
      ...(cpChanged ? { combatPower: BigInt(input.combatPower!), cpUpdatedAt: new Date() } : {}),
      ...(input.guildId !== undefined ? { guildId: input.guildId } : {}),
    },
    include: characterInclude,
  });
}

/** Re-reads the character from Nexon. Never throws on Nexon errors; marks the row stale instead. */
export async function syncCharacterFromNexon(
  prisma: PrismaClient,
  nexon: NexonClient,
  characterId: string,
  opts?: { fresh?: boolean },
): Promise<'ok' | 'stale'> {
  const row = await prisma.character.findUnique({ where: { id: characterId }, include: { world: true } });
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Character not found');

  let match: NexonCharacter | undefined;
  try {
    match = (await nexon.findByName(row.ign, opts)).find((c) => c.nexonWorldId === row.world.nexonWorldId);
  } catch (err) {
    if (!(err instanceof NexonUnavailableError)) throw err;
  }

  if (!match) {
    await prisma.character.update({ where: { id: characterId }, data: { syncStatus: 'stale' } });
    return 'stale';
  }
  await prisma.character.update({
    where: { id: characterId },
    data: { level: match.level, jobName: match.jobName, imageUrl: match.imageUrl, lastSyncedAt: new Date(), syncStatus: 'ok' },
  });
  return 'ok';
}

/** Claims the refresh slot atomically; throws 429 TOO_SOON if one was taken within the cooldown. */
export async function claimRefresh(prisma: PrismaClient, characterId: string): Promise<void> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - REFRESH_COOLDOWN_MS);
  const { count } = await prisma.character.updateMany({
    where: { id: characterId, OR: [{ lastRefreshRequestedAt: null }, { lastRefreshRequestedAt: { lte: cutoff } }] },
    data: { lastRefreshRequestedAt: now },
  });
  if (count === 0) throw new AppError(429, 'TOO_SOON', 'You can refresh a character once every 10 minutes');
}

/** Closes the character's live posts, auto-declines their pending requests, then deletes the character. */
export async function deleteCharacter(
  prisma: PrismaClient,
  id: string,
): Promise<{ closedPostIds: string[]; declinedRequestIds: string[] }> {
  return prisma.$transaction(async (tx) => {
    const { closedPostIds, declinedIds: declined } = await closeLivePosts(tx, { posterCharacterId: id }, 'character_deleted');
    await tx.character.delete({ where: { id } });
    // The character's own requests cascade away with it; only the survivors still need an event.
    const survivors = await tx.request.findMany({ where: { id: { in: declined } }, select: { id: true } });
    return { closedPostIds, declinedRequestIds: survivors.map((r) => r.id) };
  });
}
