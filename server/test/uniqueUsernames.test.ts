import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';
import { buildTestApp, loginAs, makeUser, prisma, resetDb } from './helpers.js';
import { VirtualPasskey } from './passkeyFixtures.js';

const ORIGIN = 'http://localhost:5173';
const account = { discordUsername: 'maple_user', displayName: 'Maple Player' };
const password = 'a long maple password';
let app: FastifyInstance;
beforeEach(async () => { await resetDb(); ({ app } = await buildTestApp()); });
afterEach(async () => { await app.close(); });

const post = (url: string, payload?: unknown, cookie?: string) => app.inject({ method: 'POST', url, headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) }, ...(payload === undefined ? {} : { payload: payload as object }) });
const cookieOf = (response: { headers: { 'set-cookie'?: string | string[] } }) => String(response.headers['set-cookie']).split(';')[0]!;
const patchMe = (payload: object, cookie: string) => app.inject({ method: 'PATCH', url: '/api/auth/me', headers: { cookie }, payload });
const taken = { error: { code: 'USERNAME_TAKEN', message: 'That Discord username is already in use.' } };

async function passkeyAccount(input = account) {
  const options = await post('/api/auth/passkeys/register/options', input);
  expect(options.statusCode).toBe(200);
  const result = await post('/api/auth/passkeys/register/verify', new VirtualPasskey().register(options.json<PublicKeyCredentialCreationOptionsJSON>()), cookieOf(options));
  expect(result.statusCode).toBe(200);
  return { id: result.json().id as string, cookie: cookieOf(result) };
}

it('claims the typed name (lower-cased) at sign-up', async () => {
  const { id } = await passkeyAccount({ ...account, discordUsername: ' @Maple_User ' });
  expect(await prisma.user.findUniqueOrThrow({ where: { id } })).toMatchObject({ username: 'Maple_User', usernameKey: 'maple_user' });
  const result = await post('/api/auth/password/register', { discordUsername: 'Other', displayName: 'P', email: 'p@example.com', password });
  expect(await prisma.user.findUniqueOrThrow({ where: { id: result.json().id } })).toMatchObject({ username: 'Other', usernameKey: 'other' });
});

it('refuses a passkey sign-up whose name is already claimed (any case), before the passkey prompt', async () => {
  await makeUser({ username: 'maple_user', usernameKey: 'maple_user' });
  const options = await post('/api/auth/passkeys/register/options', { ...account, discordUsername: '@MAPLE_USER' });
  expect(options.statusCode).toBe(409);
  expect(options.json()).toEqual(taken);
  expect(await prisma.passkeyChallenge.count()).toBe(0);
});

it('refuses a passkey account whose name was claimed between the options and verify steps', async () => {
  const options = await post('/api/auth/passkeys/register/options', account);
  expect(options.statusCode).toBe(200);
  await makeUser({ username: 'Maple_User', usernameKey: 'maple_user' });
  const result = await post('/api/auth/passkeys/register/verify', new VirtualPasskey().register(options.json<PublicKeyCredentialCreationOptionsJSON>()), cookieOf(options));
  expect(result.statusCode).toBe(409);
  expect(result.json()).toEqual(taken);
  expect(await prisma.user.count()).toBe(1);
  expect(await prisma.passkey.count()).toBe(0);
});

it('refuses a password sign-up whose name is claimed, including two at once', async () => {
  const register = (email: string, discordUsername = 'maple_user') => post('/api/auth/password/register', { ...account, discordUsername, email, password });
  const results = await Promise.all([register('a@example.com'), register('b@example.com', 'MAPLE_user')]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  expect(results.find((r) => r.statusCode === 409)!.json()).toEqual(taken);
  expect(await prisma.user.count()).toBe(1);
  expect(await prisma.passwordCredential.count()).toBe(1);
  expect((await register('c@example.com')).json()).toEqual(taken);
}, 20_000);

it('real Discord wins: logging in with Discord takes the name from an unlinked account, which must pick a new one', async () => {
  const local = await passkeyAccount();
  const discordCookie = await loginAs(app, 'd-1', 'Maple_User');
  const discordUser = await prisma.user.findUniqueOrThrow({ where: { discordId: 'd-1' } });
  expect(discordUser).toMatchObject({ username: 'Maple_User', usernameKey: 'maple_user' });
  expect(await prisma.user.findUniqueOrThrow({ where: { id: local.id } })).toMatchObject({ username: '', usernameKey: null, discordId: null });
  expect((await app.inject({ url: '/api/auth/me', headers: { cookie: local.cookie } })).json()).toMatchObject({ id: local.id, discordUsername: '', discordLinked: false });
  // Logging in again keeps the claim on the same account.
  await loginAs(app, 'd-1', 'maple_user');
  expect(await prisma.user.findUniqueOrThrow({ where: { discordId: 'd-1' } })).toMatchObject({ id: discordUser.id, usernameKey: 'maple_user' });
  expect(discordCookie).toBeTruthy();
});

it('real Discord wins over a stale name on another Discord account, which keeps its text until its next login', async () => {
  const stale = await makeUser({ discordId: 'd-old', username: 'maple_user', usernameKey: 'maple_user' });
  await loginAs(app, 'd-new', 'maple_user');
  expect(await prisma.user.findUniqueOrThrow({ where: { id: stale.id } })).toMatchObject({ username: 'maple_user', usernameKey: null });
  expect(await prisma.user.findUniqueOrThrow({ where: { discordId: 'd-new' } })).toMatchObject({ usernameKey: 'maple_user' });
  await loginAs(app, 'd-old', 'renamed');
  expect(await prisma.user.findUniqueOrThrow({ where: { id: stale.id } })).toMatchObject({ username: 'renamed', usernameKey: 'renamed' });
});

it('lets an unlinked account set a new Discord username, checked for uniqueness and still unverified', async () => {
  const local = await passkeyAccount();
  await loginAs(app, 'd-1', 'maple_user');
  await makeUser({ username: 'Taken', usernameKey: 'taken' });
  const clash = await patchMe({ discordUsername: 'TAKEN' }, local.cookie);
  expect(clash.statusCode).toBe(409);
  expect(clash.json()).toEqual(taken);
  const saved = await patchMe({ discordUsername: ' @New_Name​ ' }, local.cookie);
  expect(saved.statusCode).toBe(200);
  expect(saved.json()).toMatchObject({ discordUsername: 'New_Name', discordLinked: false, displayName: account.displayName });
  expect(await prisma.user.findUniqueOrThrow({ where: { id: local.id } })).toMatchObject({ username: 'New_Name', usernameKey: 'new_name' });
  // Re-saving its own name in another case is not a clash.
  expect((await patchMe({ discordUsername: 'new_name', displayName: 'Renamed' }, local.cookie)).json()).toMatchObject({ discordUsername: 'new_name', displayName: 'Renamed' });
  for (const discordUsername of ['', ' @ ', '​', 'x'.repeat(51)]) expect((await patchMe({ discordUsername }, local.cookie)).statusCode).toBe(400);
});

it('refuses a Discord username change on a Discord-linked account', async () => {
  const cookie = await loginAs(app, 'd-1', 'maple_user');
  const result = await patchMe({ discordUsername: 'something_else' }, cookie);
  expect(result.statusCode).toBe(400);
  expect(result.json()).toEqual({ error: { code: 'DISCORD_LINKED', message: 'Your Discord username comes from Discord.' } });
  expect((await prisma.user.findUniqueOrThrow({ where: { discordId: 'd-1' } })).username).toBe('maple_user');
  expect((await patchMe({ displayName: 'Still fine' }, cookie)).statusCode).toBe(200);
});

it('typed names are canonical: every leading @ and the spaces around them are dropped, so lookalikes collide', async () => {
  await passkeyAccount({ ...account, discordUsername: 'maple_user' });
  for (const lookalike of ['@ maple_user', '@@maple_user', ' @ @MAPLE_USER ']) {
    const result = await post('/api/auth/passkeys/register/options', { ...account, discordUsername: lookalike });
    expect(result.statusCode, lookalike).toBe(409);
    expect(result.json()).toEqual(taken);
  }
});

it.each([
  ['a space inside', 'maple user'], ['a no-break space', 'maple\u00a0user'], ['a Cyrillic lookalike letter', 'm\u0430ple_user'],
  ['a fullwidth letter', '\uff4daple_user'], ['a combining mark', 'maple_user\u0301'], ['an invisible-only name', '\u3164'],
  ['one character', 'a'], ['33 characters', 'x'.repeat(33)], ['only an @', '@'],
])('rejects a typed Discord username with %s', async (_label, discordUsername) => {
  const signUp = await post('/api/auth/passkeys/register/options', { ...account, discordUsername });
  expect(signUp.statusCode).toBe(400);
  const { cookie } = await passkeyAccount();
  const edit = await patchMe({ discordUsername }, cookie);
  expect(edit.statusCode).toBe(400);
  expect((await prisma.user.findMany()).every((u) => u.usernameKey === null || /^[a-z0-9_.]{2,32}$/.test(u.usernameKey))).toBe(true);
});

it('accepts Discord-style names of 2 to 32 letters, digits, dots and underscores', async () => {
  for (const [i, discordUsername] of ['ab', 'Maple.User_99', 'x'.repeat(32)].entries()) {
    const result = await post('/api/auth/passkeys/register/options', { displayName: `P${i}`, discordUsername });
    expect(result.statusCode, discordUsername).toBe(200);
  }
});
