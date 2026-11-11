import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Prisma, type PasskeyChallenge } from '@prisma/client';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse,
  type AuthenticatorTransport,
} from '@simplewebauthn/server';
import { z } from 'zod';
import { AppError } from '../http/errors.js';
import { toMeDTO } from './serialize.js';
import { createAuthRequestGuard, signupBody } from './localAuth.js';
import { isAdminUser, startSession } from './guards.js';

const encoded = z.string().min(1).max(65_536).regex(/^[A-Za-z0-9_-]+$/);
const credential = z.object({ id: encoded.max(2048), rawId: encoded.max(2048), type: z.literal('public-key'), clientExtensionResults: z.record(z.string(), z.unknown()).default({}), authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional() });
const registrationBody = credential.extend({ response: z.object({ clientDataJSON: encoded.max(16_000), attestationObject: encoded, transports: z.array(z.enum(['ble', 'cable', 'hybrid', 'internal', 'nfc', 'smart-card', 'usb'])).max(10).optional() }).passthrough() });
const authenticationBody = credential.extend({ response: z.object({ clientDataJSON: encoded.max(16_000), authenticatorData: encoded, signature: encoded, userHandle: encoded.max(2048).optional() }) });
const CHALLENGE_MS = 5 * 60_000;

export async function passkeyRoutes(api: FastifyInstance): Promise<void> {
  const { prisma, config } = api.deps;
  const origin = new URL(config.webOrigin).origin;
  const rpID = new URL(origin).hostname;
  const checkRequest = createAuthRequestGuard(api);

  async function saveChallenge(req: FastifyRequest, data: { challenge: string; purpose: string; userId?: string; username?: string; displayName?: string }): Promise<void> {
    const previous = req.session.get('passkeyChallengeId');
    await prisma.passkeyChallenge.deleteMany({ where: { OR: [{ expiresAt: { lte: new Date() } }, ...(previous ? [{ id: previous }] : [])] } });
    const id = randomBytes(32).toString('base64url');
    await prisma.passkeyChallenge.create({ data: { id, ...data, expiresAt: new Date(Date.now() + CHALLENGE_MS) } });
    req.session.set('passkeyChallengeId', id);
  }

  async function consumeChallenge(req: FastifyRequest, purpose: string): Promise<PasskeyChallenge> {
    const id = req.session.get('passkeyChallengeId');
    req.session.set('passkeyChallengeId', undefined);
    if (!id) throw new AppError(400, 'PASSKEY_EXPIRED', 'Start the passkey request again.');
    // Consume on the server so an old signed cookie cannot replay a challenge.
    const [challenge] = await prisma.$queryRaw<PasskeyChallenge[]>`DELETE FROM "PasskeyChallenge" WHERE id = ${id} RETURNING *`;
    if (!challenge || challenge.purpose !== purpose || challenge.expiresAt <= new Date()) {
      throw new AppError(400, 'PASSKEY_EXPIRED', 'Start the passkey request again.');
    }
    return challenge;
  }

  const invalid = () => new AppError(400, 'PASSKEY_INVALID', 'The passkey could not be verified. Please try again.');

  api.post('/auth/passkeys/register/options', { bodyLimit: 100_000 }, async (req) => {
    await checkRequest(req);
    const input = signupBody.parse(req.body);
    const userId = randomUUID();
    const options = await generateRegistrationOptions({
      rpName: 'Maple Party Finder', rpID,
      userID: new TextEncoder().encode(userId), userName: input.discordUsername, userDisplayName: input.displayName,
      attestationType: 'none', supportedAlgorithmIDs: [-7, -257],
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    await saveChallenge(req, { challenge: options.challenge, purpose: 'register', userId, username: input.discordUsername, displayName: input.displayName });
    return options;
  });

  api.post('/auth/passkeys/register/verify', { bodyLimit: 100_000 }, async (req) => {
    await checkRequest(req);
    const challenge = await consumeChallenge(req, 'register');
    const response = registrationBody.parse(req.body);
    let verification;
    try {
      verification = await verifyRegistrationResponse({ response, expectedChallenge: challenge.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true, supportedAlgorithmIDs: [-7, -257] });
    } catch { throw invalid(); }
    if (!verification.verified || !challenge.userId || !challenge.username || !challenge.displayName) throw invalid();
    const { credential: key, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    let user;
    try {
      user = await prisma.user.create({ data: {
        id: challenge.userId, username: challenge.username, displayName: challenge.displayName,
        passkeys: { create: { id: key.id, publicKey: Buffer.from(key.publicKey), counter: BigInt(key.counter), deviceType: credentialDeviceType, backedUp: credentialBackedUp, transports: response.response.transports ?? [] } },
      } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw invalid();
      throw error;
    }
    await startSession(req, user);
    return toMeDTO({ user, isAdmin: isAdminUser(user, config) });
  });

  api.post('/auth/passkeys/login/options', async (req) => {
    await checkRequest(req);
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'required', allowCredentials: [] });
    await saveChallenge(req, { challenge: options.challenge, purpose: 'login' });
    return options;
  });

  api.post('/auth/passkeys/login/verify', { bodyLimit: 100_000 }, async (req) => {
    await checkRequest(req);
    const challenge = await consumeChallenge(req, 'login');
    const response = authenticationBody.parse(req.body);
    const key = await prisma.passkey.findUnique({ where: { id: response.id }, include: { user: true } });
    if (!key || key.user.banned || response.response.userHandle !== Buffer.from(key.userId).toString('base64url')) throw invalid();
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response, expectedChallenge: challenge.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
        credential: { id: key.id, publicKey: new Uint8Array(key.publicKey), counter: Number(key.counter), transports: key.transports as AuthenticatorTransport[] },
      });
    } catch { throw invalid(); }
    if (!verification.verified) throw invalid();
    const updated = await prisma.passkey.updateMany({ where: { id: key.id, counter: key.counter, user: { banned: false } }, data: { counter: BigInt(verification.authenticationInfo.newCounter), backedUp: verification.authenticationInfo.credentialBackedUp } });
    if (updated.count !== 1) throw invalid();
    await startSession(req, key.user);
    return toMeDTO({ user: key.user, isAdmin: isAdminUser(key.user, config) });
  });
}
