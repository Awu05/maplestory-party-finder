import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { loadConfig, withUtcSession } from './config.js';
import { buildApp } from './app.js';
import { HttpNexonClient } from './nexon/client.js';
import { HttpDiscordOAuth } from './auth/discordOAuth.js';
import { EventDispatcher } from './notifications/dispatcher.js';
import { HttpWebhookSender } from './discord/sender.js';
import { WebhookWorker } from './discord/outbox.js';
import { DailySyncJob } from './jobs/dailySync.js';
import { WeeklyReminderJob } from './jobs/weeklyReminders.js';
import { RunReminderJob } from './jobs/runReminders.js';
import { LocalDiskStorage } from './storage/storage.js';
import { LocalScouterValidator, OcrWorker } from './storage/scouterValidator.js';
import { SmtpPasswordResetMailer } from './auth/resetMailer.js';

const config = loadConfig(process.env);
mkdirSync(config.uploadDir, { recursive: true });
const prisma = new PrismaClient({ datasources: { db: { url: withUtcSession(config.databaseUrl) } } });
const storage = new LocalDiskStorage(config.uploadDir);
// The app logger only exists after buildApp; the shim forwards to it (events are emitted only by requests, after that).
let appLog: { error(obj: object, msg: string): void; warn(obj: object, msg: string): void } | undefined;
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
  scouterValidator: new LocalScouterValidator({ worker: new OcrWorker({ log: { warn: (obj, msg) => appLog?.warn(obj, msg) } }) }),
  passwordResetMailer: config.smtp ? new SmtpPasswordResetMailer(config.smtp) : undefined,
});
appLog = app.log;
await app.listen({ port: config.port, host: '0.0.0.0' });

const log = { error: (obj: object, msg: string) => app.log.error(obj, msg) };
const worker = new WebhookWorker({ prisma, sender: webhookSender, log });
const job = new DailySyncJob({ prisma, nexon, log });
const weeklyReminders = new WeeklyReminderJob({ prisma, storage, webOrigin: config.webOrigin, log });
const runReminders = new RunReminderJob({ prisma, webOrigin: config.webOrigin, log });
if (config.jobsEnabled) {
  worker.start(5_000);
  job.start(3_600_000);
  weeklyReminders.start();
  runReminders.start();
  app.log.info('Webhook worker, daily sync, weekly and run reminder jobs started');
} else {
  app.log.info('JOBS_ENABLED is false: background jobs not started');
}

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'Shutting down');
  let code = 0;
  try {
    // Finish in-flight work before disconnecting the database.
    await Promise.all([job.stop(), weeklyReminders.stop(), runReminders.stop(), worker.stop()]);
  } catch (err) {
    code = 1;
    app.log.error({ err }, 'Error stopping background jobs');
  }
  try {
    // app.close() first: it stops accepting connections and waits for in-flight requests, so every
    // event has been emitted by the time the dispatcher drains.
    await app.close();
  } catch (err) {
    code = 1;
    app.log.error({ err }, 'Error closing app');
  }
  try {
    await dispatcher.drain();
  } catch (err) {
    code = 1;
    app.log.error({ err }, 'Error draining events');
  }
  try {
    await prisma.$disconnect();
  } catch (err) {
    code = 1;
    app.log.error({ err }, 'Error disconnecting database');
  }
  process.exit(code);
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
