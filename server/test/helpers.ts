import os from 'node:os';
import path from 'node:path';
import type { Config } from '../src/config.js';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    databaseUrl: 'postgresql://pf:pf@localhost:5432/partyfinder_test',
    sessionSecret: 'test-session-secret-at-least-32-characters-long',
    discordClientId: 'test-client-id',
    discordClientSecret: 'test-client-secret',
    discordRedirectUri: 'http://localhost:3000/api/auth/discord/callback',
    webOrigin: 'http://localhost:5173',
    adminDiscordIds: ['admin-1'],
    uploadDir: path.join(os.tmpdir(), 'pf-test-uploads'),
    ...overrides,
  };
}
