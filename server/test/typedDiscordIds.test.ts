import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';
import { VirtualPasskey } from './passkeyFixtures.js';
import { buildTestApp, loginAs, makeUser, prisma, resetDb } from './helpers.js';

const ID = '123456789012345678';
const OTHER = '223456789012345678';
const account = { discordUsername: 'typed_user', discordUserId: ID, displayName: 'Player', email: 'p@example.com', password: 'a long maple password' };
let app: FastifyInstance;
beforeEach(async () => { await resetDb(); ({ app } = await buildTestApp()); });
afterEach(async () => { await app.close(); });
const post = (url: string, payload: object, cookie?: string) => app.inject({ method: 'POST', url: `/api/auth/${url}`, headers: { origin: 'http://localhost:5173', ...(cookie ? { cookie } : {}) }, payload });
const cookieOf = (r: { headers: { 'set-cookie'?: string | string[] } }) => String(r.headers['set-cookie']).split(';')[0]!;

it.each(['password/register', 'passkeys/register/options'])('requires a user ID for %s', async (url) => {
  const { discordUserId, email, password, ...rest } = account;
  const result = await post(url, url.startsWith('password') ? { ...rest, email, password } : rest);
  expect(result.statusCode).toBe(400);
  expect(result.json().error.code).toBe('VALIDATION');
});

it('normalizes a pasted ID, keeps it separate from sign-in identity and returns it only to its owner', async () => {
  const result = await post('password/register', { ...account, discordUserId: ' 123 456789012345678\u200b ' });
  expect(result.statusCode).toBe(200);
  expect(result.json()).toMatchObject({ discordUserId: ID, discordLinked: false });
  expect(await prisma.user.findUniqueOrThrow({ where: { id: result.json().id } })).toMatchObject({ typedDiscordId: ID, discordId: null });
});

it.each([{ discordId: ID }, { discordId: null, typedDiscordId: ID }])('refuses an ID held by another account %j', async (over) => {
  await makeUser(over);
  const result = await post('password/register', account);
  expect(result.statusCode).toBe(409);
  expect(result.json().error.code).toBe('DISCORD_ID_TAKEN');
  const options = await post('passkeys/register/options', { discordUsername: 'passkey_user', discordUserId: ID, displayName: 'Player' });
  expect(options.statusCode).toBe(409);
});

it('stores the ID through passkey registration and rechecks ownership at verification', async () => {
  const input = { discordUsername: account.discordUsername, discordUserId: ID, displayName: account.displayName };
  let options = await post('passkeys/register/options', input);
  expect(options.statusCode).toBe(200);
  await makeUser({ discordId: ID });
  let result = await post('passkeys/register/verify', new VirtualPasskey().register(options.json<PublicKeyCredentialCreationOptionsJSON>()), cookieOf(options));
  expect(result.statusCode).toBe(409);
  options = await post('passkeys/register/options', { ...input, discordUserId: OTHER });
  result = await post('passkeys/register/verify', new VirtualPasskey().register(options.json<PublicKeyCredentialCreationOptionsJSON>()), cookieOf(options));
  expect(result.statusCode).toBe(200);
  expect(await prisma.user.findUniqueOrThrow({ where: { id: result.json().id } })).toMatchObject({ typedDiscordId: OTHER, discordId: null });
});

it('lets unlinked members update their own ID, rejects conflicts, and refuses edits after linking', async () => {
  const result = await post('password/register', account);
  const cookie = cookieOf(result);
  const patch = (discordUserId: string, c = cookie) => app.inject({ method: 'PATCH', url: '/api/auth/me', headers: { cookie: c }, payload: { discordUserId } });
  await makeUser({ discordId: OTHER });
  expect((await patch(OTHER)).statusCode).toBe(409);
  expect((await patch('323456789012345678')).json().discordUserId).toBe('323456789012345678');
  expect((await app.inject({ url: '/api/auth/me', headers: { cookie } })).json().discordUserId).toBe('323456789012345678');
  const linked = await loginAs(app, OTHER);
  const denied = await patch(ID, linked);
  expect(denied.statusCode).toBe(400);
  expect(denied.json().error.code).toBe('DISCORD_LINKED');
});

it('a verified OAuth owner clears another account typed ID without signing into that account', async () => {
  const typed = await makeUser({ discordId: null, typedDiscordId: ID });
  const cookie = await loginAs(app, ID);
  const me = (await app.inject({ url: '/api/auth/me', headers: { cookie } })).json();
  expect(me.id).not.toBe(typed.id);
  expect(me.discordUserId).toBe(ID);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: typed.id } })).typedDiscordId).toBeNull();
});

it('keeps the verified owner when registration and OAuth compete for the same ID', async () => {
  const [registration, cookie] = await Promise.all([post('password/register', account), loginAs(app, ID, 'verified_owner')]);
  expect([200, 409]).toContain(registration.statusCode);
  const me = (await app.inject({ url: '/api/auth/me', headers: { cookie } })).json();
  expect(me).toMatchObject({ discordUserId: ID, discordLinked: true });
  expect(await prisma.user.count({ where: { typedDiscordId: ID } })).toBe(0);
});

it('linking clears the linker typed ID and a competing typed claim', async () => {
  const local = await post('password/register', account);
  const other = await makeUser({ discordId: null, typedDiscordId: OTHER });
  const start = await app.inject({ url: '/api/auth/discord/link', headers: { cookie: cookieOf(local) } });
  const state = new URL(String(start.headers.location)).searchParams.get('state');
  const done = await app.inject({ url: `/api/auth/discord/callback?code=fake:${OTHER}:verified&state=${state}`, headers: { cookie: cookieOf(start) } });
  expect(done.headers.location).toContain('link=done');
  expect((await prisma.user.findUniqueOrThrow({ where: { id: local.json().id } })).typedDiscordId).toBeNull();
  expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).typedDiscordId).toBeNull();
});

it.each([{ banned: true }, { deletedAt: new Date() }])('a removed account never blocks its typed ID %j', async (removed) => {
  const holder = await makeUser({ discordId: null, typedDiscordId: ID, ...removed });
  const result = await post('password/register', account);
  expect(result.statusCode).toBe(200);
  expect(result.json().discordUserId).toBe(ID);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: holder.id } })).typedDiscordId).toBeNull();
});
