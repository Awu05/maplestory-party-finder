import { afterEach, beforeEach, expect, it } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/server';
import { buildTestApp, loginAs, prisma, resetDb } from './helpers.js';
import { VirtualPasskey } from './passkeyFixtures.js';

// Simulates another account grabbing the name between the release step and the write: the app gets a
// Prisma client whose transactions interfere just before the user upsert / link update, one plan step
// per attempt. 'row' inserts a rival row holding the key, committed outside the transaction like a
// concurrent request. 'conflict' fails the write with the same unique-index error Postgres would raise;
// a real second rival would block on the row the retry just released, so it can't be staged with a row.
// 'ban' bans the linking account just before its link update, so that update matches no row.
type Step = 'row' | 'conflict' | 'ban';
const race = { plan: [] as Step[], made: 0 };
type Tx = Prisma.TransactionClient;
function racingPrisma(): PrismaClient {
  const beforeWrite = async (username: unknown, userId?: unknown) => {
    const step = race.plan.shift();
    if (!step || typeof username !== 'string') return;
    race.made++;
    if (step === 'ban') { await prisma.user.update({ where: { id: String(userId) }, data: { banned: true } }); return; }
    if (step === 'row') await prisma.user.create({ data: { username, usernameKey: username.toLowerCase() } });
    else throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`usernameKey`)', { code: 'P2002', clientVersion: Prisma.prismaVersion.client, meta: { modelName: 'User', target: ['usernameKey'] } });
  };
  const wrapTx = (tx: Tx): Tx => new Proxy(tx, {
    get(target, key, receiver) {
      if (key !== 'user') return Reflect.get(target, key, receiver);
      const users = target.user;
      return new Proxy(users, {
        get(u, k, r) {
          if (k === 'upsert') return async (args: Prisma.UserUpsertArgs) => { await beforeWrite(args.create.username); return u.upsert(args); };
          if (k === 'updateMany') return async (args: Prisma.UserUpdateManyArgs) => { await beforeWrite(args.data.username, (args.where as { id?: unknown } | undefined)?.id); return u.updateMany(args); };
          return Reflect.get(u, k, r);
        },
      });
    },
  });
  return new Proxy(prisma, {
    get(target, key) {
      if (key === '$transaction') {
        return (fn: unknown, options?: object) => typeof fn === 'function'
          ? target.$transaction((tx) => (fn as (tx: Tx) => Promise<unknown>)(wrapTx(tx)), options)
          : target.$transaction(fn as never, options);
      }
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

const ORIGIN = 'http://localhost:5173';
let app: FastifyInstance;
beforeEach(async () => { await resetDb(); race.plan = []; race.made = 0; ({ app } = await buildTestApp({ prisma: racingPrisma() })); });
afterEach(async () => { await app.close(); });

it('retries once when another account takes the name mid-login, and the real Discord account still wins', async () => {
  race.plan = ['row'];
  const cookie = await loginAs(app, 'd-1', 'maple_user');
  expect(race.made).toBe(1);
  expect((await app.inject({ url: '/api/auth/me', headers: { cookie } })).json()).toMatchObject({ discordUsername: 'maple_user', discordLinked: true });
  expect(await prisma.user.findUniqueOrThrow({ where: { discordId: 'd-1' } })).toMatchObject({ usernameKey: 'maple_user' });
});

it('still logs in, without a name claim, when the name keeps being taken', async () => {
  race.plan = ['row', 'conflict'];
  const cookie = await loginAs(app, 'd-1', 'maple_user');
  expect(race.made).toBe(2);
  expect((await app.inject({ url: '/api/auth/me', headers: { cookie } })).json()).toMatchObject({ discordUsername: 'maple_user', discordLinked: true });
  expect(await prisma.user.findUniqueOrThrow({ where: { discordId: 'd-1' } })).toMatchObject({ username: 'maple_user', usernameKey: null });
  // The next login claims the name again.
  await loginAs(app, 'd-1', 'maple_user');
  expect(await prisma.user.findUniqueOrThrow({ where: { discordId: 'd-1' } })).toMatchObject({ usernameKey: 'maple_user' });
});

it('still links when the name keeps being taken mid-link, without a name claim', async () => {
  const cookieOf = (r: { headers: { 'set-cookie'?: string | string[] } }) => String(r.headers['set-cookie']).split(';')[0]!;
  const options = await app.inject({ method: 'POST', url: '/api/auth/passkeys/register/options', headers: { origin: ORIGIN }, payload: { discordUsername: 'typed', displayName: 'P' } });
  const created = await app.inject({ method: 'POST', url: '/api/auth/passkeys/register/verify', headers: { origin: ORIGIN, cookie: cookieOf(options) }, payload: new VirtualPasskey().register(options.json<PublicKeyCredentialCreationOptionsJSON>()) });
  const start = await app.inject({ url: '/api/auth/discord/link', headers: { cookie: cookieOf(created) } });
  const state = new URL(String(start.headers.location)).searchParams.get('state')!;
  race.plan = ['row', 'conflict'];
  const done = await app.inject({ url: `/api/auth/discord/callback?code=fake:d-1:maple_user&state=${state}`, headers: { cookie: cookieOf(start) } });
  expect(done.headers.location).toBe(`${ORIGIN}/?link=done`);
  expect(await prisma.user.findUniqueOrThrow({ where: { id: created.json().id } })).toMatchObject({ discordId: 'd-1', username: 'maple_user', usernameKey: null });
});

it('a link that turns invalid at the last moment leaves the other holder of the name untouched', async () => {
  const register = async (discordUsername: string, displayName: string) => {
    const options = await app.inject({ method: 'POST', url: '/api/auth/passkeys/register/options', headers: { origin: ORIGIN }, payload: { discordUsername, displayName } });
    const done = await app.inject({ method: 'POST', url: '/api/auth/passkeys/register/verify', headers: { origin: ORIGIN, cookie: String(options.headers['set-cookie']).split(';')[0]! }, payload: new VirtualPasskey().register(options.json<PublicKeyCredentialCreationOptionsJSON>()) });
    return { id: done.json().id as string, cookie: String(done.headers['set-cookie']).split(';')[0]! };
  };
  // Bob typed the name Alice's Discord account really has.
  const bob = await register('alice_real', 'Bob');
  // Alice links her real Discord from a passkey account, but is banned just before the link is written.
  const alice = await register('alice_typed', 'Alice');
  const start = await app.inject({ url: '/api/auth/discord/link', headers: { cookie: alice.cookie } });
  const state = new URL(String(start.headers.location)).searchParams.get('state')!;
  race.plan = ['ban'];
  const done = await app.inject({ url: `/api/auth/discord/callback?code=${encodeURIComponent('fake:d-alice:alice_real')}&state=${state}`, headers: { cookie: String(start.headers['set-cookie']).split(';')[0]! } });
  expect(done.headers.location).toBe(`${ORIGIN}/?link=failed`);
  expect(race.made).toBe(1);
  // Nothing was linked, and Bob still has his name and claim.
  expect(await prisma.user.findUniqueOrThrow({ where: { id: alice.id } })).toMatchObject({ discordId: null, username: 'alice_typed' });
  expect(await prisma.user.findUniqueOrThrow({ where: { id: bob.id } })).toMatchObject({ username: 'alice_real', usernameKey: 'alice_real' });
});
