import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AppError } from '../http/errors.js';
import { AttemptLimiter, createAuthRequestGuard, signupBody } from './localAuth.js';
import { hashPassword, verifyPassword } from './passwordHash.js';
import { toMeDTO } from './serialize.js';
import { isAdminUser, startSession } from './guards.js';
import { ensureUsernameAvailable, isUsernameConflict, usernameKey, usernameTaken } from './usernames.js';

export const email = z.string().trim().toLowerCase().pipe(z.email().max(254));
export const password = z.string().min(15).max(128);
const registration = signupBody.extend({ email, password });
const login = z.object({ email, password: z.string().min(1).max(128) }).strict();

export async function passwordRoutes(api: FastifyInstance): Promise<void> {
  const { prisma, config } = api.deps;
  const checkRequest = createAuthRequestGuard(api, 20);
  // Keyed by client address + email: failures from one address can't lock the owner out from another.
  // Every address is also limited across all emails by checkRequest.
  const registrations = new AttemptLimiter(10);
  const failedLogins = new AttemptLimiter(10);
  const attemptKey = (req: FastifyRequest, address: string) => `${req.ip}
${address}`;

  async function complete(req: FastifyRequest, user: Parameters<typeof toMeDTO>[0]['user']) {
    await startSession(req, user);
    return toMeDTO({ user, isAdmin: isAdminUser(user, config) });
  }

  api.post('/auth/password/register', { bodyLimit: 4096 }, async (req) => {
    await checkRequest(req);
    const input = registration.parse(req.body);
    registrations.check(attemptKey(req, input.email));
    await ensureUsernameAvailable(prisma, input.discordUsername);
    const passwordHash = await hashPassword(input.password);
    let user;
    try {
      user = await prisma.user.create({ data: {
        username: input.discordUsername, usernameKey: usernameKey(input.discordUsername), displayName: input.displayName,
        passwordCredential: { create: { email: input.email, passwordHash } },
      } });
    } catch (error) {
      if (isUsernameConflict(error)) throw usernameTaken();
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError(400, 'ACCOUNT_UNAVAILABLE', 'Could not create an account with these details. Try signing in or use a different email.');
      }
      throw error;
    }
    return complete(req, user);
  });

  api.post('/auth/password/login', { bodyLimit: 4096 }, async (req) => {
    await checkRequest(req);
    const input = login.parse(req.body);
    const key = attemptKey(req, input.email);
    failedLogins.ensureAllowed(key);
    const credential = await prisma.passwordCredential.findUnique({ where: { email: input.email }, include: { user: true } });
    const verified = await verifyPassword(input.password, credential?.passwordHash);
    if (!verified || !credential || credential.user.banned) {
      // Only failures count: signing in successfully never uses up the owner's attempts.
      failedLogins.record(key);
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    return complete(req, credential.user);
  });
}
