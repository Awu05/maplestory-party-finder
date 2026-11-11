import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { MeDTO } from '@pf/shared';
import { z } from 'zod';
import { getViewer, requireUser } from './guards.js';

// Control and invisible format characters (e.g. zero-width spaces) are stripped, so a name can't render blank.
const profileBody = z
  .object({
    displayName: z
      .string()
      .transform((s) => s.replace(/[\p{Cc}\p{Cf}]/gu, '').trim())
      .pipe(z.string().max(50))
      .nullable(),
  })
  .strict();

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
    if (user.banned) return reply.redirect(`${config.webOrigin}/?login=banned`);
    req.session.set('userId', user.id);
    return reply.redirect(`${config.webOrigin}/me/characters`);
  });

  api.get('/auth/me', async (req): Promise<MeDTO> => {
    const viewer = await getViewer(req);
    if (!viewer) return null;
    return {
      id: viewer.user.id,
      discordUsername: viewer.user.username,
      displayName: viewer.user.displayName,
      avatarUrl: viewer.user.avatar,
      isAdmin: viewer.isAdmin,
    };
  });

  api.patch('/auth/me', async (req): Promise<MeDTO> => {
    const viewer = await requireUser(req);
    const { displayName } = profileBody.parse(req.body);
    const user = await prisma.user.update({
      where: { id: viewer.user.id },
      data: { displayName: displayName || null },
    });
    return { id: user.id, discordUsername: user.username, displayName: user.displayName, avatarUrl: user.avatar, isAdmin: viewer.isAdmin };
  });

  api.post('/auth/logout', async (req, reply) => {
    req.session.delete();
    return reply.status(204).send();
  });
}
