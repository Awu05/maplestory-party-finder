import { Prisma, type PrismaClient, type World } from '@prisma/client';
import type { NexonCharacterPreview, RefreshOutcome, WorldCandidateDTO } from '@pf/shared';
import { AppError } from '../http/errors.js';
import { NexonUnavailableError, type NexonClient, type NexonCharacter } from '../nexon/client.js';
import { closeLivePosts } from '../posts/lifecycle.js';
import type { Archetype } from '@pf/shared';
import { resolveArchetype } from '../classes/archetype.js';
import { characterInclude, type CharacterRow } from './serialize.js';

export interface CreateCharacterInput {
  ign: string;
  nexonWorldId: number;
  combatPower: number;
  guildId: string | null;
}

async function findOnNexon(nexon: NexonClient, ign: string, opts?: { fresh?: boolean }): Promise<NexonCharacter[]> {
  try {
    return await nexon.findByName(ign, opts);
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

/** Runs `work`, turning the unique (ignLower, worldId) violation into 409 ALREADY_CLAIMED. */
async function mapAlreadyClaimed<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, 'ALREADY_CLAIMED', 'That character is already claimed');
    }
    throw err;
  }
}

export async function createCharacter(
  deps: { prisma: PrismaClient; nexon: NexonClient },
  ownerId: string,
  input: CreateCharacterInput,
): Promise<CharacterRow> {
  const { prisma } = deps;

  const guild = input.guildId === null ? null : await requireActiveGuild(prisma, input.guildId);

  const match = (await findOnNexon(deps.nexon, input.ign)).find((c) => c.nexonWorldId === input.nexonWorldId);
  if (!match) throw new AppError(404, 'CHARACTER_NOT_FOUND', 'Character not found on that world');

  const world = await prisma.world.findUnique({ where: { nexonWorldId: input.nexonWorldId } });
  if (!world) throw new AppError(400, 'UNKNOWN_WORLD', `World ${input.nexonWorldId} isn't set up yet — ask the admin`);
  if (!world.active) throw new AppError(400, 'WORLD_INACTIVE', 'That world is not active');

  const archetype = await resolveArchetype(prisma, match.jobName);
  const now = new Date();
  return mapAlreadyClaimed(() =>
    prisma.$transaction((tx) =>
      tx.character.create({
        data: {
          ownerId,
          ign: match.ign,
          ignLower: match.ign.toLowerCase(),
          worldId: world.id,
          jobName: match.jobName,
          archetype,
          level: match.level,
          imageUrl: match.imageUrl,
          combatPower: BigInt(input.combatPower),
          cpUpdatedAt: now,
          lastSyncedAt: now,
          guildId: guild?.id ?? null,
        },
        include: characterInclude,
      }),
    ),
  );
}

export interface ManualCharacterInput {
  ign: string;
  worldId: number;
  jobName: string;
  level: number;
  combatPower: number;
  guildId: string | null;
}

export const DEFAULT_CHARACTER_IMAGE = '/default-character.svg';

async function requireJobClass(prisma: PrismaClient, jobName: string) {
  const jobClass = await prisma.jobClass.findUnique({ where: { nameLower: jobName.trim().toLowerCase() } });
  if (!jobClass) throw new AppError(400, 'UNKNOWN_CLASS', 'Pick a class from the list');
  return jobClass;
}

export async function createManualCharacter(
  prisma: PrismaClient,
  ownerId: string,
  input: ManualCharacterInput,
): Promise<CharacterRow> {
  const guild = input.guildId === null ? null : await requireActiveGuild(prisma, input.guildId);
  const world = await prisma.world.findUnique({ where: { id: input.worldId } });
  if (!world) throw new AppError(400, 'UNKNOWN_WORLD', "That world isn't set up yet — ask the admin");
  if (!world.active) throw new AppError(400, 'WORLD_INACTIVE', 'That world is not active');
  const jobClass = await requireJobClass(prisma, input.jobName);

  const ign = input.ign.trim();
  const now = new Date();
  return mapAlreadyClaimed(() =>
    prisma.character.create({
      data: {
        ownerId,
        ign,
        ignLower: ign.toLowerCase(),
        worldId: world.id,
        jobName: jobClass.name,
        archetype: jobClass.archetype,
        level: input.level,
        imageUrl: DEFAULT_CHARACTER_IMAGE,
        combatPower: BigInt(input.combatPower),
        cpUpdatedAt: now,
        lastSyncedAt: now,
        guildId: guild?.id ?? null,
        source: 'manual',
      },
      include: characterInclude,
    }),
  );
}

export const REFRESH_COOLDOWN_MS = 600_000;

export interface ListCharactersFilter {
  worldId?: number;
  archetype?: Archetype;
  q?: string;
  /** When set, only this owner's characters. Otherwise everyone's, except banned or deleted accounts' (a guild being inactive hides nothing). */
  ownerId?: string;
}

export async function listCharacters(prisma: PrismaClient, filter: ListCharactersFilter): Promise<CharacterRow[]> {
  return prisma.character.findMany({
    where: {
      ...(filter.ownerId
        ? { ownerId: filter.ownerId }
        : { owner: { banned: false, deletedAt: null } }),
      ...(filter.worldId !== undefined ? { worldId: filter.worldId } : {}),
      ...(filter.archetype ? { archetype: filter.archetype } : {}),
      ...(filter.q ? { ignLower: { startsWith: filter.q.toLowerCase() } } : {}),
    },
    include: characterInclude,
    orderBy: [{ combatPower: 'desc' }, { id: 'asc' }],
  });
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

export type UpdateCharacterInput = Partial<Pick<CreateCharacterInput, 'combatPower' | 'guildId'>> & {
  jobName?: string;
  level?: number;
};

export async function updateCharacter(
  prisma: PrismaClient,
  row: CharacterRow,
  input: UpdateCharacterInput,
): Promise<CharacterRow> {
  if (input.guildId != null && input.guildId !== row.guildId) await requireActiveGuild(prisma, input.guildId);

  let classData: { jobName: string; archetype: Archetype } | null = null;
  if (input.jobName !== undefined || input.level !== undefined) {
    if (row.source !== 'manual') {
      throw new AppError(400, 'NOT_MANUAL', 'Only manually added characters can change class or level');
    }
    // An unchanged class is kept as-is, even if the admin has since removed it from the list.
    if (input.jobName !== undefined && input.jobName.trim().toLowerCase() !== row.jobName.toLowerCase()) {
      const jobClass = await requireJobClass(prisma, input.jobName);
      classData = { jobName: jobClass.name, archetype: jobClass.archetype };
    }
  }

  // The edit form always sends combatPower; only a real change counts as a CP update.
  const cpChanged = input.combatPower !== undefined && BigInt(input.combatPower) !== row.combatPower;

  return prisma.character.update({
    where: { id: row.id },
    data: {
      ...(cpChanged ? { combatPower: BigInt(input.combatPower!), cpUpdatedAt: new Date() } : {}),
      ...(input.guildId !== undefined ? { guildId: input.guildId } : {}),
      ...(classData ?? {}),
      ...(input.level !== undefined ? { level: input.level } : {}),
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
  await prisma.character.update({ where: { id: characterId }, data: await nexonSyncData(prisma, match) });
  return 'ok';
}

/** Worlds a manual character may move to: active, same world type, not its current world. */
function candidateWorlds(prisma: PrismaClient, current: World): Promise<World[]> {
  return prisma.world.findMany({ where: { active: true, worldType: current.worldType, id: { not: current.id } } });
}

async function nexonSyncData(prisma: PrismaClient, match: NexonCharacter) {
  return {
    source: 'nexon' as const,
    level: match.level,
    jobName: match.jobName,
    archetype: await resolveArchetype(prisma, match.jobName),
    imageUrl: match.imageUrl,
    syncStatus: 'ok' as const,
    lastSyncedAt: new Date(),
  };
}

/**
 * The owner-triggered refresh (the caller claims the cooldown first). Nexon rows sync as the daily
 * sync does; manual rows convert when found on their own world, or report candidate worlds without writing.
 */
export async function refreshCharacter(
  prisma: PrismaClient,
  nexon: NexonClient,
  row: { id: string; ign: string; source: 'nexon' | 'manual'; world: World },
): Promise<{ outcome: RefreshOutcome; candidates: WorldCandidateDTO[] }> {
  const { id } = row;

  if (row.source === 'nexon') {
    const result = await syncCharacterFromNexon(prisma, nexon, id, { fresh: true });
    return { outcome: result === 'ok' ? 'synced' : 'stale', candidates: [] };
  }

  let found: NexonCharacter[];
  try {
    found = await nexon.findByName(row.ign, { fresh: true });
  } catch (err) {
    if (err instanceof NexonUnavailableError) return { outcome: 'unavailable', candidates: [] };
    throw err;
  }

  const own = found.find((c) => c.nexonWorldId === row.world.nexonWorldId);
  if (own) {
    await prisma.character.update({ where: { id }, data: await nexonSyncData(prisma, own) });
    return { outcome: 'synced', candidates: [] };
  }

  const worlds = new Map((await candidateWorlds(prisma, row.world)).map((w) => [w.nexonWorldId, w]));
  const candidates = found
    .flatMap((c) => {
      const world = worlds.get(c.nexonWorldId);
      return world ? [{ worldId: world.id, worldName: world.name, level: c.level, jobName: c.jobName, imageUrl: c.imageUrl }] : [];
    })
    .sort((a, b) => a.worldName.localeCompare(b.worldName, 'en', { sensitivity: 'base' }));
  return candidates.length > 0 ? { outcome: 'found_elsewhere', candidates } : { outcome: 'not_found', candidates: [] };
}

export interface MoveCharacterInput {
  worldId: number;
  guildId: string | null;
}

/** Moves a manual character to a candidate world where Nexon lists it, converting it to a synced character. */
export async function moveCharacterWorld(
  prisma: PrismaClient,
  nexon: NexonClient,
  userId: string,
  id: string,
  input: MoveCharacterInput,
): Promise<CharacterRow> {
  const row = await getOwnedCharacter(prisma, id, userId);
  if (row.source !== 'manual') throw new AppError(400, 'NOT_MANUAL', 'Only manually added characters can change world');

  const target = (await candidateWorlds(prisma, row.world)).find((w) => w.id === input.worldId);
  if (!target) throw new AppError(400, 'WRONG_WORLD', "That world isn't an option for this character");
  if (input.guildId !== null) await requireActiveGuild(prisma, input.guildId);

  const match = (await findOnNexon(nexon, row.ign, { fresh: true })).find((c) => c.nexonWorldId === target.nexonWorldId);
  if (!match) throw new AppError(404, 'CHARACTER_NOT_FOUND', 'Character not found on that world');
  const data = await nexonSyncData(prisma, match);

  const now = new Date();
  return mapAlreadyClaimed(() =>
    prisma.$transaction(async (tx) => {
      // Lock the character, then re-check. Join, invite and accept lock only the post, but inserting a
      // member or request row takes a FOR KEY SHARE lock on this character (the FK), which conflicts with
      // FOR UPDATE. So a join that inserted first makes this wait, and the re-check below then sees it.
      // A join that starts after this lock waits for the move to commit. This transaction locks no post,
      // so the lock order (post, then character) can't deadlock.
      // Known gap: a join that validated the character's world before this lock and inserts after the
      // move commits still succeeds (the id is unchanged, so KEY SHARE is granted). Closing it would need
      // FOR SHARE on the character in the join, invite and accept paths.
      await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${id} FOR UPDATE`;
      const [membership, pending] = await Promise.all([
        tx.postMember.findFirst({
          where: { characterId: id, post: { deletedAt: null, expiresAt: { gt: now }, OR: [{ status: { in: ['open', 'full'] } }, { status: 'closed', closedReason: 'finalized' }] } },
          select: { id: true },
        }),
        tx.request.findFirst({ where: { characterId: id, status: 'pending' }, select: { id: true } }),
      ]);
      if (membership || pending) throw new AppError(409, 'IN_PARTY', 'Leave or close your open parties first');
      return tx.character.update({
        where: { id },
        data: { ...data, worldId: target.id, guildId: input.guildId },
        include: characterInclude,
      });
    }),
  );
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
): Promise<{ closedPostIds: string[]; declinedRequestIds: string[]; screenshotKey: string | null }> {
  return prisma.$transaction(async (tx) => {
    const { closedPostIds, declinedIds: declined } = await closeLivePosts(tx, { posterCharacterId: id }, 'character_deleted');
    const character = await tx.character.delete({ where: { id }, select: { screenshotKey: true } });
    // The character's own requests cascade away with it; only the survivors still need an event.
    const survivors = await tx.request.findMany({ where: { id: { in: declined } }, select: { id: true } });
    return { closedPostIds, declinedRequestIds: survivors.map((r) => r.id), screenshotKey: character.screenshotKey };
  });
}
