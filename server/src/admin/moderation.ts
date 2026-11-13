import type { FastifyInstance } from 'fastify';
import type { Prisma, PrismaClient, User } from '@prisma/client';
import { z } from 'zod';
import type { AdminPostDTO, AdminUserDTO } from '@pf/shared';
import { isAdminUser, requireAdmin } from '../auth/guards.js';
import { toCharacterDTO } from '../characters/serialize.js';
import { deleteCharacter, getCharacter, listCharacters } from '../characters/service.js';
import { AppError } from '../http/errors.js';
import { postSummaryInclude, toPostSummaryDTO } from '../posts/serialize.js';
import { closeLivePosts } from '../posts/lifecycle.js';

const idParam = z.object({ id: z.string().min(1) });
const usersQuery = z.object({ q: z.string().trim().optional(), status: z.enum(['all', 'active', 'deleted']).default('all') });
const banBody = z.object({ banned: z.boolean() });
const reassignBody = z.object({ userId: z.string().min(1) });
const postsQuery = z.object({
  status: z.enum(['open', 'full', 'closed', 'deleted', 'all']).default('all'),
  q: z.string().trim().optional(),
});

/**
 * Applies `data` (a ban, or a soft delete), closes the user's live posts and auto-declines everything pending
 * on them plus their own requests.
 */
async function deactivateUser(
  prisma: PrismaClient, userId: string, data: Prisma.UserUpdateInput,
): Promise<{ closedPostIds: string[]; declinedRequestIds: string[] }> {
  return prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data });
    const { closedPostIds, declinedIds: declinedRequestIds } = await closeLivePosts(tx, { posterUserId: userId }, 'banned', {
      character: { ownerId: userId },
    });
    return { closedPostIds, declinedRequestIds };
  });
}

/** Moves a character (and what hangs off it) to another user; returns the ids of requests it cancelled. */
async function reassignCharacter(prisma: PrismaClient, characterId: string, userId: string): Promise<string[]> {
  return prisma.$transaction(async (tx) => {
    const character = await tx.character.findUnique({ where: { id: characterId } });
    if (!character) throw new AppError(404, 'NOT_FOUND', 'Character not found');
    const target = await tx.user.findUnique({ where: { id: userId } });
    // A banned or deleted owner's characters are hidden from everyone, so the move would make it vanish.
    if (!target || target.banned || target.deletedAt) throw new AppError(400, 'VALIDATION', 'Target user must exist and not be banned or deleted');

    const pending = await tx.request.findMany({ where: { characterId, status: 'pending' }, select: { id: true } });
    await tx.request.updateMany({
      where: { id: { in: pending.map((r) => r.id) }, status: 'pending' },
      data: { status: 'cancelled', decidedAt: new Date() },
    });
    await tx.character.update({ where: { id: characterId }, data: { ownerId: userId } });
    await tx.postMember.updateMany({ where: { characterId }, data: { userId } });
    // The new owner must be able to manage the posts this character posted.
    await tx.post.updateMany({ where: { posterCharacterId: characterId }, data: { posterUserId: userId } });
    return pending.map((r) => r.id);
  });
}

export async function adminModerationRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, config, events, storage } = app.deps;

  const userInclude = { _count: { select: { characters: true } } } as const;
  const toUserDTO = (u: User & { _count: { characters: number } }): AdminUserDTO => ({
    id: u.id,
    discordUsername: u.username,
    displayName: u.displayName,
    avatarUrl: u.avatar,
    banned: u.banned,
    deletedAt: u.deletedAt?.toISOString() ?? null,
    isAdmin: isAdminUser(u, config),
    createdAt: u.createdAt.toISOString(),
    characterCount: u._count.characters,
    discordLinked: u.discordId !== null,
  });

  app.get('/admin/users', async (req) => {
    await requireAdmin(req);
    const { q, status } = usersQuery.parse(req.query);
    const users = await prisma.user.findMany({
      where: {
        ...(status === 'deleted' ? { deletedAt: { not: null } } : status === 'active' ? { deletedAt: null } : {}),
        ...(q ? { OR: [
          { username: { startsWith: q, mode: 'insensitive' } },
          { displayName: { startsWith: q, mode: 'insensitive' } },
        ] } : {}),
      },
      include: userInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
    });
    return users.map(toUserDTO);
  });

  app.patch('/admin/users/:id', async (req) => {
    const admin = await requireAdmin(req);
    const { id } = idParam.parse(req.params);
    const { banned } = banBody.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new AppError(404, 'NOT_FOUND');
    if (banned && (user.id === admin.user.id || isAdminUser(user, config))) {
      throw new AppError(400, 'CANNOT_BAN_ADMIN', 'Admins cannot be banned');
    }
    if (banned && !user.banned) {
      const { closedPostIds, declinedRequestIds } = await deactivateUser(prisma, id, { banned: true });
      closedPostIds.forEach((postId) => events.emit({ type: 'post.closed', postId, reason: 'banned' }));
      declinedRequestIds.forEach((requestId) =>
        events.emit({ type: 'request.declined', requestId, auto: true, actorUserId: admin.user.id }),
      );
    } else if (!banned) {
      await prisma.user.update({ where: { id }, data: { banned: false } });
    }
    return toUserDTO(await prisma.user.findUniqueOrThrow({ where: { id }, include: userInclude }));
  });

  // Soft delete: the account can't sign in and its open posts close (as for a ban); nothing is destroyed.
  app.delete('/admin/users/:id', async (req) => {
    const admin = await requireAdmin(req);
    const { id } = idParam.parse(req.params);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) throw new AppError(404, 'NOT_FOUND');
    if (user.id === admin.user.id || isAdminUser(user, config)) {
      throw new AppError(400, 'CANNOT_DELETE_ADMIN', 'Admins cannot be deleted');
    }
    if (!user.deletedAt) {
      // Bumping the session version signs them out everywhere.
      const { closedPostIds, declinedRequestIds } = await deactivateUser(prisma, id, { deletedAt: new Date(), sessionVersion: { increment: 1 } });
      closedPostIds.forEach((postId) => events.emit({ type: 'post.closed', postId, reason: 'banned' }));
      declinedRequestIds.forEach((requestId) =>
        events.emit({ type: 'request.declined', requestId, auto: true, actorUserId: admin.user.id }),
      );
    }
    return toUserDTO(await prisma.user.findUniqueOrThrow({ where: { id }, include: userInclude }));
  });

  // Does not unban a separately banned user, and closed posts stay closed. The session version is left
  // alone: the delete already ended every old session, so the user simply signs in again.
  app.post('/admin/users/:id/reactivate', async (req) => {
    await requireAdmin(req);
    const { id } = idParam.parse(req.params);
    if (!(await prisma.user.findUnique({ where: { id }, select: { id: true } }))) throw new AppError(404, 'NOT_FOUND');
    await prisma.user.update({ where: { id }, data: { deletedAt: null } });
    return toUserDTO(await prisma.user.findUniqueOrThrow({ where: { id }, include: userInclude }));
  });

  app.get('/admin/users/:id/characters', async (req) => {
    const admin = await requireAdmin(req);
    const { id } = idParam.parse(req.params);
    const rows = await listCharacters(prisma, { ownerId: id });
    return rows.map((r) => toCharacterDTO(r, admin.user.id, storage));
  });

  app.post('/admin/characters/:id/reassign', async (req) => {
    const admin = await requireAdmin(req);
    const { id } = idParam.parse(req.params);
    const { userId } = reassignBody.parse(req.body);
    const cancelled = await reassignCharacter(prisma, id, userId);
    cancelled.forEach((requestId) => events.emit({ type: 'request.cancelled', requestId }));
    return toCharacterDTO(await getCharacter(prisma, id), admin.user.id, storage);
  });

  app.delete('/admin/characters/:id', async (req, reply) => {
    const admin = await requireAdmin(req);
    const { id } = idParam.parse(req.params);
    const row = await prisma.character.findUnique({ where: { id }, select: { screenshotKey: true } });
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Character not found');
    const { closedPostIds, declinedRequestIds } = await deleteCharacter(prisma, id);
    closedPostIds.forEach((postId) => events.emit({ type: 'post.closed', postId, reason: 'character_deleted' }));
    declinedRequestIds.forEach((requestId) =>
      events.emit({ type: 'request.declined', requestId, auto: true, actorUserId: admin.user.id }),
    );
    if (row.screenshotKey) await storage.remove(row.screenshotKey).catch(() => undefined);
    return reply.status(204).send();
  });

  app.get('/admin/posts', async (req) => {
    const admin = await requireAdmin(req);
    const { status, q } = postsQuery.parse(req.query);
    const now = new Date();
    const and: Prisma.PostWhereInput[] = [];
    if (status === 'open' || status === 'full') and.push({ deletedAt: null, status, expiresAt: { gt: now } });
    else if (status === 'closed') and.push({ deletedAt: null, OR: [{ status: 'closed' }, { expiresAt: { lte: now } }] });
    else if (status === 'deleted') and.push({ deletedAt: { not: null } });
    if (q) and.push({ posterCharacter: { ignLower: { startsWith: q.toLowerCase() } } });
    const rows = await prisma.post.findMany({
      where: { AND: and },
      include: { ...postSummaryInclude, posterUser: { select: { username: true, discordId: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    return rows.map(
      (r): AdminPostDTO => ({
        ...toPostSummaryDTO(r, admin.user.id, storage, now),
        deletedAt: r.deletedAt?.toISOString() ?? null,
        closedReason: r.closedReason,
        posterDiscordUsername: r.posterUser.username,
        posterDiscordLinked: r.posterUser.discordId !== null,
      }),
    );
  });
}
