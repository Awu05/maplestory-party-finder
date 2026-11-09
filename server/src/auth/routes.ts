import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { MeDTO } from '@pf/shared';
import { getViewer } from './guards.js';

export async function authRoutes(api: FastifyInstance): Promise<void> {
  const { prisma, discord, config } = api.deps;

  api.get('/auth/discord', async (req, reply) => {
    const state = randomBytes(16).toString('hex');
    req.session.set('oauthState', state);
    return reply.redirect(discord.authorizeUrl(state));
  });

  api.get('/auth/discord/callback', async (req, reply) => {
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
    const expected = req.session.get('oauthState');
    // The state is single-use whether or not this callback succeeds.
    req.session.set('oauthState', undefined);

    const fail = (reason: string, err?: unknown) => {
      // Never log the code, tokens or secrets — only why the login failed.
      req.log.warn({ reason, err: err instanceof Error ? err.message : undefined }, 'Discord login failed');
      return reply.redirect(`${config.webOrigin}/?login=failed`);
    };

    if (error) return fail(`discord returned error=${error}`);
    if (!code || !state || !expected || state !== expected) return fail('bad or missing state');

    let profile;
    try {
      profile = await discord.exchangeCode(code);
    } catch (err) {
      return fail('code exchange or profile fetch failed', err);
    }
    const user = await prisma.user.upsert({
      where: { discordId: profile.discordId },
      create: { discordId: profile.discordId, username: profile.username, avatar: profile.avatarUrl },
      update: { username: profile.username, avatar: profile.avatarUrl },
    });
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
