import { afterAll, describe, expect, it } from 'vitest';
import { HttpDiscordOAuth } from '../src/auth/discordOAuth.js';
import { buildTestApp, prisma, resetDb, testConfig } from './helpers.js';

/** A fetch that never answers on its own, but rejects once its abort signal fires. */
const hangingFetch: typeof fetch = (_input, init) =>
  new Promise((_resolve, reject) => {
    const signal = init?.signal;
    if (!signal) return; // Without a signal it hangs forever, which the test timeout would catch.
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });

const oauthConfig = { discordClientId: 'id', discordClientSecret: 'secret', discordRedirectUri: 'http://localhost/cb' };

afterAll(async () => {
  await prisma.$disconnect();
});

describe('HttpDiscordOAuth timeouts', () => {
  it('a token request that never answers rejects after the timeout', async () => {
    const oauth = new HttpDiscordOAuth(oauthConfig, { fetch: hangingFetch, timeoutMs: 20 });
    await expect(oauth.exchangeCode('code')).rejects.toThrow();
  }, 2000);

  it('a profile request that never answers rejects after the timeout', async () => {
    let calls = 0;
    const fetchFn: typeof fetch = (input, init) => {
      calls++;
      if (String(input).endsWith('/oauth2/token')) return Promise.resolve(Response.json({ access_token: 't' }));
      return hangingFetch(input, init);
    };
    const oauth = new HttpDiscordOAuth(oauthConfig, { fetch: fetchFn, timeoutMs: 20 });
    await expect(oauth.exchangeCode('code')).rejects.toThrow();
    expect(calls).toBe(2);
  }, 2000);

  it('the callback route redirects to ?login=failed when Discord hangs', async () => {
    await resetDb();
    const config = testConfig();
    const { app } = await buildTestApp({ config, discord: new HttpDiscordOAuth(config, { fetch: hangingFetch, timeoutMs: 20 }) });
    try {
      const start = await app.inject({ method: 'GET', url: '/api/auth/discord' });
      const state = new URL(String(start.headers.location)).searchParams.get('state')!;
      const cookie = String(start.headers['set-cookie']).split(';')[0]!;
      const res = await app.inject({ method: 'GET', url: `/api/auth/discord/callback?code=abc&state=${state}`, headers: { cookie } });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('http://localhost:5173/?login=failed');
      expect(await prisma.user.count()).toBe(0);
    } finally {
      await app.close();
    }
  }, 2000);
});

describe('HttpDiscordOAuth profile', () => {
  const withProfile = (profile: unknown) => new HttpDiscordOAuth(oauthConfig, {
    fetch: (input) => Promise.resolve(Response.json(String(input).endsWith('/oauth2/token') ? { access_token: 't' } : profile)),
  });

  it('returns the id, username and avatar url', async () => {
    await expect(withProfile({ id: '123', username: 'maple_user', avatar: 'abc' }).exchangeCode('code')).resolves.toEqual({
      discordId: '123', username: 'maple_user', avatarUrl: 'https://cdn.discordapp.com/avatars/123/abc.png',
    });
    await expect(withProfile({ id: '123', username: 'maple_user', avatar: null }).exchangeCode('code')).resolves.toMatchObject({ avatarUrl: null });
  });

  it.each([
    ['an empty username', { id: '123', username: '' }], ['no username', { id: '123' }],
    ['an empty id', { id: '', username: 'maple_user' }], ['a non-string id', { id: 123, username: 'maple_user' }],
  ])('rejects a profile with %s, so it can never log in or claim a name', async (_label, profile) => {
    await expect(withProfile(profile).exchangeCode('code')).rejects.toThrow('missing an id or username');
  });
});
