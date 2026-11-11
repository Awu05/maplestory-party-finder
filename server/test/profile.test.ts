import { beforeEach, afterEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, loginAs, prisma, resetDb, makeCharacter, makeWorld } from './helpers.js';

let app: FastifyInstance;
beforeEach(async () => {
  await resetDb();
  ({ app } = await buildTestApp());
});
afterEach(async () => { await app.close(); });

it('saves a trimmed display name, exposes it on characters, and preserves it across Discord login', async () => {
  let cookie = await loginAs(app, 'profile-user', 'discord_name');
  const save = await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: { cookie }, payload: { displayName: '  Maple Friend  ' } });
  expect(save.statusCode).toBe(200);
  expect(save.json()).toMatchObject({ displayName: 'Maple Friend', discordUsername: 'discord_name' });
  cookie = await loginAs(app, 'profile-user', 'new_discord_name');
  const me = (await app.inject({ url: '/api/auth/me', headers: { cookie } })).json();
  expect(me).toMatchObject({ displayName: 'Maple Friend', discordUsername: 'new_discord_name' });
  const world = await makeWorld();
  const character = await makeCharacter({ ownerId: me.id, worldId: world.id });
  const detail = await app.inject({ url: `/api/characters/${character.id}` });
  expect(detail.json().owner).toEqual({ displayName: 'Maple Friend', discordUsername: 'new_discord_name', discordLinked: true });
  const cleared = await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: { cookie }, payload: { displayName: '   ' } });
  expect(cleared.json().displayName).toBeNull();
});

it('requires a signed-in, non-banned account and validates profile updates', async () => {
  const update = (payload: unknown, cookie?: string) => app.inject({ method: 'PATCH', url: '/api/auth/me', headers: cookie ? { cookie } : {}, payload: payload as object });
  expect((await update({ displayName: 'Name' })).statusCode).toBe(401);
  const cookie = await loginAs(app, 'profile-user');
  for (const payload of [{}, { displayName: 42 }, { displayName: 'x'.repeat(51) }]) {
    expect((await update(payload, cookie)).statusCode).toBe(400);
  }
  await prisma.user.update({ where: { discordId: 'profile-user' }, data: { banned: true } });
  expect((await update({ displayName: 'Name' }, cookie)).statusCode).toBe(403);
});

it('admin search matches the display name and the Discord username', async () => {
  const cookie = await loginAs(app, 'admin-1');
  const userCookie = await loginAs(app, 'profile-user', 'discord_name');
  await app.inject({ method: 'PATCH', url: '/api/auth/me', headers: { cookie: userCookie }, payload: { displayName: 'Maple Friend' } });
  for (const q of ['maple', 'discord']) {
    const response = await app.inject({ url: `/api/admin/users?q=${q}`, headers: { cookie } });
    expect(response.json()).toEqual([expect.objectContaining({ displayName: 'Maple Friend', discordUsername: 'discord_name' })]);
  }
});

it('strips invisible and control characters, so an invisible name falls back to the Discord username', async () => {
  const cookie = await loginAs(app, 'u-zw', 'discord_name');
  const save = (displayName: string) =>
    app.inject({ method: 'PATCH', url: '/api/auth/me', headers: { cookie }, payload: { displayName } });
  expect((await save('\u200B\u200D\u0007 ')).json().displayName).toBeNull();
  expect((await save('Ma\u200Bple\u0000')).json().displayName).toBe('Maple');
});
