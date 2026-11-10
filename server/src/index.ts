import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from './config.js';
import { buildApp } from './app.js';
import { HttpNexonClient } from './nexon/client.js';
import { HttpDiscordOAuth } from './auth/discordOAuth.js';
import { EventDispatcher } from './notifications/dispatcher.js';
import { HttpWebhookSender } from './discord/sender.js';
import { WebhookWorker } from './discord/outbox.js';
import { DailySyncJob } from './jobs/dailySync.js';
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
const nexon = new HttpNexonClient({});
const webhookSender = new HttpWebhookSender();
const app = await buildApp({
  config,
  nexon,
  prisma,
  discord: new HttpDiscordOAuth(config),
  storage,
  events: dispatcher,
  webhookSender,
});
appLog = app.log;
await app.listen({ port: config.port, host: '0.0.0.0' });

const log = { error: (obj: object, msg: string) => app.log.error(obj, msg) };
const worker = new WebhookWorker({ prisma, sender: webhookSender, log });
const job = new DailySyncJob({ prisma, nexon, log });
if (config.jobsEnabled) {
  worker.start(5_000);
  job.start(3_600_000);
  app.log.info('Webhook worker and daily sync job started');
} else {
  app.log.info('JOBS_ENABLED is false: webhook worker and daily sync job not started');
}

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'Shutting down');
  try {
    await job.stop();
    await worker.stop();
    await dispatcher.drain();
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
