import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { HttpNexonClient } from './nexon/client.js';
import { HttpDiscordOAuth } from './auth/discordOAuth.js';

const config = loadConfig(process.env);
const app = await buildApp({
  config,
  nexon: new HttpNexonClient({}),
  prisma: new PrismaClient({ datasources: { db: { url: config.databaseUrl } } }),
  discord: new HttpDiscordOAuth(config),
});
await app.listen({ port: config.port, host: '0.0.0.0' });
