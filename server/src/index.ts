import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { HttpNexonClient } from './nexon/client.js';
import { HttpDiscordOAuth } from './auth/discordOAuth.js';
import { LocalDiskStorage } from './storage/storage.js';

const config = loadConfig(process.env);
mkdirSync(config.uploadDir, { recursive: true });
const app = await buildApp({
  config,
  nexon: new HttpNexonClient({}),
  prisma: new PrismaClient({ datasources: { db: { url: config.databaseUrl } } }),
  discord: new HttpDiscordOAuth(config),
  storage: new LocalDiskStorage(config.uploadDir),
});
await app.listen({ port: config.port, host: '0.0.0.0' });
