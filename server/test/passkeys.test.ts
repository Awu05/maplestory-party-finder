import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server';
import { buildTestApp, loginAs, makeCharacter, makeUser, prisma, resetDb } from './helpers.js';
import { VirtualPasskey } from './passkeyFixtures.js';

const ORIGIN = 'http://localhost:5173';
const account = { discordUserId: '123456789012345678', discordUsername: 'maple_user', displayName: 'Maple Player' };
let app: FastifyInstance;
beforeEach(async () => { await resetDb(); ({ app } = await buildTestApp()); });
afterEach(async () => { await app.close(); });

const post = (path: string, payload?: unknown, cookie?: string, origin = ORIGIN) => app.inject({ method: 'POST', url: `/api/auth/passkeys/${path}`, headers: { origin, ...(cookie ? { cookie } : {}) }, ...(payload === undefined ? {} : { payload: payload as object }) });
const cookieOf = (response: { headers: { 'set-cookie'?: string | string[] } }) => String(response.headers['set-cookie']).split(';')[0]!;
async function registration(input = account, cookie?: string) {
  const options = await post('register/options', input, cookie);
  expect(options.statusCode).toBe(200);
  return { options: options.json<PublicKeyCredentialCreationOptionsJSON>(), cookie: cookieOf(options) };
}
async function registered(input = account) {
  const key = new VirtualPasskey();
  const pending = await registration(input);
  const result = await post('register/verify', key.register(pending.options), pending.cookie);
  expect(result.statusCode).toBe(200);
  return { key, user: result.json(), cookie: cookieOf(result) };
}
async function loginOptions() {
  const result = await post('login/options');
  expect(result.statusCode).toBe(200);
  return { options: result.json<PublicKeyCredentialRequestOptionsJSON>(), cookie: cookieOf(result) };
}

it('creates an account only after verification, then signs in with its discoverable passkey', async () => {
  const pending = await registration();
  expect(await prisma.user.count()).toBe(0);
  expect(pending.options.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
  const key = new VirtualPasskey();
  const result = await post('register/verify', key.register(pending.options), pending.cookie);
  expect(result.statusCode).toBe(200);
  expect(result.json()).toMatchObject({ discordUsername: account.discordUsername, displayName: account.displayName, avatarUrl: null, discordLinked: false, isAdmin: false });
  const user = await prisma.user.findUniqueOrThrow({ where: { id: result.json().id } });
  expect(user.discordId).toBeNull();
  expect(await prisma.passkey.count({ where: { userId: user.id } })).toBe(1);
  expect(await prisma.passkeyChallenge.count()).toBe(0);
  expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: cookieOf(result) } })).json().id).toBe(user.id);
  await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie: cookieOf(result) } });
  const next = await loginOptions();
  expect(next.options.allowCredentials).toEqual([]);
  const signedIn = await post('login/verify', key.authenticate(next.options), next.cookie);
  expect(signedIn.statusCode).toBe(200);
  expect(signedIn.json().id).toBe(user.id);
});

it('never links a typed Discord username to an existing user or grants their admin rights', async () => {
  const existing = await makeUser({ discordId: 'admin-1', username: account.discordUsername });
  const character = await makeCharacter({ ownerId: existing.id });
  const local = await registered();
  expect(local.user.id).not.toBe(existing.id);
  expect(local.user.isAdmin).toBe(false);
  expect((await prisma.character.findUniqueOrThrow({ where: { id: character.id } })).ownerId).toBe(existing.id);
  expect((await app.inject({ method: 'GET', url: '/api/admin/users', headers: { cookie: local.cookie } })).statusCode).toBe(403);
  const discordCookie = await loginAs(app, 'admin-1', account.discordUsername);
  expect((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: discordCookie } })).json()).toMatchObject({ id: existing.id, discordLinked: true, isAdmin: true });
});

it.each([
  { origin: 'https://attacker.example' }, { challenge: 'wrong-challenge' },
  { rpID: 'attacker.example' }, { userVerified: false },
])('rejects invalid registration proof (%j)', async (overrides) => {
  const pending = await registration();
  const response = new VirtualPasskey().register(pending.options, overrides);
  expect((await post('register/verify', response, pending.cookie)).statusCode).toBe(400);
  expect(await prisma.user.count()).toBe(0);
  expect(await prisma.passkey.count()).toBe(0);
});

it('consumes registration challenges once, including when an old signed cookie is replayed', async () => {
  const pending = await registration();
  const response = new VirtualPasskey().register(pending.options);
  expect((await post('register/verify', response, pending.cookie)).statusCode).toBe(200);
  expect((await post('register/verify', response, pending.cookie)).statusCode).toBe(400);
  expect(await prisma.user.count()).toBe(1);
});

it('rejects re-registering an existing credential and rolls back the new account', async () => {
  const { key } = await registered();
  // A different name, so only the reused credential conflicts.
  const pending = await registration({ ...account, discordUserId: '223456789012345678', discordUsername: 'second_user' });
  expect((await post('register/verify', key.register(pending.options), pending.cookie)).statusCode).toBe(400);
  expect(await prisma.user.count()).toBe(1);
  expect(await prisma.passkey.count()).toBe(1);
});

it('does not permit replay or concurrent reuse of a zero-counter login response', async () => {
  const { key } = await registered();
  const pending = await loginOptions();
  const response = key.authenticate(pending.options);
  const results = await Promise.all([post('login/verify', response, pending.cookie), post('login/verify', response, pending.cookie)]);
  expect(results.map((result) => result.statusCode).sort()).toEqual([200, 400]);
  expect((await post('login/verify', response, pending.cookie)).statusCode).toBe(400);
});

it.each([
  { origin: 'https://attacker.example' }, { challenge: 'wrong-challenge' },
  { rpID: 'attacker.example' }, { userVerified: false },
])('rejects invalid authentication proof (%j)', async (overrides) => {
  const { key } = await registered();
  const pending = await loginOptions();
  expect((await post('login/verify', key.authenticate(pending.options, overrides), pending.cookie)).statusCode).toBe(400);
});

it('rejects a tampered signature and a passkey belonging to no account', async () => {
  const { key } = await registered();
  let pending = await loginOptions();
  const response = key.authenticate(pending.options);
  response.response.signature = Buffer.alloc(64).toString('base64url');
  expect((await post('login/verify', response, pending.cookie)).statusCode).toBe(400);
  pending = await loginOptions();
  expect((await post('login/verify', new VirtualPasskey().authenticate(pending.options), pending.cookie)).statusCode).toBe(400);
});

it('rejects expired challenges and challenges from another session or ceremony', async () => {
  const pending = await registration();
  const response = new VirtualPasskey().register(pending.options);
  expect((await post('register/verify', response)).statusCode).toBe(400);
  await prisma.passkeyChallenge.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } });
  expect((await post('register/verify', response, pending.cookie)).statusCode).toBe(400);
  const another = await registration();
  expect((await post('login/verify', response, another.cookie)).statusCode).toBe(400);
  expect(await prisma.user.count()).toBe(0);
});

it('rejects banned users and stale authenticator counters', async () => {
  const { key, user } = await registered();
  let pending = await loginOptions();
  expect((await post('login/verify', key.authenticate(pending.options, { counter: 1 }), pending.cookie)).statusCode).toBe(200);
  pending = await loginOptions();
  expect((await post('login/verify', key.authenticate(pending.options, { counter: 1 }), pending.cookie)).statusCode).toBe(400);
  await prisma.user.update({ where: { id: user.id }, data: { banned: true } });
  pending = await loginOptions();
  expect((await post('login/verify', key.authenticate(pending.options, { counter: 2 }), pending.cookie)).statusCode).toBe(400);
});

it('rejects a deleted user, even with the session version unchanged', async () => {
  const { key, user } = await registered();
  await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });
  const pending = await loginOptions();
  expect((await post('login/verify', key.authenticate(pending.options, { counter: 1 }), pending.cookie)).statusCode).toBe(400);
});

it('rejects cross-origin requests and refuses account switching while logged in', async () => {
  expect((await post('register/options', account, undefined, 'https://attacker.example')).statusCode).toBe(403);
  const { cookie } = await registered();
  expect((await post('register/options', account, cookie)).statusCode).toBe(409);
  expect((await post('login/options', undefined, cookie)).statusCode).toBe(409);
});

it('normalizes names and does not create an account for invalid or abandoned signup attempts', async () => {
  expect((await post('register/options', { ...account, displayName: '\u200B ' })).statusCode).toBe(400);
  const pending = await registration({ discordUserId: account.discordUserId, discordUsername: ' @maple_user ', displayName: ' Maple Player ' });
  expect(pending.options.user).toMatchObject({ name: 'maple_user', displayName: 'Maple Player' });
  expect(await prisma.user.count()).toBe(0);
  await registration(account, pending.cookie);
  expect(await prisma.passkeyChallenge.count()).toBe(1);
});

it('rate limits repeated anonymous attempts', async () => {
  for (let i = 0; i < 60; i++) expect((await post('login/options')).statusCode).toBe(200);
  expect((await post('login/options')).statusCode).toBe(429);
});
