import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { PublicKeyCredentialCreationOptionsJSON, PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/server';
import { buildTestApp, loginAs, makeCharacter, makeUser, prisma, resetDb } from './helpers.js';
import { VirtualPasskey } from './passkeyFixtures.js';

const ORIGIN = 'http://localhost:5173';
let app: FastifyInstance;
beforeEach(async () => { await resetDb(); ({ app } = await buildTestApp()); });
afterEach(async () => { await app.close(); });

const post = (url: string, payload?: unknown, cookie?: string) => app.inject({ method: 'POST', url, headers: { origin: ORIGIN, ...(cookie ? { cookie } : {}) }, ...(payload === undefined ? {} : { payload: payload as object }) });
const cookieOf = (response: { headers: { 'set-cookie'?: string | string[] } }) => String(response.headers['set-cookie']).split(';')[0]!;
const sessionOf = (cookie: string) => app.decodeSecureSession(decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)))?.data();
const cookieWith = (data: Record<string, unknown>) => `pf_session=${encodeURIComponent(app.encodeSecureSession(app.createSecureSession(data)))}`;
const me = async (cookie: string) => (await app.inject({ url: '/api/auth/me', headers: { cookie } })).json();

async function passkeyAccount(discordUsername = 'typed_name') {
  const key = new VirtualPasskey();
  const options = await post('/api/auth/passkeys/register/options', { discordUsername, displayName: 'Maple Player' });
  const result = await post('/api/auth/passkeys/register/verify', key.register(options.json<PublicKeyCredentialCreationOptionsJSON>()), cookieOf(options));
  expect(result.statusCode).toBe(200);
  return { key, id: result.json().id as string, cookie: cookieOf(result) };
}

/** GET /api/auth/discord/link, returning the state Discord would echo back and the updated cookie. */
async function startLink(cookie: string) {
  const start = await app.inject({ url: '/api/auth/discord/link', headers: { cookie } });
  expect(start.statusCode).toBe(302);
  const state = new URL(String(start.headers.location)).searchParams.get('state')!;
  return { state, cookie: cookieOf(start), location: String(start.headers.location) };
}
const callback = (code: string, state: string, cookie: string) =>
  app.inject({ url: `/api/auth/discord/callback?code=${encodeURIComponent(code)}&state=${state}`, headers: { cookie } });

it('links a passkey account to Discord: same account, verified name, Discord login and passkey both sign in to it', async () => {
  const local = await passkeyAccount();
  const character = await makeCharacter({ ownerId: local.id });
  const pending = await startLink(local.cookie);
  expect(pending.location).toBe(`https://discord.test/authorize?state=${pending.state}`);
  expect(sessionOf(pending.cookie)).toMatchObject({ userId: local.id, linkUserId: local.id, oauthState: pending.state });

  const done = await callback('fake:d-1:Real_Name', pending.state, pending.cookie);
  expect(done.statusCode).toBe(302);
  expect(done.headers.location).toBe(`${ORIGIN}/?link=done`);
  // A fresh session for the same user; the link state is gone.
  expect(sessionOf(cookieOf(done))).toEqual({ userId: local.id, sessionVersion: 0 });
  expect(await prisma.user.findUniqueOrThrow({ where: { id: local.id } })).toMatchObject({ discordId: 'd-1', username: 'Real_Name', usernameKey: 'real_name' });
  expect(await me(cookieOf(done))).toMatchObject({ id: local.id, discordUsername: 'Real_Name', discordLinked: true, displayName: 'Maple Player' });
  expect((await app.inject({ url: `/api/characters/${character.id}` })).json().owner).toMatchObject({ discordUsername: 'Real_Name', discordLinked: true });

  // Logging in with Discord later signs in to this same account.
  const discordCookie = await loginAs(app, 'd-1', 'Real_Name');
  expect((await me(discordCookie)).id).toBe(local.id);
  expect(await prisma.user.count()).toBe(1);
  expect((await prisma.character.findUniqueOrThrow({ where: { id: character.id } })).ownerId).toBe(local.id);
  // The passkey still works.
  const options = await post('/api/auth/passkeys/login/options');
  const signedIn = await post('/api/auth/passkeys/login/verify', local.key.authenticate(options.json<PublicKeyCredentialRequestOptionsJSON>()), cookieOf(options));
  expect(signedIn.json()).toMatchObject({ id: local.id, discordLinked: true });
});

it('real Discord wins when linking: another unlinked account holding the name gives it up', async () => {
  const other = await passkeyAccount('real_name');
  const local = await passkeyAccount();
  const pending = await startLink(local.cookie);
  expect((await callback('fake:d-1:Real_Name', pending.state, pending.cookie)).headers.location).toBe(`${ORIGIN}/?link=done`);
  expect(await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).toMatchObject({ username: '', usernameKey: null, discordId: null });
  expect(await prisma.user.findUniqueOrThrow({ where: { id: local.id } })).toMatchObject({ usernameKey: 'real_name' });
});

it('never merges into, or logs in to, a Discord account that already has its own Party Finder account', async () => {
  const existing = await makeUser({ discordId: 'd-1', username: 'real_name', usernameKey: 'real_name' });
  const local = await passkeyAccount();
  const pending = await startLink(local.cookie);
  const result = await callback('fake:d-1:real_name', pending.state, pending.cookie);
  expect(result.headers.location).toBe(`${ORIGIN}/?link=taken`);
  const session = sessionOf(cookieOf(result));
  expect(session).toMatchObject({ userId: local.id, sessionVersion: 0 });
  expect(session).not.toHaveProperty('linkUserId');
  expect(session).not.toHaveProperty('oauthState');
  expect((await me(cookieOf(result))).id).toBe(local.id);
  expect(await prisma.user.findUniqueOrThrow({ where: { id: local.id } })).toMatchObject({ discordId: null, username: 'typed_name', usernameKey: 'typed_name' });
  expect(await prisma.user.findUniqueOrThrow({ where: { id: existing.id } })).toMatchObject({ discordId: 'd-1', username: 'real_name' });
});

it('requires a signed-in account and sends an already-linked account back', async () => {
  const loggedOut = await app.inject({ url: '/api/auth/discord/link' });
  expect(loggedOut.statusCode).toBe(302);
  expect(loggedOut.headers.location).toBe(`${ORIGIN}/?link=failed`);
  const cookie = await loginAs(app, 'd-1', 'real_name');
  const result = await app.inject({ url: '/api/auth/discord/link', headers: { cookie } });
  expect(result.statusCode).toBe(302);
  expect(result.headers.location).toBe(`${ORIGIN}/?link=already`);
});

it('never links on a bad or missing state, and the link request is single-use', async () => {
  const local = await passkeyAccount();
  const pending = await startLink(local.cookie);
  const bad = await callback('fake:d-1:real_name', 'wrong', pending.cookie);
  expect(bad.headers.location).toBe(`${ORIGIN}/?link=failed`);
  expect(sessionOf(cookieOf(bad))).not.toHaveProperty('linkUserId');
  // The cleared session can't finish the link with the right state either.
  expect((await callback('fake:d-1:real_name', pending.state, cookieOf(bad))).headers.location).not.toBe(`${ORIGIN}/?link=done`);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: local.id } })).discordId).toBeNull();
});

it('fails the link when the session now belongs to someone else, or the account changed since it started', async () => {
  const a = await passkeyAccount('name_a');
  const b = await passkeyAccount('name_b');
  const mismatched = cookieWith({ userId: b.id, sessionVersion: 0, oauthState: 's1', linkUserId: a.id });
  const mismatch = await callback('fake:d-1:real_name', 's1', mismatched);
  expect(mismatch.headers.location).toBe(`${ORIGIN}/?link=failed`);
  expect(await prisma.user.count({ where: { discordId: { not: null } } })).toBe(0);

  const changes = [{ banned: true }, { sessionVersion: 1 }, { discordId: 'd-other' }];
  for (const change of changes) {
    const pending = await startLink(a.cookie);
    await prisma.user.update({ where: { id: a.id }, data: change });
    expect((await callback('fake:d-1:real_name', pending.state, pending.cookie)).headers.location).toBe(`${ORIGIN}/?link=failed`);
    await prisma.user.update({ where: { id: a.id }, data: { banned: false, sessionVersion: 0, discordId: null } });
  }
  expect(await prisma.user.findUnique({ where: { discordId: 'd-1' } })).toBeNull();
});

it('a plain Discord login after an abandoned link request is an ordinary login', async () => {
  const local = await passkeyAccount();
  const abandoned = await startLink(local.cookie);
  const start = await app.inject({ url: '/api/auth/discord', headers: { cookie: abandoned.cookie } });
  expect(sessionOf(cookieOf(start))).not.toHaveProperty('linkUserId');
  const state = new URL(String(start.headers.location)).searchParams.get('state')!;
  const result = await callback('fake:d-2:someone', state, cookieOf(start));
  expect(result.headers.location).toBe(`${ORIGIN}/me/characters`);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: local.id } })).discordId).toBeNull();
  expect(await prisma.user.findUniqueOrThrow({ where: { discordId: 'd-2' } })).not.toMatchObject({ id: local.id });
});

it('starting a link from another site is refused, and a logged-out or banned start redirects instead of showing an error page', async () => {
  const local = await passkeyAccount();
  const crossSite = await app.inject({ url: '/api/auth/discord/link', headers: { cookie: local.cookie, 'sec-fetch-site': 'cross-site' } });
  expect(crossSite.statusCode).toBe(302);
  expect(crossSite.headers.location).toBe(`${ORIGIN}/?link=failed`);
  expect(crossSite.headers['set-cookie']).toBeUndefined();
  const sameOrigin = await app.inject({ url: '/api/auth/discord/link', headers: { cookie: local.cookie, 'sec-fetch-site': 'same-origin' } });
  expect(String(sameOrigin.headers.location)).toContain('https://discord.test/authorize');

  const loggedOut = await app.inject({ url: '/api/auth/discord/link' });
  expect(loggedOut.statusCode).toBe(302);
  expect(loggedOut.headers.location).toBe(`${ORIGIN}/?link=failed`);
  await prisma.user.update({ where: { id: local.id }, data: { banned: true } });
  const banned = await app.inject({ url: '/api/auth/discord/link', headers: { cookie: local.cookie } });
  expect(banned.statusCode).toBe(302);
  expect(banned.headers.location).toBe(`${ORIGIN}/?link=failed`);
});

it('a link callback while logged out, or after Discord reports an error, fails and clears the request', async () => {
  const local = await passkeyAccount();
  const pending = await startLink(local.cookie);
  const denied = await app.inject({ url: `/api/auth/discord/callback?error=access_denied&state=${pending.state}`, headers: { cookie: pending.cookie } });
  expect(denied.headers.location).toBe(`${ORIGIN}/?link=failed`);
  expect(sessionOf(cookieOf(denied))).not.toHaveProperty('linkUserId');
  const orphan = cookieWith({ oauthState: 'state-1', linkUserId: local.id });
  const loggedOut = await callback('fake:d-9:someone', 'state-1', orphan);
  expect(loggedOut.headers.location).toBe(`${ORIGIN}/?link=failed`);
  expect(await prisma.user.findUniqueOrThrow({ where: { id: local.id } })).toMatchObject({ discordId: null });
});
