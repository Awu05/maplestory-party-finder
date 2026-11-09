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
  constructor(private readonly config: Pick<Config, 'discordClientId' | 'discordClientSecret' | 'discordRedirectUri'>) {}

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
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
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

    const meRes = await fetch('https://discord.com/api/users/@me', {
      headers: { authorization: `Bearer ${access_token}` },
    });
    if (!meRes.ok) throw new Error(`Discord profile fetch failed: ${meRes.status}`);
    const me = (await meRes.json()) as { id: string; username: string; avatar: string | null };
    return {
      discordId: me.id,
      username: me.username,
      avatarUrl: me.avatar ? `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png` : null,
    };
  }
}
