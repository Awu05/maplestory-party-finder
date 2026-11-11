import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, loginAs, makeUser, prisma, resetDb } from './helpers.js';
import { DerivationQueue, hashPassword, verifyPassword } from '../src/auth/passwordHash.js';

const ORIGIN = 'http://localhost:5173';
const password = 'a long maple password';
const account = { discordUsername: 'maple_user', displayName: 'Maple Player', email: 'maple@example.com', password };
let app: FastifyInstance;
beforeEach(async () => { await resetDb(); ({ app } = await buildTestApp()); });
afterEach(async () => { await app.close(); });
const post = (path: string, payload: unknown, cookie?: string, origin = ORIGIN) => app.inject({ method: 'POST', url: `/api/auth/password/${path}`, headers: { origin, ...(cookie ? { cookie } : {}) }, payload: payload as object });
const cookieOf = (response: { headers: { 'set-cookie'?: string | string[] } }) => String(response.headers['set-cookie']).split(';')[0]!;

it('creates a private credential, starts a session, and signs back in after logout', async () => {
  const result = await post('register', { ...account, email: ' Maple@Example.COM ' });
  expect(result.statusCode).toBe(200);
  expect(result.json()).toMatchObject({ discordUsername: account.discordUsername, displayName: account.displayName, discordLinked: false, isAdmin: false });
  expect(result.json()).not.toHaveProperty('email');
  expect(result.body).not.toContain(password);
  expect(result.json()).not.toHaveProperty('passwordHash');
  const user = await prisma.user.findUniqueOrThrow({ where: { id: result.json().id } });
  expect(user.discordId).toBeNull();
  const credential = await prisma.passwordCredential.findUniqueOrThrow({ where: { userId: user.id } });
  expect(credential.email).toBe(account.email);
  expect(credential.passwordHash).not.toContain(password);
  expect(await verifyPassword(password, credential.passwordHash)).toBe(true);
  const cookie = cookieOf(result);
  expect((await app.inject({ url: '/api/auth/me', headers: { cookie } })).json().id).toBe(user.id);
  await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
  const login = await post('login', { email: 'MAPLE@example.com', password });
  expect(login.statusCode).toBe(200);
  expect((await app.inject({ url: '/api/auth/me', headers: { cookie: cookieOf(login) } })).json().id).toBe(user.id);
});

it('never links a contact username to an existing Discord administrator', async () => {
  const admin = await makeUser({ discordId: 'admin-1', username: account.discordUsername });
  const result = await post('register', account);
  expect(result.statusCode).toBe(200);
  expect(result.json().id).not.toBe(admin.id);
  expect(result.json().isAdmin).toBe(false);
  expect((await app.inject({ url: '/api/admin/users', headers: { cookie: cookieOf(result) } })).statusCode).toBe(403);
  const cookie = await loginAs(app, 'admin-1', account.discordUsername);
  expect((await app.inject({ url: '/api/auth/me', headers: { cookie } })).json().id).toBe(admin.id);
});

it('rejects duplicate email addresses atomically without replacing the first account', async () => {
  const results = await Promise.all([post('register', account), post('register', { ...account, email: 'MAPLE@EXAMPLE.COM', password: 'a different long password' })]);
  expect(results.map((result) => result.statusCode).sort()).toEqual([200, 400]);
  expect(await prisma.user.count()).toBe(1);
  expect(await prisma.passwordCredential.count()).toBe(1);
});

it.each([
  { email: 'invalid' }, { password: 'too short' }, { password: 'x'.repeat(129) },
  { discordUsername: ' @ ' }, { displayName: '\u200B ' }, { discordId: 'admin-1' },
])('rejects invalid registration details without creating an account (%j)', async (overrides) => {
  expect((await post('register', { ...account, ...overrides })).statusCode).toBe(400);
  expect(await prisma.user.count()).toBe(0);
});

it('preserves password spaces and uses different salts for identical passwords', async () => {
  const padded = `  ${password}  `;
  const result = await post('register', { ...account, password: padded });
  expect(result.statusCode).toBe(200);
  expect((await post('login', { email: account.email, password })).statusCode).toBe(401);
  expect((await post('login', { email: account.email, password: padded })).statusCode).toBe(200);
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  expect(first).not.toBe(second);
  expect(await verifyPassword(password, first)).toBe(true);
  expect(await verifyPassword(password, 'malformed')).toBe(false);
});

it('uses the same sign-in error for unknown email, wrong passwords, and banned accounts', async () => {
  const created = await post('register', account);
  const wrong = await post('login', { email: account.email, password: 'wrong' });
  const unknown = await post('login', { email: 'absent@example.com', password });
  await prisma.user.update({ where: { id: created.json().id }, data: { banned: true } });
  const banned = await post('login', { email: account.email, password });
  expect(wrong.statusCode).toBe(401);
  expect(unknown.statusCode).toBe(401);
  expect(banned.statusCode).toBe(401);
  expect(wrong.json()).toEqual(unknown.json());
  expect(wrong.json()).toEqual(banned.json());
  for (const result of [wrong, unknown, banned]) expect(result.headers['set-cookie']).toBeUndefined();
});

it('rejects cross-origin requests, active account switching, and oversized requests', async () => {
  expect((await post('register', account, undefined, 'https://attacker.example')).statusCode).toBe(403);
  expect((await app.inject({ method: 'POST', url: '/api/auth/password/login', payload: { email: account.email, password } })).statusCode).toBe(403);
  const result = await post('register', account);
  for (const path of ['login', 'register']) expect((await post(path, account, cookieOf(result))).statusCode).toBe(409);
  expect((await post('register', { ...account, displayName: 'x'.repeat(5000) })).statusCode).toBe(413);
});

it('clears unfinished passkey ceremonies when signing in with a password', async () => {
  const pending = await app.inject({ method: 'POST', url: '/api/auth/passkeys/register/options', headers: { origin: ORIGIN }, payload: { discordUsername: account.discordUsername, displayName: account.displayName } });
  expect(pending.statusCode).toBe(200);
  expect(await prisma.passkeyChallenge.count()).toBe(1);
  const result = await post('register', account, cookieOf(pending));
  expect(result.statusCode).toBe(200);
  expect(await prisma.passkeyChallenge.count()).toBe(0);
});

const loginFrom = (remoteAddress: string, payload: object) => app.inject({ method: 'POST', url: '/api/auth/password/login', remoteAddress, headers: { origin: ORIGIN }, payload });

it("limits failed attempts per email and address, so another address's failures cannot lock the owner out", async () => {
  expect((await post('register', account)).statusCode).toBe(200);
  for (let i = 0; i < 10; i++) expect((await loginFrom('192.0.2.1', { email: account.email, password: 'wrong password' })).statusCode).toBe(401);
  // The attacker's address is now limited for this email, even with the right password...
  expect((await loginFrom('192.0.2.1', { email: 'MAPLE@example.com', password })).statusCode).toBe(429);
  // ...but the owner, from their own address, can still sign in.
  expect((await loginFrom('198.51.100.7', { email: account.email, password })).statusCode).toBe(200);
}, 30_000);

it('does not count successful sign-ins against the failed-attempt limit', async () => {
  expect((await post('register', account)).statusCode).toBe(200);
  for (let i = 0; i < 12; i++) expect((await loginFrom('192.0.2.2', { email: account.email, password })).statusCode).toBe(200);
}, 30_000);

it('queues concurrent password work instead of rejecting it', async () => {
  const stored = await hashPassword(password);
  const results = await Promise.all(Array.from({ length: 5 }, () => verifyPassword(password, stored)));
  expect(results).toEqual([true, true, true, true, true]);
}, 20_000);

it('runs a bounded number of jobs at once and rejects only when its wait queue is full', async () => {
  const queue = new DerivationQueue(2, 2);
  let running = 0;
  let peak = 0;
  const releases: (() => void)[] = [];
  const job = () => queue.run(() => new Promise<void>((resolve) => {
    running++; peak = Math.max(peak, running);
    releases.push(() => { running--; resolve(); });
  }));
  const accepted = [job(), job(), job(), job()];
  await expect(job()).rejects.toMatchObject({ status: 429, code: 'AUTH_BUSY' });
  expect(releases).toHaveLength(2);
  // Waiters start in arrival order as running jobs finish.
  while (releases.length) { releases.shift()!(); await new Promise((resolve) => setImmediate(resolve)); }
  await Promise.all(accepted);
  expect(peak).toBe(2);
  await expect(queue.run(async () => 'ok')).resolves.toBe('ok');
});
