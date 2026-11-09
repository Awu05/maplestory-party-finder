import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { HttpNexonClient } from './nexon/client.js';
import { HttpDiscordOAuth } from './auth/discordOAuth.js';
import { EventDispatcher } from './notifications/dispatcher.js';
import { HttpWebhookSender } from './discord/sender.js';
import { LocalDiskStorage } from './storage/storage.js';

const config = loadConfig(process.env);
mkdirSync(config.uploadDir, { recursive: true });
const prisma = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
const storage = new LocalDiskStorage(config.uploadDir);
// The app logger only exists after buildApp; the shim forwards to it (events are emitted only by requests, after that).
let appLog: { error(obj: object, msg: string): void } | undefined;
const dispatcher = new EventDispatcher({
  prisma,
  storage,
  webOrigin: config.webOrigin,
  log: { error: (obj, msg) => appLog?.error(obj, msg) },
});
const app = await buildApp({
  config,
  nexon: new HttpNexonClient({}),
  prisma,
  discord: new HttpDiscordOAuth(config),
  storage,
  events: dispatcher,
  webhookSender: new HttpWebhookSender(),
});
appLog = app.log;
await app.listen({ port: config.port, host: '0.0.0.0' });

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'Shutting down');
  try {
    await app.close();
    await dispatcher.drain();
    await prisma.$disconnect();
    process.exit(0);
  } catch (err) {
    app.log.error({ err }, 'Error during shutdown');
    process.exit(1);
  }
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
