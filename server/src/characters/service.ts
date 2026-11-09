import { Prisma, type PrismaClient } from '@prisma/client';
import type { NexonCharacterPreview } from '@pf/shared';
import { AppError } from '../http/errors.js';
import { NexonUnavailableError, type NexonClient, type NexonCharacter } from '../nexon/client.js';
import { characterInclude, type CharacterRow } from './serialize.js';

export interface CreateCharacterInput {
  ign: string;
  nexonWorldId: number;
  combatPower: number;
  guildId: string;
  bosses: { bossDifficultyId: number; experience: 'learning' | 'cleared' | 'can_carry' }[];
  playTimes: number[];
  note: string;
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

export async function createCharacter(
  deps: { prisma: PrismaClient; nexon: NexonClient },
  ownerId: string,
  input: CreateCharacterInput,
): Promise<CharacterRow> {
  const { prisma } = deps;

  const guild = await prisma.guild.findUnique({ where: { id: input.guildId } });
  if (!guild || !guild.active) throw new AppError(400, 'GUILD_INACTIVE', 'That guild is not accepting characters');

  const ids = input.bosses.map((b) => b.bossDifficultyId);
  if (new Set(ids).size !== ids.length) throw new AppError(400, 'VALIDATION', 'Duplicate bossDifficultyId');
  if ((await prisma.bossDifficulty.count({ where: { id: { in: ids } } })) !== ids.length) {
    throw new AppError(400, 'VALIDATION', 'Unknown bossDifficultyId');
  }

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
          note: input.note,
          playTimes: [...input.playTimes].sort((a, b) => a - b),
          bosses: { create: input.bosses },
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
