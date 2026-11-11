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
  /** Fastify request logging (on in the real server, off in tests). */
  logger: boolean;
  smtp?: { host: string; port: number; secure: boolean; user?: string; password?: string; from: string };
}

function smtpConfig(env: NodeJS.ProcessEnv): Config['smtp'] {
  if (![env.SMTP_HOST, env.SMTP_FROM, env.SMTP_USER, env.SMTP_PASSWORD, env.SMTP_PORT, env.SMTP_SECURE].some((value) => value?.trim())) return undefined;
  if (!env.SMTP_HOST?.trim() || !env.SMTP_FROM?.trim()) throw new Error('SMTP_HOST and SMTP_FROM are required for password-reset email');
  if (/[\r\n]/.test(env.SMTP_HOST + env.SMTP_FROM) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.SMTP_FROM.trim())) throw new Error('Invalid SMTP_HOST or SMTP_FROM');
  if (env.SMTP_SECURE && !['true', 'false'].includes(env.SMTP_SECURE.trim().toLowerCase())) throw new Error('SMTP_SECURE must be true or false');
  const secure = env.SMTP_SECURE?.trim().toLowerCase() === 'true';
  const port = Number(env.SMTP_PORT?.trim() || (secure ? 465 : 587));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('SMTP_PORT must be an integer from 1 to 65535');
  if (!!env.SMTP_USER !== !!env.SMTP_PASSWORD) throw new Error('Set both SMTP_USER and SMTP_PASSWORD, or neither');
  return { host: env.SMTP_HOST.trim(), from: env.SMTP_FROM.trim(), port, secure, user: env.SMTP_USER, password: env.SMTP_PASSWORD };
}

/** PORT: unset or blank means 3000; otherwise a plain integer from 1 to 65535. */
function parsePort(raw: string | undefined): number {
  const v = (raw ?? '').trim();
  if (v === '') return 3000;
  const n = /^\d+$/.test(v) ? Number(v) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw new Error(`PORT must be an integer from 1 to 65535 (got ${JSON.stringify(raw)})`);
  return n;
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
    port: parsePort(env.PORT),
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
    logger: true,
    smtp: smtpConfig(env),
  };
}

/**
 * Forces the database session time zone to UTC. Times are stored as UTC wall-clock values without a
 * zone, and raw queries compare them with JS dates; Postgres converts those dates into the *session*
 * zone first. A database server set to another zone (a home server on Eastern time, say) would then
 * shift every comparison, e.g. queued webhooks would look 5 hours from being due and never send.
 */
export function withUtcSession(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  const options = url.searchParams.get('options') ?? '';
  if (/TimeZone\s*=/i.test(options)) return databaseUrl;
  url.searchParams.set('options', [options, '-c TimeZone=UTC'].filter(Boolean).join(' '));
  return url.toString();
}
