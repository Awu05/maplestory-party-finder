import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { HttpNexonClient } from './nexon/client.js';
import { HttpDiscordOAuth } from './auth/discordOAuth.js';
import { NoopEvents } from './events.js';
import { LocalDiskStorage } from './storage/storage.js';

const config = loadConfig(process.env);
mkdirSync(config.uploadDir, { recursive: true });
const prisma = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
const app = await buildApp({
  config,
  nexon: new HttpNexonClient({}),
  prisma,
  discord: new HttpDiscordOAuth(config),
  storage: new LocalDiskStorage(config.uploadDir),
  events: new NoopEvents(),
});
await app.listen({ port: config.port, host: '0.0.0.0' });

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'Shutting down');
  try {
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
