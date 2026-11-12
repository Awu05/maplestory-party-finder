import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { MeDTO } from '@pf/shared';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { getViewer, requireUser, startSession } from './guards.js';
import { passkeyRoutes } from './passkeys.js';
import { passwordRoutes } from './passwords.js';
import { passwordResetRoutes } from './passwordReset.js';
import { toMeDTO } from './serialize.js';
import { discordUsernameField } from './localAuth.js';
import { ensureUsernameAvailable, isUsernameConflict, releaseUsernameClaim, usernameKey, usernameTaken, withUsernameClaim } from './usernames.js';
import { AppError } from '../http/errors.js';

// Control and invisible format characters (e.g. zero-width spaces) are stripped, so a name can't render blank.
const profileBody = z
  .object({
    displayName: z
      .string()
      .transform((s) => s.replace(/[\p{Cc}\p{Cf}]/gu, '').trim())
      .pipe(z.string().max(50))
      .nullable()
      .optional(),
    // Only for accounts not linked to Discord: their typed (unverified) name.
    discordUsername: discordUsernameField.optional(),
  })
  .strict()
  .refine((body) => body.displayName !== undefined || body.discordUsername !== undefined, { message: 'Nothing to update' });

/** The linking account stopped being linkable between the checks and the write. */
class LinkNoLongerValid extends Error {}

export async function authRoutes(api: FastifyInstance): Promise<void> {
  const { prisma, discord, config } = api.deps;
  await api.register(passkeyRoutes);
  // Password accounts are behind PASSWORD_AUTH_ENABLED; when off, these routes simply don't exist.
  if (config.passwordAuth) {
    await api.register(passwordRoutes);
    await api.register(passwordResetRoutes);
  }

  /** Which sign-in methods the login popup should offer. */
  api.get('/auth/config', async () => ({ passwordAuth: config.passwordAuth }));

  api.get('/auth/discord', async (req, reply) => {
    const state = randomBytes(16).toString('hex');
    req.session.set('oauthState', state);
    // A plain login never finishes an abandoned link request.
    req.session.set('linkUserId', undefined);
    return reply.redirect(discord.authorizeUrl(state));
  });

  /** Starts linking the signed-in passkey/password account to a Discord identity. */
  api.get('/auth/discord/link', async (req, reply) => {
    // Only this site may start a link. Browsers send Sec-Fetch-Site on navigations; a link or redirect
    // from another site says "cross-site" (or "same-site"), and is refused before anything is stored.
    const fetchSite = req.headers['sec-fetch-site'];
    if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none') {
      return reply.redirect(`${config.webOrigin}/?link=failed`);
    }
    // This is a page navigation, so a logged-out or banned visitor gets a redirect, not a JSON error.
    const viewer = await getViewer(req);
    if (!viewer) return reply.redirect(`${config.webOrigin}/?link=failed`);
    if (viewer.user.discordId !== null) return reply.redirect(`${config.webOrigin}/?link=already`);
    const state = randomBytes(16).toString('hex');
    req.session.set('oauthState', state);
    req.session.set('linkUserId', viewer.user.id);
    return reply.redirect(discord.authorizeUrl(state));
  });

  api.get('/auth/discord/callback', async (req, reply) => {
    const { code, state, error } = req.query as { code?: string; state?: string; error?: string };
    const expected = req.session.get('oauthState');
    // Only the server-side session can ask for a link — never anything in the query.
    const linkUserId = req.session.get('linkUserId');
    // The state and link request are single-use whether or not this callback succeeds.
    req.session.set('oauthState', undefined);
    req.session.set('linkUserId', undefined);

    const fail = (reason: string, err?: unknown) => {
      // Never log the code, tokens, usernames or secrets — only why the login failed.
      req.log.warn({ reason, err: err instanceof Error ? err.message : undefined }, linkUserId ? 'Discord link failed' : 'Discord login failed');
      return reply.redirect(`${config.webOrigin}/?${linkUserId ? 'link' : 'login'}=failed`);
    };

    if (error) return fail(`discord returned error=${error}`);
    if (!code || !state || !expected || state !== expected) return fail('bad or missing state');

    let profile;
    try {
      profile = await discord.exchangeCode(code);
    } catch (err) {
      return fail('code exchange or profile fetch failed', err);
    }
    if (linkUserId) {
      // The account that asked for the link must still be the one signed in, in good standing and unlinked.
      const viewer = await getViewer(req);
      if (!viewer || viewer.user.id !== linkUserId || viewer.user.discordId !== null) return fail('link session no longer valid');
      // Accounts are never merged: a Discord identity that already has an account stays separate.
      if (await prisma.user.findUnique({ where: { discordId: profile.discordId }, select: { id: true } })) {
        return reply.redirect(`${config.webOrigin}/?link=taken`);
      }
      let linked;
      try {
        linked = await withUsernameClaim((claim) => prisma.$transaction(async (tx) => {
          if (claim) await releaseUsernameClaim(tx, profile.username, (holder) => holder.id === linkUserId);
          const updated = await tx.user.updateMany({
            where: { id: linkUserId, discordId: null, banned: false, sessionVersion: viewer.user.sessionVersion },
            data: { discordId: profile.discordId, username: profile.username, usernameKey: claim ? usernameKey(profile.username) : null, avatar: profile.avatarUrl },
          });
          // Nothing matched: the account was banned, linked or signed out everywhere since the check
          // above. Throw so the whole transaction rolls back, including a name released from someone else.
          if (updated.count !== 1) throw new LinkNoLongerValid();
          return tx.user.findUniqueOrThrow({ where: { id: linkUserId } });
        }));
      } catch (err) {
        // The Discord identity got its own account while this link was in flight.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && !isUsernameConflict(err)) {
          return reply.redirect(`${config.webOrigin}/?link=taken`);
        }
        if (err instanceof LinkNoLongerValid) return fail('link session no longer valid');
        return fail('link update failed', err);
      }
      await startSession(req, linked);
      return reply.redirect(`${config.webOrigin}/?link=done`);
    }

    // "Real Discord wins": a Discord login takes its name from whichever other account holds it.
    const user = await withUsernameClaim((claim) => prisma.$transaction(async (tx) => {
      if (claim) await releaseUsernameClaim(tx, profile.username, (holder) => holder.discordId === profile.discordId);
      const key = claim ? usernameKey(profile.username) : null;
      return tx.user.upsert({
        where: { discordId: profile.discordId },
        create: { discordId: profile.discordId, username: profile.username, usernameKey: key, avatar: profile.avatarUrl },
        update: { username: profile.username, usernameKey: key, avatar: profile.avatarUrl },
      });
    }));
    if (user.banned) return reply.redirect(`${config.webOrigin}/?login=banned`);
    await startSession(req, user);
    return reply.redirect(`${config.webOrigin}/me/characters`);
  });

  api.get('/auth/me', async (req): Promise<MeDTO> => {
    const viewer = await getViewer(req);
    return viewer ? toMeDTO(viewer) : null;
  });

  api.patch('/auth/me', async (req): Promise<MeDTO> => {
    const viewer = await requireUser(req);
    const { displayName, discordUsername } = profileBody.parse(req.body);
    const linkedError = () => new AppError(400, 'DISCORD_LINKED', 'Your Discord username comes from Discord.');
    if (discordUsername !== undefined) {
      if (viewer.user.discordId !== null) throw linkedError();
      await ensureUsernameAvailable(prisma, discordUsername, viewer.user.id);
    }
    let user;
    try {
      user = await prisma.user.update({
        // A typed name is only ever saved on an account that is still unlinked.
        where: { id: viewer.user.id, ...(discordUsername !== undefined ? { AND: [{ discordId: null }] } : {}) },
        data: {
          ...(displayName !== undefined ? { displayName: displayName || null } : {}),
          // Stays unverified: only linking Discord verifies a name.
          ...(discordUsername !== undefined ? { username: discordUsername, usernameKey: usernameKey(discordUsername) } : {}),
        },
      });
    } catch (error) {
      if (isUsernameConflict(error)) throw usernameTaken();
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw linkedError();
      throw error;
    }
    return toMeDTO({ ...viewer, user });
  });

  api.post('/auth/logout', async (req, reply) => {
    req.session.delete();
    return reply.status(204).send();
  });
}
