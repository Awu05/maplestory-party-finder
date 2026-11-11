import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, prisma, resetDb } from './helpers.js';

const origin = 'http://localhost:5173';
const email = 'maple@example.com';
const oldPassword = 'a long maple password';
const password = 'my new maple password';
const signup = { email, password: oldPassword, discordUsername: 'maple', displayName: 'Maple' };
let app: FastifyInstance;
let sent: { to: string; url: string }[];
let failMail = false;
const post = (path: string, payload: object, cookie?: string) => app.inject({ method: 'POST', url: `/api/auth/password/${path}`, headers: { origin, host: 'attacker.example', ...(cookie ? { cookie } : {}) }, payload });
const cookieOf = (response: { headers: { 'set-cookie'?: string | string[] } }) => String(response.headers['set-cookie']).split(';')[0]!;
const tokenAt = (index = 0) => new URLSearchParams(new URL(sent[index]!.url).hash.slice(1)).get('token')!;
beforeEach(async () => {
  await resetDb(); sent = []; failMail = false;
  ({ app } = await buildTestApp({ passwordResetMailer: { send: async (to, url) => { sent.push({ to, url }); if (failMail) throw new Error(url); } } }));
});
afterEach(async () => { await app.close(); });
async function request() {
  expect((await post('forgot', { email })).statusCode).toBe(200);
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  return tokenAt();
}

it('emails a hashed, expiring token and resets the password while revoking all previous sessions', async () => {
  const registered = await post('register', signup);
  expect(registered.statusCode).toBe(200);
  const second = await post('login', { email, password: oldPassword });
  const token = await request();
  expect(sent[0]!.to).toBe(email);
  expect(sent[0]!.url).toMatch(/^http:\/\/localhost:5173\/reset-password#token=/);
  expect(sent[0]!.url).not.toContain('attacker');
  const stored = await prisma.passwordResetToken.findUniqueOrThrow({ where: { userId: registered.json().id } });
  expect(stored.tokenHash).toBe(createHash('sha256').update(token).digest('hex'));
  expect(stored.tokenHash).not.toBe(token);
  expect(stored.expiresAt.getTime() - Date.now()).toBeGreaterThan(29 * 60_000);
  const reset = await post('reset', { token, password });
  expect(reset.statusCode).toBe(204);
  expect(await prisma.passwordResetToken.count()).toBe(0);
  for (const old of [registered, second]) {
    const headers = { cookie: cookieOf(old) };
    expect((await app.inject({ url: '/api/auth/me', headers })).json()).toBeNull();
    expect((await app.inject({ method: 'PATCH', url: '/api/auth/me', headers, payload: { displayName: 'Changed' } })).statusCode).toBe(401);
  }
  expect((await post('login', { email, password: oldPassword })).statusCode).toBe(401);
  const login = await post('login', { email, password }, cookieOf(second));
  expect(login.statusCode).toBe(200);
  expect((await app.inject({ url: '/api/auth/me', headers: { cookie: cookieOf(login) } })).json().id).toBe(registered.json().id);
  expect((await post('reset', { token, password: oldPassword })).statusCode).toBe(400);
});

it('does not reveal account existence or send reset emails for unknown or banned users', async () => {
  const user = await post('register', signup);
  const unknown = await post('forgot', { email: 'unknown@example.com' });
  const known = await post('forgot', { email: ' MAPLE@EXAMPLE.COM ' });
  expect(unknown.statusCode).toBe(200);
  expect(known.json()).toEqual(unknown.json());
  expect(JSON.stringify(known.json())).not.toContain('token');
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  await prisma.user.update({ where: { id: user.json().id }, data: { banned: true } });
  const banned = await post('forgot', { email });
  expect(banned.json()).toEqual(known.json());
  await app.close();
  expect(sent).toHaveLength(1);
});

it('rejects expired and fabricated tokens without changing the password', async () => {
  await post('register', signup);
  const token = await request();
  await prisma.passwordResetToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } });
  expect((await post('reset', { token, password })).statusCode).toBe(400);
  expect((await post('reset', { token: 'x'.repeat(43), password })).statusCode).toBe(400);
  expect((await post('login', { email, password: oldPassword })).statusCode).toBe(200);
});

it('replaces older links and consumes a token once under concurrent reset requests', async () => {
  const account = await post('register', signup);
  const first = await request();
  await post('forgot', { email });
  await vi.waitFor(() => expect(sent).toHaveLength(2));
  const token = tokenAt(1);
  expect(token).not.toBe(first);
  expect((await post('reset', { token: first, password })).statusCode).toBe(400);
  const results = await Promise.all([post('reset', { token, password }), post('reset', { token, password })]);
  expect(results.map((result) => result.statusCode).sort()).toEqual([204, 400]);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: account.json().id } })).sessionVersion).toBe(1);
});

it('validates new passwords before consuming a reset token and rejects banned account resets', async () => {
  const account = await post('register', signup);
  const token = await request();
  expect((await post('reset', { token, password: 'short' })).statusCode).toBe(400);
  expect(await prisma.passwordResetToken.count()).toBe(1);
  await prisma.user.update({ where: { id: account.json().id }, data: { banned: true } });
  expect((await post('reset', { token, password })).statusCode).toBe(400);
  expect((await prisma.user.findUniqueOrThrow({ where: { id: account.json().id } })).sessionVersion).toBe(0);
});

it('invalidates reset tokens issued for an earlier session version', async () => {
  const account = await post('register', signup);
  const token = await request();
  await prisma.user.update({ where: { id: account.json().id }, data: { sessionVersion: { increment: 1 } } });
  expect((await post('reset', { token, password })).statusCode).toBe(400);
});

it('handles email delivery failures without exposing links and removes the unusable token', async () => {
  await post('register', signup);
  failMail = true;
  const response = await post('forgot', { email });
  expect(response.statusCode).toBe(200);
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  await vi.waitFor(async () => expect(await prisma.passwordResetToken.count()).toBe(0));
  expect(response.body).not.toContain(tokenAt());
});

it('returns an actionable error when email is unconfigured', async () => {
  await app.close();
  ({ app } = await buildTestApp());
  const response = await post('forgot', { email });
  expect(response.statusCode).toBe(503);
  expect(response.json().error.code).toBe('RESET_UNAVAILABLE');
});

it('caps reset emails per address silently, with the same response as always', async () => {
  await post('register', signup);
  const responses = [];
  for (let i = 0; i < 5; i++) responses.push(await post('forgot', { email }));
  expect(responses.map((response) => response.statusCode)).toEqual([200, 200, 200, 200, 200]);
  expect(new Set(responses.map((response) => response.body)).size).toBe(1);
  await vi.waitFor(() => expect(sent).toHaveLength(3));
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(sent).toHaveLength(3);
});

it('rejects cross-origin reset submissions', async () => {
  expect((await app.inject({ method: 'POST', url: '/api/auth/password/forgot', headers: { origin: 'https://attacker.example' }, payload: { email } })).statusCode).toBe(403);
});
