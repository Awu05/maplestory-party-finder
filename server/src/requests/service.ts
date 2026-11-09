import { Prisma, type PrismaClient } from '@prisma/client';
import { effectivePostStatus } from '@pf/shared';
import type { Viewer } from '../auth/guards.js';
import { AppError } from '../http/errors.js';
import { assertVisible, loadPostForUpdate } from '../posts/service.js';
import { postInclude, type PostRow } from '../posts/serialize.js';
import { memberSnapshot } from '../posts/snapshot.js';
import { autoDeclinePending } from './autoDecline.js';
import { requestInclude, type RequestRow } from './serialize.js';

// Accepts can queue behind each other on the post row lock.
const TX_OPTIONS = { timeout: 10_000, maxWait: 10_000 };

/** Throws 409 POST_CLOSED / POST_FULL unless the post's effective status is open. */
function assertOpen(post: PostRow, now: Date): void {
  const status = effectivePostStatus(post, now);
  if (status === 'closed') throw new AppError(409, 'POST_CLOSED', 'Post is closed');
  if (status === 'full') throw new AppError(409, 'POST_FULL', 'Post is full');
}

const isMember = (post: PostRow, characterId: string) => post.members.some((m) => m.characterId === characterId);

export async function createJoinRequest(
  prisma: PrismaClient,
  viewer: Viewer,
  postId: string,
  characterId: string,
  now: Date,
): Promise<RequestRow> {
  try {
    return await prisma.$transaction(async (tx) => {
      // Locked so a request can't slip in while an accept is filling the party.
      const post = await loadPostForUpdate(tx, postId);
      // Deleted posts are gone for everyone but their party; any other closed post answers POST_CLOSED
      // (an applicant holding the id of a post that just expired gets a useful error, not a 404).
      if (post.deletedAt !== null) assertVisible(post, viewer, now);
      if (post.type !== 'recruiting') throw new AppError(409, 'WRONG_POST_TYPE', 'Only recruiting posts take join requests');
      assertOpen(post, now);
      const character = await tx.character.findUnique({ where: { id: characterId } });
      if (!character) throw new AppError(404, 'NOT_FOUND', 'Character not found');
      if (character.ownerId !== viewer.user.id) throw new AppError(403, 'NOT_OWNER', 'You do not own this character');
      if (character.worldId !== post.worldId) throw new AppError(400, 'WRONG_WORLD', "That character is not on the post's world");
      if (isMember(post, character.id)) throw new AppError(409, 'ALREADY_MEMBER', 'That character is already in the party');
      const pending = await tx.request.count({ where: { postId, characterId, status: 'pending' } });
      if (pending > 0) throw new AppError(409, 'ALREADY_PENDING', 'That character already has a pending request');
      return tx.request.create({
        data: { kind: 'join_request', postId, characterId, createdByUserId: viewer.user.id },
        include: requestInclude,
      });
    }, TX_OPTIONS);
  } catch (err) {
    // Request_one_pending is the only unique index on Request besides its id.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, 'ALREADY_PENDING', 'That character already has a pending request');
    }
    throw err;
  }
}

export async function createInvite(
  prisma: PrismaClient,
  viewer: Viewer,
  lfpPostId: string,
  recruitingPostId: string,
  now: Date,
): Promise<RequestRow> {
  try {
    return await prisma.$transaction(async (tx) => {
      // Lock order everywhere: recruiting post first, then the LFP post.
      const recruiting = await loadPostForUpdate(tx, recruitingPostId);
      const lfp = await loadPostForUpdate(tx, lfpPostId);
      if (lfp.deletedAt !== null) assertVisible(lfp, viewer, now);
      if (lfp.type !== 'lfp') throw new AppError(409, 'WRONG_POST_TYPE', 'Invites come from looking-for-party posts');
      assertOpen(lfp, now);
      if (recruiting.posterUserId !== viewer.user.id) throw new AppError(403, 'NOT_OWNER', 'You do not own that post');
      if (recruiting.type !== 'recruiting') throw new AppError(409, 'WRONG_POST_TYPE', 'Invites go onto recruiting posts');
      assertOpen(recruiting, now);
      if (recruiting.worldId !== lfp.worldId) throw new AppError(400, 'WRONG_WORLD', 'The posts are on different worlds');
      const characterId = lfp.posterCharacterId;
      // The poster's character is nulled out when it is deleted.
      const character = characterId === null ? null : await tx.character.findUnique({ where: { id: characterId } });
      if (!character) throw new AppError(409, 'POST_CLOSED', 'That post is no longer available');
      if (isMember(recruiting, character.id)) throw new AppError(409, 'ALREADY_MEMBER', 'That character is already in the party');
      const pending = await tx.request.count({ where: { postId: recruitingPostId, characterId: character.id, status: 'pending' } });
      if (pending > 0) throw new AppError(409, 'ALREADY_PENDING', 'That character already has a pending request');
      return tx.request.create({
        data: { kind: 'invite', postId: recruitingPostId, characterId: character.id, lfpPostId, createdByUserId: viewer.user.id },
        include: requestInclude,
      });
    }, TX_OPTIONS);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, 'ALREADY_PENDING', 'That character already has a pending request');
    }
    throw err;
  }
}

async function findPostIdOfRequest(prisma: PrismaClient, id: string): Promise<string> {
  const row = await prisma.request.findUnique({ where: { id }, select: { postId: true } });
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Request not found');
  return row.postId;
}

/** Locks the request's post, then re-reads the request so its status is checked under the lock. */
async function lockRequest(tx: Prisma.TransactionClient, id: string, postId: string): Promise<{ post: PostRow; request: RequestRow }> {
  const post = await loadPostForUpdate(tx, postId);
  const request = await tx.request.findUnique({ where: { id }, include: requestInclude });
  if (!request) throw new AppError(404, 'NOT_FOUND', 'Request not found');
  return { post, request };
}

/** join_request: the poster decides. invite: the invited character's owner decides. */
function assertDecider(post: PostRow, request: RequestRow, viewer: Viewer): void {
  const decider = request.kind === 'join_request' ? post.posterUserId : request.character.ownerId;
  if (decider !== viewer.user.id) throw new AppError(403, 'NOT_ALLOWED', 'You cannot decide on this request');
}

function assertPending(request: RequestRow): void {
  if (request.status !== 'pending') throw new AppError(409, 'NOT_PENDING', 'Request is not pending');
}

export type AcceptResult =
  | { ok: true; post: PostRow; declinedRequestIds: string[]; closedLfpPostId: string | null }
  | { ok: false; declinedRequestId: string };

/**
 * Accepts a request under the post row lock so concurrent accepts can never overfill the party.
 * `ok:false` means the character was already a member: the request was declined (committed) and
 * the caller answers 409 ALREADY_MEMBER.
 */
export async function acceptRequest(prisma: PrismaClient, viewer: Viewer, id: string, now: Date): Promise<AcceptResult> {
  const postId = await findPostIdOfRequest(prisma, id);
  return prisma.$transaction(async (tx): Promise<AcceptResult> => {
    let { post, request } = await lockRequest(tx, id, postId);
    // An invite also touches its LFP post: lock it second (never the reverse), then re-read the request.
    let lfp: PostRow | null = null;
    if (request.kind === 'invite' && request.lfpPostId !== null) {
      lfp = await loadPostForUpdate(tx, request.lfpPostId);
      request = await tx.request.findUniqueOrThrow({ where: { id }, include: requestInclude });
    }
    assertDecider(post, request, viewer);
    assertPending(request);
    assertOpen(post, now);
    if (request.character.worldId !== post.worldId) throw new AppError(400, 'WRONG_WORLD', "That character is not on the post's world");
    if (isMember(post, request.characterId)) {
      await tx.request.update({ where: { id }, data: { status: 'declined', decidedAt: now } });
      return { ok: false, declinedRequestId: id };
    }
    // Defensive: status should already say full, but never exceed the party size.
    if (post.partySize !== null && post.members.length >= post.partySize) throw new AppError(409, 'POST_FULL', 'Post is full');

    const { character } = request;
    await tx.postMember.create({
      data: {
        postId,
        characterId: character.id,
        userId: character.ownerId,
        role: 'member',
        cpAtJoin: character.combatPower,
        snapshot: { ...memberSnapshot(character) },
      },
    });
    await tx.request.update({ where: { id }, data: { status: 'accepted', decidedAt: now } });

    let declinedRequestIds: string[] = [];
    if (post.partySize !== null && post.members.length + 1 >= post.partySize) {
      await tx.post.update({ where: { id: postId }, data: { status: 'full', closedReason: 'full' } });
      declinedRequestIds = await autoDeclinePending(tx, { postId });
    }

    let closedLfpPostId: string | null = null;
    if (lfp) {
      if (lfp.status !== 'closed' && lfp.deletedAt === null) {
        await tx.post.update({ where: { id: lfp.id }, data: { status: 'closed', closedReason: 'lfp_matched' } });
        closedLfpPostId = lfp.id;
      }
      declinedRequestIds = declinedRequestIds.concat(await autoDeclinePending(tx, { lfpPostId: lfp.id, id: { not: id } }));
    }
    const updated = await tx.post.findUniqueOrThrow({ where: { id: postId }, include: postInclude });
    return { ok: true, post: updated, declinedRequestIds, closedLfpPostId };
  }, TX_OPTIONS);
}

export async function declineRequest(prisma: PrismaClient, viewer: Viewer, id: string, now: Date): Promise<RequestRow> {
  const postId = await findPostIdOfRequest(prisma, id);
  return prisma.$transaction(async (tx) => {
    const { post, request } = await lockRequest(tx, id, postId);
    assertDecider(post, request, viewer);
    assertPending(request);
    return tx.request.update({ where: { id }, data: { status: 'declined', decidedAt: now }, include: requestInclude });
  }, TX_OPTIONS);
}

/** join_request: the applicant cancels. invite: the poster cancels. */
export async function cancelRequest(prisma: PrismaClient, viewer: Viewer, id: string, now: Date): Promise<RequestRow> {
  const postId = await findPostIdOfRequest(prisma, id);
  return prisma.$transaction(async (tx) => {
    const { post, request } = await lockRequest(tx, id, postId);
    const canceller = request.kind === 'join_request' ? request.character.ownerId : post.posterUserId;
    if (canceller !== viewer.user.id) throw new AppError(403, 'NOT_ALLOWED', 'You cannot cancel this request');
    assertPending(request);
    return tx.request.update({ where: { id }, data: { status: 'cancelled', decidedAt: now }, include: requestInclude });
  }, TX_OPTIONS);
}
