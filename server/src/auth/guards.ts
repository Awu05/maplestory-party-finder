import type { FastifyRequest } from 'fastify';
import type { User } from '@prisma/client';
import { AppError } from '../http/errors.js';

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

function toViewer(req: FastifyRequest, user: User): Viewer {
  return { user, isAdmin: user.discordId !== null && req.server.deps.config.adminDiscordIds.includes(user.discordId) };
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
