import type { Config } from '../config.js';

export interface DiscordProfile {
  discordId: string;
  username: string;
  avatarUrl: string | null;
}

export interface DiscordOAuth {
  authorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<DiscordProfile>;
}

export class HttpDiscordOAuth implements DiscordOAuth {
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    private readonly config: Pick<Config, 'discordClientId' | 'discordClientSecret' | 'discordRedirectUri'>,
    /** Each Discord request aborts after `timeoutMs` (default 8s), so a hung Discord fails the login instead of hanging it. */
    opts: { fetch?: typeof fetch; timeoutMs?: number } = {},
  ) {
    this.fetchFn = opts.fetch ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 8000;
  }

  authorizeUrl(state: string): string {
    const params = new URLSearchParams({
      client_id: this.config.discordClientId,
      redirect_uri: this.config.discordRedirectUri,
      response_type: 'code',
      scope: 'identify',
      state,
    });
    return `https://discord.com/oauth2/authorize?${params}`;
  }

  async exchangeCode(code: string): Promise<DiscordProfile> {
    const tokenRes = await this.fetchFn('https://discord.com/api/oauth2/token', {
      method: 'POST',
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.config.discordClientId,
        client_secret: this.config.discordClientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.config.discordRedirectUri,
      }),
    });
    if (!tokenRes.ok) throw new Error(`Discord token exchange failed: ${tokenRes.status}`);
    const { access_token } = (await tokenRes.json()) as { access_token: string };

    const meRes = await this.fetchFn('https://discord.com/api/users/@me', {
      signal: AbortSignal.timeout(this.timeoutMs),
      headers: { authorization: `Bearer ${access_token}` },
    });
    if (!meRes.ok) throw new Error(`Discord profile fetch failed: ${meRes.status}`);
    const me = (await meRes.json()) as { id?: unknown; username?: unknown; avatar?: unknown };
    // Never trust the shape: an account must have a real ID and name before it can log in or claim one.
    if (typeof me.id !== 'string' || me.id === '' || typeof me.username !== 'string' || me.username === '') {
      throw new Error('Discord profile is missing an id or username');
    }
    return {
      discordId: me.id,
      username: me.username,
      avatarUrl: typeof me.avatar === 'string' && me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png` : null,
    };
  }
}
