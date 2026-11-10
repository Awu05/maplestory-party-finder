export interface Config {
  port: number;
  databaseUrl: string;
  sessionSecret: string;
  discordClientId: string;
  discordClientSecret: string;
  discordRedirectUri: string;
  webOrigin: string;
  adminDiscordIds: string[];
  uploadDir: string;
  /** Built web app directory; when set, the server serves it (production only). */
  webDist?: string;
  /** Run the webhook worker and daily sync job in this process (disable on a second instance). */
  jobsEnabled: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const required = (key: string): string => {
    const v = env[key];
    if (!v) throw new Error(`Missing required env var ${key}`);
    return v;
  };
  const sessionSecret = required('SESSION_SECRET');
  if (sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: required('DATABASE_URL'),
    sessionSecret,
    discordClientId: env.DISCORD_CLIENT_ID ?? '',
    discordClientSecret: env.DISCORD_CLIENT_SECRET ?? '',
    discordRedirectUri: env.DISCORD_REDIRECT_URI ?? '',
    webOrigin: env.WEB_ORIGIN ?? 'http://localhost:5173',
    adminDiscordIds: (env.ADMIN_DISCORD_IDS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    uploadDir: env.UPLOAD_DIR ?? './uploads',
    webDist: env.WEB_DIST || undefined,
    jobsEnabled: !['false', '0'].includes((env.JOBS_ENABLED ?? '').trim().toLowerCase()),
  };
}
