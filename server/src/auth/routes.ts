import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { MeDTO } from '@pf/shared';
import { AppError } from '../http/errors.js';
import { getViewer } from './guards.js';

export async function authRoutes(api: FastifyInstance): Promise<void> {
  const { prisma, discord, config } = api.deps;

  api.get('/auth/discord', async (req, reply) => {
    const state = randomBytes(16).toString('hex');
    req.session.set('oauthState', state);
    return reply.redirect(discord.authorizeUrl(state));
  });

  api.get('/auth/discord/callback', async (req, reply) => {
    const { code, state } = req.query as { code?: string; state?: string };
    const expected = req.session.get('oauthState');
    if (!code || !state || !expected || state !== expected) throw new AppError(400, 'BAD_STATE');
    const profile = await discord.exchangeCode(code);
    const user = await prisma.user.upsert({
      where: { discordId: profile.discordId },
      create: { discordId: profile.discordId, username: profile.username, avatar: profile.avatarUrl },
      update: { username: profile.username, avatar: profile.avatarUrl },
    });
    req.session.set('oauthState', undefined);
    req.session.set('userId', user.id);
    return reply.redirect(config.webOrigin);
  });

  api.get('/auth/me', async (req): Promise<MeDTO> => {
    const viewer = await getViewer(req);
    if (!viewer) return null;
    return {
      id: viewer.user.id,
      discordUsername: viewer.user.username,
      avatarUrl: viewer.user.avatar,
      isAdmin: viewer.isAdmin,
    };
  });

  api.post('/auth/logout', async (req, reply) => {
    req.session.delete();
    return reply.status(204).send();
  });
}
