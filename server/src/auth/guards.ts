import type { FastifyRequest } from 'fastify';
import type { User } from '@prisma/client';
import { AppError } from '../http/errors.js';
import type { Config } from '../config.js';

declare module '@fastify/secure-session' {
  interface SessionData {
    userId: string;
    oauthState: string;
    passkeyChallengeId: string;
    sessionVersion: number;
  }
}

export interface Viewer {
  user: User;
  isAdmin: boolean;
}

/** Admin rights come only from a Discord-linked account whose ID is on ADMIN_DISCORD_IDS. */
export function isAdminUser(user: Pick<User, 'discordId'>, config: Pick<Config, 'adminDiscordIds'>): boolean {
  return user.discordId !== null && config.adminDiscordIds.includes(user.discordId);
}

function toViewer(req: FastifyRequest, user: User): Viewer {
  return { user, isAdmin: isAdminUser(user, req.server.deps.config) };
}

/**
 * Signs `user` in, the same way for every login method: drops any unfinished passkey ceremony
 * (database row and cookie field), starts a fresh session so nothing from before login carries over,
 * and records the user and their session version.
 */
export async function startSession(req: FastifyRequest, user: Pick<User, 'id' | 'sessionVersion'>): Promise<void> {
  const challengeId = req.session.get('passkeyChallengeId');
  if (challengeId) await req.server.deps.prisma.passkeyChallenge.deleteMany({ where: { id: challengeId } });
  req.session.regenerate();
  req.session.set('userId', user.id);
  req.session.set('sessionVersion', user.sessionVersion);
}

/** Current viewer, or null when logged out, unknown, or banned. */
export async function getViewer(req: FastifyRequest): Promise<Viewer | null> {
  const userId = req.session.get('userId');
  if (!userId) return null;
  const user = await req.server.deps.prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.banned || (req.session.get('sessionVersion') ?? 0) !== user.sessionVersion) return null;
  return toViewer(req, user);
}

export async function requireUser(req: FastifyRequest): Promise<Viewer> {
  const userId = req.session.get('userId');
  if (!userId) throw new AppError(401, 'UNAUTHENTICATED');
  const user = await req.server.deps.prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(401, 'UNAUTHENTICATED');
  if ((req.session.get('sessionVersion') ?? 0) !== user.sessionVersion) throw new AppError(401, 'UNAUTHENTICATED');
  if (user.banned) throw new AppError(403, 'BANNED');
  return toViewer(req, user);
}

export async function requireAdmin(req: FastifyRequest): Promise<Viewer> {
  const viewer = await requireUser(req);
  if (!viewer.isAdmin) throw new AppError(403, 'FORBIDDEN');
  return viewer;
}
