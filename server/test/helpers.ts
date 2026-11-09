import type { FastifyInstance } from 'fastify';
import { buildApp, type AppDeps } from '../src/app.js';
import type { DiscordOAuth } from '../src/auth/discordOAuth.js';
import fs from 'node:fs';
import os from 'node:os';
import { LocalDiskStorage, type Storage } from '../src/storage/storage.js';
import path from 'node:path';
import { PrismaClient, type Boss, type BossDifficulty, type Character, type Guild, type Post, type PostMember, type Prisma, type User, type World } from '@prisma/client';
import type { Config } from '../src/config.js';
import type { NexonCharacter, NexonClient } from '../src/nexon/client.js';
import { NexonUnavailableError } from '../src/nexon/client.js';
import type { DomainEvent, DomainEvents } from '../src/events.js';
import { testDatabaseUrl } from './testDatabaseUrl.js';
import { EventDispatcher } from '../src/notifications/dispatcher.js';
import type { SendResult, WebhookSender } from '../src/discord/sender.js';
import type { WebhookPayload } from '../src/discord/messages.js';

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

export class RecordingEvents implements DomainEvents {
  events: DomainEvent[] = [];

  emit(event: DomainEvent): void {
    this.events.push(event);
  }

  clear(): void {
    this.events = [];
  }
}

const HOUR = 3_600_000;

export async function makePost(
  over: Partial<Prisma.PostUncheckedCreateInput> & { bossDifficultyIds?: number[] } = {},
): Promise<Post> {
  const { bossDifficultyIds = [], ...rest } = over;
  const poster = rest.posterCharacterId
    ? await prisma.character.findUniqueOrThrow({ where: { id: rest.posterCharacterId }, include: { world: true, guild: true } })
    : await makeCharacter({ ...(rest.posterUserId ? { ownerId: rest.posterUserId } : {}), ...(rest.worldId ? { worldId: rest.worldId } : {}), ...(rest.guildId ? { guildId: rest.guildId } : {}) }).then((c) =>
        prisma.character.findUniqueOrThrow({ where: { id: c.id }, include: { world: true, guild: true } }),
      );
  const scheduledAt = rest.scheduledAt === undefined ? new Date(Date.now() + 24 * HOUR) : rest.scheduledAt;
  const createdAt = rest.createdAt ? new Date(rest.createdAt) : new Date();
  const expiresAt = scheduledAt
    ? new Date(new Date(scheduledAt).getTime() + 3 * HOUR)
    : new Date(createdAt.getTime() + 7 * 24 * HOUR);
  const post = await prisma.post.create({
    data: {
      type: 'recruiting',
      partySize: 4,
      ...rest,
      scheduledAt,
      expiresAt: rest.expiresAt ?? expiresAt,
      posterUserId: rest.posterUserId ?? poster.ownerId,
      posterCharacterId: poster.id,
      worldId: rest.worldId ?? poster.worldId,
      guildId: rest.guildId ?? poster.guildId,
      bosses: { create: bossDifficultyIds.map((bossDifficultyId) => ({ bossDifficultyId })) },
    },
  });
  await prisma.postMember.create({
    data: {
      postId: post.id,
      characterId: poster.id,
      userId: poster.ownerId,
      role: 'poster',
      cpAtJoin: poster.combatPower,
      snapshot: {
        ign: poster.ign,
        jobName: poster.jobName,
        level: poster.level,
        imageUrl: poster.imageUrl,
        worldName: poster.world.name,
        guildName: poster.guild.name,
      },
    },
  });
  return post;
}

export async function addMember(postId: string, characterId: string): Promise<PostMember> {
  const c = await prisma.character.findUniqueOrThrow({ where: { id: characterId }, include: { world: true, guild: true } });
  return prisma.postMember.create({
    data: {
      postId,
      characterId,
      userId: c.ownerId,
      role: 'member',
      cpAtJoin: c.combatPower,
      snapshot: {
        ign: c.ign,
        jobName: c.jobName,
        level: c.level,
        imageUrl: c.imageUrl,
        worldName: c.world.name,
        guildName: c.guild.name,
      },
    },
  });
}

export class FakeNexon implements NexonClient {
  private chars: NexonCharacter[] = [];
  private failures = 0;

  set(chars: NexonCharacter[]): void {
    this.chars = chars;
  }

  failNext(): void {
    this.failures++;
  }

  async findByName(ign: string): Promise<NexonCharacter[]> {
    if (this.failures > 0) {
      this.failures--;
      throw new NexonUnavailableError('FakeNexon failure');
    }
    const lower = ign.toLowerCase();
    return this.chars.filter((c) => c.ign.toLowerCase() === lower);
  }
}

export class FakeDiscord implements DiscordOAuth {
  authorizeUrl(state: string): string {
    return `https://discord.test/authorize?state=${state}`;
  }

  async exchangeCode(code: string) {
    const [prefix, discordId, username] = code.split(':');
    if (prefix !== 'fake' || !discordId) throw new Error(`FakeDiscord: bad code ${code}`);
    return { discordId, username: username ?? discordId, avatarUrl: null };
  }
}

export type LogEntry = { obj: object; msg: string };

type TestAppBase = { app: FastifyInstance; nexon: FakeNexon; webhookSender: FakeWebhookSender; storage: Storage; uploadDir: string };

/**
 * `events: 'dispatcher'` wires a real EventDispatcher (logs captured in `logs`); the default
 * records emitted events in a RecordingEvents sink.
 */
export async function buildTestApp(
  over: Omit<Partial<AppDeps>, 'events'> & { events: 'dispatcher' },
): Promise<TestAppBase & { events: EventDispatcher; logs: LogEntry[] }>;
export async function buildTestApp(
  over?: Omit<Partial<AppDeps>, 'events'> & { events?: 'recording' | DomainEvents },
): Promise<TestAppBase & { events: RecordingEvents; logs: LogEntry[] }>;
export async function buildTestApp(
  over: Omit<Partial<AppDeps>, 'events'> & { events?: 'recording' | 'dispatcher' | DomainEvents } = {},
): Promise<TestAppBase & { events: DomainEvents; logs: LogEntry[] }> {
  const { events: eventsOpt, ...rest } = over;
  const nexon = new FakeNexon();
  const webhookSender = new FakeWebhookSender();
  const uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-uploads-'));
  const storage = rest.storage ?? new LocalDiskStorage(uploadDir);
  const config = rest.config ?? testConfig({ uploadDir });
  const logs: LogEntry[] = [];
  const events: DomainEvents =
    eventsOpt === 'dispatcher'
      ? new EventDispatcher({ prisma, storage, webOrigin: config.webOrigin, log: { error: (obj, msg) => logs.push({ obj, msg }) } })
      : eventsOpt === undefined || eventsOpt === 'recording'
        ? new RecordingEvents()
        : eventsOpt;
  const app = await buildApp({
    nexon,
    prisma,
    discord: new FakeDiscord(),
    webhookSender,
    ...rest,
    config,
    storage,
    events,
  });
  return { app, nexon, webhookSender, storage, uploadDir, events, logs };
}

/** Drives the real redirect + callback flow and returns the session cookie header value. */
export async function loginAs(app: FastifyInstance, discordId = 'u-1', username = 'tester'): Promise<string> {
  const start = await app.inject({ method: 'GET', url: '/api/auth/discord' });
  const state = new URL(String(start.headers.location)).searchParams.get('state')!;
  const cookie1 = String(start.headers['set-cookie']).split(';')[0]!;
  const cb = await app.inject({
    method: 'GET',
    url: `/api/auth/discord/callback?code=${encodeURIComponent(`fake:${discordId}:${username}`)}&state=${state}`,
    headers: { cookie: cookie1 },
  });
  if (cb.statusCode !== 302) throw new Error(`loginAs failed: ${cb.statusCode} ${cb.body}`);
  return String(cb.headers['set-cookie']).split(';')[0]!;
}

export class FakeWebhookSender implements WebhookSender {
  calls: { url: string; payload: WebhookPayload }[] = [];
  private results: SendResult[] = [];

  queue(result: SendResult): void {
    this.results.push(result);
  }

  async send(url: string, payload: WebhookPayload): Promise<SendResult> {
    this.calls.push({ url, payload });
    return this.results.shift() ?? { ok: true };
  }
}
