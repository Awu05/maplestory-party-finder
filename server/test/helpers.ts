import os from 'node:os';
import path from 'node:path';
import { PrismaClient, type Boss, type BossDifficulty, type Character, type Guild, type Prisma, type User, type World } from '@prisma/client';
import type { Config } from '../src/config.js';
import { testDatabaseUrl } from './testDatabaseUrl.js';

export const prisma = new PrismaClient({ datasources: { db: { url: testDatabaseUrl() } } });

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    databaseUrl: testDatabaseUrl(),
    sessionSecret: 'test-session-secret-at-least-32-characters-long',
    discordClientId: 'test-client-id',
    discordClientSecret: 'test-client-secret',
    discordRedirectUri: 'http://localhost:3000/api/auth/discord/callback',
    webOrigin: 'http://localhost:5173',
    adminDiscordIds: ['admin-1'],
    uploadDir: path.join(os.tmpdir(), 'pf-test-uploads'),
    ...overrides,
  };
}

export async function resetDb(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length === 0) return;
  const list = tables.map((t) => `"${t.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

let seq = 0;
const next = () => ++seq;

export function makeUser(over: Partial<User> = {}): Promise<User> {
  const n = next();
  return prisma.user.create({ data: { discordId: `discord-${n}`, username: `user${n}`, ...over } });
}

export function makeWorld(over: Partial<World> = {}): Promise<World> {
  return prisma.world.create({ data: { nexonWorldId: 45, name: 'Kronos', worldType: 'heroic', ...over } });
}

export function makeGuild(over: { worldIds?: number[] } & Partial<Guild> = {}): Promise<Guild> {
  const { worldIds = [], ...rest } = over;
  return prisma.guild.create({
    data: {
      name: `Guild ${next()}`,
      ...rest,
      worlds: { create: worldIds.map((worldId) => ({ worldId })) },
    },
  });
}

export async function makeBossDifficulty(
  over: Partial<BossDifficulty> & { bossName?: string } = {},
): Promise<BossDifficulty & { boss: Boss }> {
  const { bossName, ...rest } = over;
  const bossId = rest.bossId ?? (await prisma.boss.create({ data: { name: bossName ?? `Boss ${next()}` } })).id;
  return prisma.bossDifficulty.create({
    data: { difficulty: 'Normal', ...rest, bossId },
    include: { boss: true },
  });
}

export async function makeCharacter(over: Partial<Prisma.CharacterUncheckedCreateInput> = {}): Promise<Character> {
  const n = next();
  const ownerId = over.ownerId ?? (await makeUser()).id;
  const worldId = over.worldId ?? (await prisma.world.findFirst())?.id ?? (await makeWorld()).id;
  const guildId = over.guildId ?? (await makeGuild({ worldIds: [worldId] })).id;
  const ign = over.ign ?? `Char${n}`;
  return prisma.character.create({
    data: {
      ign,
      ignLower: ign.toLowerCase(),
      jobName: 'Hero',
      level: 275,
      imageUrl: 'https://example.com/char.png',
      combatPower: 1_000_000n,
      cpUpdatedAt: new Date(),
      lastSyncedAt: new Date(),
      ...over,
      ownerId,
      worldId,
      guildId,
    },
  });
}
