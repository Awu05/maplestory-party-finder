import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server';
import { buildTestApp, prisma, resetDb, testConfig } from './helpers.js';
import { VirtualPasskey } from './passkeyFixtures.js';
import { isAdminUser } from '../src/auth/guards.js';

const ORIGIN = 'http://localhost:5173';
const password = 'a long maple password';
const account = { discordUsername: 'maple_user', displayName: 'Maple Player' };
let app: FastifyInstance;
beforeEach(async () => { await resetDb(); ({ app } = await buildTestApp()); });
afterEach(async () => { await app.close(); });

const cookieOf = (response: { headers: { 'set-cookie'?: string | string[] } }) => String(response.headers['set-cookie']).split(';')[0]!;
const sessionOf = (cookie: string) => app.decodeSecureSession(decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)))?.data();
const postJson = (url: string, payload?: object, cookie?: string) => app.inject({ method: 'POST', url, headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) }, ...(payload ? { payload } : {}) });

/** Starts a Discord login (oauthState) on top of `cookie`, returning the new cookie. */
async function withOauthState(cookie?: string): Promise<string> {
  const start = await app.inject({ method: 'GET', url: '/api/auth/discord', headers: cookie ? { cookie } : {} });
  return cookieOf(start);
}

/** A logged-out session holding a stray oauthState and a pending passkey challenge row. */
async function cluttered(): Promise<string> {
  const options = await postJson('/api/auth/passkeys/login/options');
  expect(options.statusCode).toBe(200);
  const cookie = await withOauthState(cookieOf(options));
  expect(sessionOf(cookie)).toMatchObject({ oauthState: expect.any(String), passkeyChallengeId: expect.any(String) });
  expect(await prisma.passkeyChallenge.count()).toBe(1);
  return cookie;
}

function expectFresh(cookie: string, userId: string) {
  expect(sessionOf(cookie)).toEqual({ userId, sessionVersion: 0 });
}

it('Discord login starts a fresh session and removes a pending passkey challenge', async () => {
  const cookie = await cluttered();
  const state = sessionOf(cookie)!.oauthState!;
  const callback = await app.inject({ method: 'GET', url: `/api/auth/discord/callback?code=fake:d-1:discord_user&state=${state}`, headers: { cookie } });
  expect(callback.statusCode).toBe(302);
  const user = await prisma.user.findUniqueOrThrow({ where: { discordId: 'd-1' } });
  expectFresh(cookieOf(callback), user.id);
  expect(await prisma.passkeyChallenge.count()).toBe(0);
});

it.each(['register', 'login'] as const)('password %s starts a fresh session and removes a pending passkey challenge', async (path) => {
  const credentials = { email: 'maple@example.com', password };
  if (path === 'login') {
    expect((await postJson('/api/auth/password/register', { ...account, ...credentials })).statusCode).toBe(200);
    await prisma.passkeyChallenge.deleteMany();
  }
  const cookie = await cluttered();
  const result = await postJson(`/api/auth/password/${path}`, path === 'login' ? credentials : { ...account, ...credentials }, cookie);
  expect(result.statusCode).toBe(200);
  expectFresh(cookieOf(result), result.json().id);
  expect(await prisma.passkeyChallenge.count()).toBe(0);
}, 20_000);

it('passkey registration and login start fresh sessions', async () => {
  const key = new VirtualPasskey();
  const options = await postJson('/api/auth/passkeys/register/options', account, await withOauthState());
  const pending = cookieOf(options);
  expect(sessionOf(pending)).toMatchObject({ oauthState: expect.any(String), passkeyChallengeId: expect.any(String) });
  const registered = await postJson('/api/auth/passkeys/register/verify', key.register(options.json<PublicKeyCredentialCreationOptionsJSON>()), pending);
  expect(registered.statusCode).toBe(200);
  expectFresh(cookieOf(registered), registered.json().id);

  const loginOptions = await postJson('/api/auth/passkeys/login/options', undefined, await withOauthState());
  const loginPending = cookieOf(loginOptions);
  const signedIn = await postJson('/api/auth/passkeys/login/verify', key.authenticate(loginOptions.json<PublicKeyCredentialRequestOptionsJSON>()), loginPending);
  expect(signedIn.statusCode).toBe(200);
  expectFresh(cookieOf(signedIn), registered.json().id);
  expect(await prisma.passkeyChallenge.count()).toBe(0);
});

it('isAdminUser requires a linked Discord ID on the admin list', () => {
  const config = testConfig({ adminDiscordIds: ['admin-1'] });
  expect(isAdminUser({ discordId: 'admin-1' }, config)).toBe(true);
  expect(isAdminUser({ discordId: 'someone' }, config)).toBe(false);
  expect(isAdminUser({ discordId: null }, config)).toBe(false);
});
