import type { Prisma, PrismaClient } from '@prisma/client';
import {
  effectivePostStatus, FLEXIBLE_TTL_MS, MAX_SCHEDULE_AHEAD_MS, maxPartySizeFor, MIN_PARTY_SIZE, postExpiresAt, SCHEDULE_PAST_TOLERANCE_MS,
  type PostType,
} from '@pf/shared';
import type { Viewer } from '../auth/guards.js';
import { getOwnedCharacter } from '../characters/service.js';
import { AppError } from '../http/errors.js';
import { autoDeclinePending } from '../requests/autoDecline.js';
import { postInclude, postSummaryInclude, type PostRow, type PostSummaryRow } from './serialize.js';
import { memberSnapshot, parseSnapshot } from './snapshot.js';

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

type Db = PrismaClient | Prisma.TransactionClient;

/** Loads the difficulties for `ids`, throwing 400 VALIDATION if any is unknown. */
async function validateBosses(db: Db, ids: number[]) {
  const difficulties = await db.bossDifficulty.findMany({ where: { id: { in: ids } } });
  if (difficulties.length !== ids.length) throw new AppError(400, 'VALIDATION', 'Unknown bossDifficultyId');
  return difficulties;
}

/** LFP posts take no partySize/minCp; Recruiting needs a partySize within [MIN_PARTY_SIZE, cap of the boss set]. */
function validateRecruitingFields(
  type: PostType,
  partySize: number | null | undefined,
  minCp: number | null | undefined,
  caps: number[],
): void {
  if (type === 'lfp') {
    if ((partySize !== undefined && partySize !== null) || (minCp !== undefined && minCp !== null)) {
      throw new AppError(400, 'VALIDATION', 'partySize and minCp are only for recruiting posts');
    }
    return;
  }
  const max = maxPartySizeFor(caps);
  if (partySize === undefined || partySize === null || partySize < MIN_PARTY_SIZE || partySize > max) {
    throw new AppError(400, 'VALIDATION', `partySize must be between ${MIN_PARTY_SIZE} and ${max}`);
  }
}

/** The caller's own character, which must belong to an active guild in an active world. */
async function getPostingCharacter(db: Db, characterId: string, userId: string) {
  const character = await getOwnedCharacter(db, characterId, userId);
  if (character.guildId === null) throw new AppError(400, 'NO_GUILD', 'Pick a guild for this character first');
  const guild = await db.guild.findUnique({ where: { id: character.guildId } });
  if (!guild || !guild.active) throw new AppError(400, 'GUILD_INACTIVE', 'That guild is not accepting posts');
  if (!character.world.active) throw new AppError(400, 'WORLD_INACTIVE', 'That world is not active');
  return character as typeof character & { guildId: string };
}

export async function createPost(prisma: PrismaClient, userId: string, input: CreatePostInput): Promise<PostRow> {
  const character = await getPostingCharacter(prisma, input.characterId, userId);

  const now = new Date();
  if (input.scheduledAt) assertScheduleWindow(input.scheduledAt, now);

  const difficulties = await validateBosses(prisma, input.bossDifficultyIds);
  validateRecruitingFields(input.type, input.partySize, input.minCp, difficulties.map((d) => d.partyCap));

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

export async function listBoard(prisma: PrismaClient, f: BoardFilter, now: Date): Promise<PostSummaryRow[]> {
  const and: Prisma.PostWhereInput[] = [];
  if (f.bossId !== undefined) and.push({ bosses: { some: { bossDifficulty: { bossId: f.bossId } } } });
  if (f.bossDifficultyId !== undefined) and.push({ bosses: { some: { bossDifficultyId: f.bossDifficultyId } } });
  return prisma.post.findMany({
    where: {
      deletedAt: null,
      status: 'open',
      expiresAt: { gt: now },
      posterUser: { banned: false },
      ...(f.type ? { type: f.type } : {}),
      ...(f.guildId ? { guildId: f.guildId } : {}),
      ...(f.worldIds ? { worldId: { in: f.worldIds } } : {}),
      // A range comparison never matches NULL, so from/to exclude flexible posts.
      ...(f.from || f.to ? { scheduledAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lte: f.to } : {}) } } : {}),
      ...(f.flexible ? { scheduledAt: null } : {}),
      AND: and,
    },
    include: postSummaryInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 100,
  });
}

export function listMyPosts(prisma: PrismaClient, userId: string): Promise<PostSummaryRow[]> {
  return prisma.post.findMany({
    where: { posterUserId: userId, deletedAt: null },
    include: postSummaryInclude,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}

/** Parties (>= 2 members) the user belongs to, deleted ones included: scheduledAt desc (nulls last), then createdAt desc. */
export async function listMyParties(prisma: PrismaClient, userId: string): Promise<PostRow[]> {
  const ids = await prisma.$queryRaw<{ id: string }[]>`
    SELECT p.id FROM "Post" p
    WHERE EXISTS (SELECT 1 FROM "PostMember" m WHERE m."postId" = p.id AND m."userId" = ${userId})
      AND (SELECT count(*) FROM "PostMember" m2 WHERE m2."postId" = p.id) >= 2
    ORDER BY p."scheduledAt" DESC NULLS LAST, p."createdAt" DESC, p.id DESC
    LIMIT 100`;
  const rows = await prisma.post.findMany({ where: { id: { in: ids.map((r) => r.id) } }, include: postInclude });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((r) => byId.get(r.id)).filter((r): r is PostRow => r !== undefined);
}

/** Open/full posts are public; anything else is visible only to the poster, members and admin (else 404). */
export async function getVisiblePost(prisma: PrismaClient, id: string, viewer: Viewer | null, now: Date): Promise<PostRow> {
  const row = await prisma.post.findUnique({ where: { id }, include: postInclude });
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Post not found');
  assertVisible(row, viewer, now);
  return row;
}

/** Throws the same 404 as getVisiblePost when `viewer` may not see `row`. */
export function assertVisible(row: PostRow, viewer: Viewer | null, now: Date): void {
  if (effectivePostStatus(row, now) !== 'closed') return;
  const uid = viewer?.user.id;
  if (viewer && (viewer.isAdmin || row.posterUserId === uid || row.members.some((m) => m.userId === uid))) return;
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

export interface LeaveResult {
  post: PostRow;
  reopened: boolean;
  /** The member's own LFP post, reopened because they had left it closed by accepting an invite here. */
  reopenedLfpPostId: string | null;
  member: { id: string; userId: string; ign: string };
  removedBy: 'self' | 'poster';
}

/**
 * Reopens the LFP post that `characterId` closed by accepting an invite to `recruitingPostId`, if it is
 * still closed as lfp_matched, not deleted and not expired. The caller holds the recruiting post's
 * lock, so the LFP post is locked second, as everywhere else.
 */
async function reopenMatchedLfpPost(
  tx: Prisma.TransactionClient,
  recruitingPostId: string,
  characterId: string,
  now: Date,
): Promise<string | null> {
  const invite = await tx.request.findFirst({
    where: { kind: 'invite', status: 'accepted', postId: recruitingPostId, characterId, lfpPostId: { not: null } },
    orderBy: [{ decidedAt: 'desc' }, { id: 'desc' }],
    select: { lfpPostId: true },
  });
  if (!invite?.lfpPostId) return null;
  await tx.$queryRaw`SELECT id FROM "Post" WHERE id = ${invite.lfpPostId} FOR UPDATE`;
  // Read after the lock; null if it was hard-deleted meanwhile.
  const lfp = await tx.post.findUnique({ where: { id: invite.lfpPostId } });
  if (!lfp || lfp.status !== 'closed' || lfp.closedReason !== 'lfp_matched' || lfp.deletedAt !== null) return null;
  if (lfp.expiresAt.getTime() <= now.getTime()) return null;
  // Still in another live party (e.g. joined one by join request): the character is not looking.
  const otherParty = await tx.postMember.findFirst({
    where: {
      characterId,
      postId: { not: recruitingPostId },
      post: { deletedAt: null, status: { in: ['open', 'full'] }, expiresAt: { gt: now } },
    },
    select: { id: true },
  });
  if (otherParty) return null;
  await tx.post.update({ where: { id: lfp.id }, data: { status: 'open', closedReason: null } });
  return lfp.id;
}

/**
 * The member's owner leaves, or the poster removes them, while the party is live. Reopens a full post,
 * and the member's LFP post if joining this party is what closed it.
 */
export async function removeMember(prisma: PrismaClient, viewer: Viewer, postId: string, memberId: string, now: Date): Promise<LeaveResult> {
  return prisma.$transaction(async (tx) => {
    const row = await loadPostForUpdate(tx, postId);
    const member = row.members.find((m) => m.id === memberId);
    if (!member) throw new AppError(404, 'NOT_FOUND', 'Member not found');
    const self = member.userId === viewer.user.id;
    if (!self && row.posterUserId !== viewer.user.id) throw new AppError(403, 'NOT_ALLOWED', 'You cannot remove that member');
    if (member.role === 'poster') throw new AppError(409, 'CANNOT_LEAVE_OWN_POST', 'The poster cannot leave their own post');
    // An ended party (deleted, closed or expired) keeps its lineup as a record.
    if (effectivePostStatus(row, now) === 'closed') throw new AppError(409, 'POST_CLOSED', 'Post is closed');
    await tx.postMember.delete({ where: { id: memberId } });
    const reopenedLfpPostId = member.characterId === null ? null : await reopenMatchedLfpPost(tx, postId, member.characterId, now);
    const reopened = row.status === 'full';
    const post = await tx.post.update({
      where: { id: postId },
      data: reopened ? { status: 'open', closedReason: null } : {},
      include: postInclude,
    });
    return {
      post,
      reopened,
      reopenedLfpPostId,
      member: { id: member.id, userId: member.userId, ign: parseSnapshot(member.snapshot).ign },
      removedBy: self ? 'self' : 'poster',
    };
  });
}

export interface EditPostInput {
  type?: PostType;
  characterId?: string;
  bossDifficultyIds?: number[];
  scheduledAt?: Date | null;
  partySize?: number;
  minCp?: number | null;
  note?: string;
}

export interface EditResult {
  post: PostRow;
  declinedRequestIds: string[];
  reopened: boolean;
  becameFull: boolean;
}

/** Poster edits any field. The resulting post is validated as a whole, then applied. */
export async function editPost(prisma: PrismaClient, viewer: Viewer, id: string, input: EditPostInput, now: Date): Promise<EditResult> {
  return prisma.$transaction(async (tx) => {
    const row = await loadPostForUpdate(tx, id);
    assertPoster(row, viewer);
    // Only a new time can bring back an expired post; edits never extend expiry (Renew does that).
    const scheduleChanged = input.scheduledAt !== undefined;
    if (row.status === 'closed' || row.deletedAt !== null || (effectivePostStatus(row, now) === 'closed' && !scheduleChanged)) {
      throw new AppError(409, 'POST_CLOSED', 'Post is closed');
    }

    const type = input.type ?? row.type;
    const typeChanged = type !== row.type;
    const characterChanged = input.characterId !== undefined && input.characterId !== row.posterCharacterId;
    const memberCount = row.members.length;
    if ((typeChanged || characterChanged) && memberCount > 1) {
      throw new AppError(409, 'HAS_MEMBERS', 'Type and character cannot change once someone has joined');
    }

    const character = characterChanged ? await getPostingCharacter(tx, input.characterId!, viewer.user.id) : null;
    const worldChanged = character !== null && character.worldId !== row.worldId;

    const scheduledAt = input.scheduledAt !== undefined ? input.scheduledAt : row.scheduledAt;
    if (input.scheduledAt) assertScheduleWindow(input.scheduledAt, now);
    const expiresAt = scheduleChanged ? postExpiresAt(scheduledAt, now) : row.expiresAt;

    const bossesChanged = input.bossDifficultyIds !== undefined;
    const caps = bossesChanged
      ? (await validateBosses(tx, input.bossDifficultyIds!)).map((d) => d.partyCap)
      : row.bosses.map((b) => b.bossDifficulty.partyCap);

    let partySize: number | null;
    let minCp: bigint | null;
    if (type === 'lfp') {
      validateRecruitingFields(type, input.partySize, input.minCp, caps);
      partySize = null;
      minCp = null;
    } else {
      const resultingParty = input.partySize ?? row.partySize;
      if (typeChanged || bossesChanged || input.partySize !== undefined) validateRecruitingFields(type, resultingParty, null, caps);
      if (resultingParty !== null && resultingParty < memberCount) {
        throw new AppError(409, 'PARTY_TOO_SMALL', 'partySize is smaller than the current party');
      }
      partySize = resultingParty;
      minCp = input.minCp === undefined ? row.minCp : input.minCp === null ? null : BigInt(input.minCp);
    }

    const becameFull = type === 'recruiting' && row.status === 'open' && partySize === memberCount;
    const reopened =
      type === 'recruiting' && row.status === 'full' && partySize !== null && memberCount < partySize && expiresAt.getTime() > now.getTime();

    // Type or world changes void everything tied to the post; an LFP post's invites name its character,
    // so a new character voids them too; filling it only voids its own requests.
    const declineWhere =
      typeChanged || worldChanged || (characterChanged && type === 'lfp') ? postRequests(id) : becameFull ? { postId: id } : null;
    const declinedRequestIds = declineWhere ? await autoDeclinePending(tx, declineWhere) : [];

    if (character) {
      await tx.postMember.updateMany({
        where: { postId: id, role: 'poster' },
        data: { characterId: character.id, cpAtJoin: character.combatPower, snapshot: { ...memberSnapshot(character) } },
      });
    }

    const post = await tx.post.update({
      where: { id },
      data: {
        type,
        scheduledAt,
        expiresAt,
        partySize,
        minCp,
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(character ? { posterCharacterId: character.id, worldId: character.worldId, guildId: character.guildId } : {}),
        ...(bossesChanged
          ? { bosses: { deleteMany: {}, create: input.bossDifficultyIds!.map((bossDifficultyId) => ({ bossDifficultyId })) } }
          : {}),
        ...(becameFull ? { status: 'full', closedReason: 'full' } : reopened ? { status: 'open', closedReason: null } : {}),
      },
      include: postInclude,
    });
    return { post, declinedRequestIds, reopened, becameFull };
  });
}
