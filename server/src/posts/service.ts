import type { Prisma, PrismaClient } from '@prisma/client';
import {
  effectivePostStatus, FLEXIBLE_TTL_MS, MAX_SCHEDULE_AHEAD_MS, maxPartySizeFor, MIN_PARTY_SIZE, postExpiresAt, SCHEDULE_PAST_TOLERANCE_MS,
  type PostType,
} from '@pf/shared';
import type { Viewer } from '../auth/guards.js';
import { getOwnedCharacter } from '../characters/service.js';
import { AppError } from '../http/errors.js';
import { autoDeclinePending } from '../requests/autoDecline.js';
import { postInclude, type PostRow } from './serialize.js';
import { memberSnapshot } from './snapshot.js';

export interface CreatePostInput {
  type: PostType;
  characterId: string;
  bossDifficultyIds: number[];
  scheduledAt: Date | null;
  partySize?: number;
  minCp?: number;
  note: string;
}

/** Throws 400 VALIDATION unless scheduledAt is within [now - 5min, now + 30d]. */
export function assertScheduleWindow(scheduledAt: Date, now: Date): void {
  const t = scheduledAt.getTime();
  if (t < now.getTime() - SCHEDULE_PAST_TOLERANCE_MS) throw new AppError(400, 'VALIDATION', 'scheduledAt is in the past');
  if (t > now.getTime() + MAX_SCHEDULE_AHEAD_MS) throw new AppError(400, 'VALIDATION', 'scheduledAt is more than 30 days ahead');
}

export async function createPost(prisma: PrismaClient, userId: string, input: CreatePostInput): Promise<PostRow> {
  const character = await getOwnedCharacter(prisma, input.characterId, userId);
  const guild = await prisma.guild.findUnique({ where: { id: character.guildId } });
  if (!guild || !guild.active) throw new AppError(400, 'GUILD_INACTIVE', 'That guild is not accepting posts');
  if (!character.world.active) throw new AppError(400, 'WORLD_INACTIVE', 'That world is not active');

  const now = new Date();
  if (input.scheduledAt) assertScheduleWindow(input.scheduledAt, now);

  const difficulties = await prisma.bossDifficulty.findMany({ where: { id: { in: input.bossDifficultyIds } } });
  if (difficulties.length !== input.bossDifficultyIds.length) throw new AppError(400, 'VALIDATION', 'Unknown bossDifficultyId');

  if (input.type === 'lfp') {
    if (input.partySize !== undefined || input.minCp !== undefined) {
      throw new AppError(400, 'VALIDATION', 'partySize and minCp are only for recruiting posts');
    }
  } else {
    const max = maxPartySizeFor(difficulties.map((d) => d.partyCap));
    if (input.partySize === undefined || input.partySize < MIN_PARTY_SIZE || input.partySize > max) {
      throw new AppError(400, 'VALIDATION', `partySize must be between ${MIN_PARTY_SIZE} and ${max}`);
    }
  }

  return prisma.$transaction((tx) =>
    tx.post.create({
      data: {
        type: input.type,
        posterUserId: userId,
        posterCharacterId: character.id,
        worldId: character.worldId,
        guildId: character.guildId,
        scheduledAt: input.scheduledAt,
        expiresAt: postExpiresAt(input.scheduledAt, now),
        createdAt: now,
        partySize: input.partySize ?? null,
        minCp: input.minCp === undefined ? null : BigInt(input.minCp),
        note: input.note,
        bosses: { create: input.bossDifficultyIds.map((bossDifficultyId) => ({ bossDifficultyId })) },
        members: {
          create: {
            characterId: character.id,
            userId,
            role: 'poster',
            cpAtJoin: character.combatPower,
            snapshot: { ...memberSnapshot(character) },
          },
        },
      },
      include: postInclude,
    }),
  );
}

export interface BoardFilter {
  type?: PostType;
  bossId?: number;
  bossDifficultyId?: number;
  guildId?: string;
  worldIds?: number[];
  from?: Date;
  to?: Date;
  flexible?: boolean;
}

export async function listBoard(prisma: PrismaClient, f: BoardFilter, now: Date): Promise<PostRow[]> {
  const and: Prisma.PostWhereInput[] = [];
  if (f.bossId !== undefined) and.push({ bosses: { some: { bossDifficulty: { bossId: f.bossId } } } });
  if (f.bossDifficultyId !== undefined) and.push({ bosses: { some: { bossDifficultyId: f.bossDifficultyId } } });
  return prisma.post.findMany({
    where: {
      deletedAt: null,
      status: 'open',
      expiresAt: { gt: now },
      ...(f.type ? { type: f.type } : {}),
      ...(f.guildId ? { guildId: f.guildId } : {}),
      ...(f.worldIds ? { worldId: { in: f.worldIds } } : {}),
      // A range comparison never matches NULL, so from/to exclude flexible posts.
      ...(f.from || f.to ? { scheduledAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
      ...(f.flexible ? { scheduledAt: null } : {}),
      AND: and,
    },
    include: postInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 100,
  });
}

/** Open/full posts are public; anything else is visible only to the poster, members and admin (else 404). */
export async function getVisiblePost(prisma: PrismaClient, id: string, viewer: Viewer | null, now: Date): Promise<PostRow> {
  const row = await prisma.post.findUnique({ where: { id }, include: postInclude });
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Post not found');
  if (effectivePostStatus(row, now) !== 'closed') return row;
  const uid = viewer?.user.id;
  if (viewer && (viewer.isAdmin || row.posterUserId === uid || row.members.some((m) => m.userId === uid))) return row;
  throw new AppError(404, 'NOT_FOUND', 'Post not found');
}

/** Locks the post row for the rest of the transaction, then loads it. */
export async function loadPostForUpdate(tx: Prisma.TransactionClient, id: string): Promise<PostRow> {
  await tx.$queryRaw`SELECT id FROM "Post" WHERE id = ${id} FOR UPDATE`;
  const row = await tx.post.findUnique({ where: { id }, include: postInclude });
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Post not found');
  return row;
}

function assertPoster(post: PostRow, viewer: Viewer): void {
  if (post.posterUserId !== viewer.user.id) throw new AppError(403, 'NOT_OWNER', 'Only the poster can do that');
}

const postRequests = (postId: string): Prisma.RequestWhereInput => ({ OR: [{ postId }, { lfpPostId: postId }] });

export interface LifecycleResult {
  post: PostRow;
  declinedRequestIds: string[];
}

export async function closePost(prisma: PrismaClient, viewer: Viewer, id: string): Promise<LifecycleResult> {
  return prisma.$transaction(async (tx) => {
    const row = await loadPostForUpdate(tx, id);
    assertPoster(row, viewer);
    if (row.status === 'closed' || row.deletedAt !== null) throw new AppError(409, 'POST_CLOSED', 'Post is already closed');
    const declinedRequestIds = await autoDeclinePending(tx, postRequests(id));
    const post = await tx.post.update({ where: { id }, data: { status: 'closed', closedReason: 'manual' }, include: postInclude });
    return { post, declinedRequestIds };
  });
}

/** Hard-deletes a post that only has its poster; otherwise soft-deletes it. */
export async function deletePost(prisma: PrismaClient, viewer: Viewer, id: string): Promise<{ hardDeleted: boolean; declinedRequestIds: string[] }> {
  return prisma.$transaction(async (tx) => {
    const row = await loadPostForUpdate(tx, id);
    assertPoster(row, viewer);
    if (row.deletedAt !== null) throw new AppError(404, 'NOT_FOUND', 'Post not found');
    const declined = await autoDeclinePending(tx, postRequests(id));
    if (row.members.length <= 1) {
      await tx.post.delete({ where: { id } });
      // Requests on this post cascade away; only invites that referenced it as their LFP post survive.
      const survivors = await tx.request.findMany({ where: { id: { in: declined } }, select: { id: true } });
      return { hardDeleted: true, declinedRequestIds: survivors.map((r) => r.id) };
    }
    await tx.post.update({ where: { id }, data: { deletedAt: new Date() } });
    return { hardDeleted: false, declinedRequestIds: declined };
  });
}

export async function renewPost(prisma: PrismaClient, viewer: Viewer, id: string, now: Date): Promise<PostRow> {
  return prisma.$transaction(async (tx) => {
    const row = await loadPostForUpdate(tx, id);
    assertPoster(row, viewer);
    if (row.scheduledAt !== null) throw new AppError(409, 'NOT_FLEXIBLE', 'Only flexible posts can be renewed');
    if (row.status === 'closed' || row.deletedAt !== null) throw new AppError(409, 'POST_CLOSED', 'Post is closed');
    return tx.post.update({ where: { id }, data: { expiresAt: new Date(now.getTime() + FLEXIBLE_TTL_MS) }, include: postInclude });
  });
}

/** Admin hard delete. Requests on the post cascade; invites referencing it as LFP post are declined first. */
export async function adminDeletePost(prisma: PrismaClient, id: string): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    await loadPostForUpdate(tx, id);
    const declined = await autoDeclinePending(tx, postRequests(id));
    await tx.post.delete({ where: { id } });
    const survivors = await tx.request.findMany({ where: { id: { in: declined } }, select: { id: true } });
    return survivors.map((r) => r.id);
  });
}
