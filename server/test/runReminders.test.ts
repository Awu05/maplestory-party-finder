import { beforeEach, expect, it } from 'vitest';
import type { Prisma, PrismaClient } from '@prisma/client';
import { RunReminderJob } from '../src/jobs/runReminders.js';
import { WebhookWorker } from '../src/discord/outbox.js';
import { WeeklyReminderJob } from '../src/jobs/weeklyReminders.js';
import { LocalDiskStorage } from '../src/storage/storage.js';
import { addMember, FakeWebhookSender, makeCharacter, makePost, makeUser, prisma, resetDb } from './helpers.js';

const T = new Date('2027-01-15T20:00:00Z');
const before = (minutes: number) => new Date(T.getTime() - minutes * 60_000);
const job = () => new RunReminderJob({ prisma, webOrigin: 'https://pf.example' });
beforeEach(resetDb);

async function party(over: Parameters<typeof makePost>[0] = {}) {
  const post = await makePost({ scheduledAt: T, status: 'closed', closedReason: 'finalized', reminderOffsets: [15, 1440], partyThreadId: 'thread-1', ...over });
  await prisma.guild.update({ where: { id: post.partyForumGuildId! }, data: { partyForumWebhookUrl: 'https://discord.test/forum' } });
  return post;
}

it('claims once across concurrent jobs and notifies every member including the poster', async () => {
  const post = await party();
  const user = await makeUser({ discordId: null, typedDiscordId: '123456789012345678' });
  const character = await makeCharacter({ ownerId: user.id, worldId: post.worldId });
  await addMember(post.id, character.id);
  await Promise.all([job().runOnce(before(15)), job().runOnce(before(15))]);
  expect(await prisma.postReminderSent.count()).toBe(2);
  const notifications = await prisma.notification.findMany();
  expect(notifications).toHaveLength(2);
  expect(notifications.map((n) => n.userId).sort()).toEqual([post.posterUserId, user.id].sort());
  expect(notifications[0]).toMatchObject({ kind: 'reminder', text: 'Reminder:  starts in 15 minutes', link: `/posts/${post.id}` });
  const deliveries = await prisma.webhookDelivery.findMany();
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]!.payload).toMatchObject({ _reminder: { runAt: T.toISOString(), offsetMinutes: 15 } });
  expect(await job().runOnce(before(15))).toBe(0);
});

it('records stale offsets and sends only the closest due reminder', async () => {
  await party({ title: 'Crew' });
  await job().runOnce(before(10));
  expect(await prisma.postReminderSent.count()).toBe(2);
  expect(await prisma.notification.count()).toBe(1);
  // Fired 5 minutes late, so the bell says how long is actually left.
  expect((await prisma.notification.findFirstOrThrow()).text).toBe('Reminder: Crew starts in 10 minutes');
});

it('records reminders over 15 minutes late without sending a backlog', async () => {
  await party({ reminderOffsets: [1440] });
  await job().runOnce(before(1424));
  expect(await prisma.postReminderSent.count()).toBe(1);
  expect(await prisma.notification.count()).toBe(0);
  expect(await prisma.webhookDelivery.count()).toBe(0);
});

it('sends bell notifications without a thread or usable forum', async () => {
  await party({ partyThreadId: null });
  await job().runOnce(before(15));
  expect(await prisma.notification.count()).toBe(1);
  expect(await prisma.webhookDelivery.count()).toBe(0);
});

it.each([
  { status: 'closed' as const, closedReason: 'manual' }, { deletedAt: before(30) },
  { scheduledAt: null }, { type: 'lfp' as const }, { status: 'open' as const },
])('ignores ineligible posts %j', async (over) => {
  await party(over);
  expect(await job().runOnce(before(15))).toBe(0);
  expect(await prisma.notification.count()).toBe(0);
});

it.each([{ banned: true }, { deletedAt: before(30) }])('ignores an unavailable poster %j', async (data) => {
  const post = await party();
  await prisma.user.update({ where: { id: post.posterUserId }, data });
  expect(await job().runOnce(before(15))).toBe(0);
});

it('gives a rescheduled run its own reminders and drops the old queued delivery', async () => {
  const post = await party({ reminderOffsets: [15] });
  await job().runOnce(before(15));
  const next = new Date(T.getTime() + 86_400_000);
  await prisma.post.update({ where: { id: post.id }, data: { scheduledAt: next, expiresAt: new Date(next.getTime() + 3_600_000) } });
  const sender = new FakeWebhookSender();
  await new WebhookWorker({ prisma, sender, now: () => before(10) }).runOnce();
  expect(sender.calls).toHaveLength(0);
  await job().runOnce(new Date(next.getTime() - 15 * 60_000));
  expect(await prisma.notification.count()).toBe(2);
  expect(await prisma.postReminderSent.count()).toBe(2);
});

it('rebuilds current linked and typed pings and sends into the party thread', async () => {
  const post = await party({ reminderOffsets: [15] });
  await prisma.user.update({ where: { id: post.posterUserId }, data: { discordId: '223456789012345678' } });
  const user = await makeUser({ discordId: null, typedDiscordId: '123456789012345678' });
  const character = await makeCharacter({ ownerId: user.id, worldId: post.worldId });
  await addMember(post.id, character.id);
  const leavingUser = await makeUser({ discordId: '323456789012345678' });
  const leaving = await makeCharacter({ ownerId: leavingUser.id, worldId: post.worldId });
  const member = await addMember(post.id, leaving.id);
  await job().runOnce(before(15));
  await prisma.postMember.delete({ where: { id: member.id } });
  const sender = new FakeWebhookSender();
  await new WebhookWorker({ prisma, sender, now: () => before(10) }).runOnce();
  expect(sender.calls).toHaveLength(1);
  expect(sender.calls[0]).toMatchObject({ url: 'https://discord.test/forum', threadId: 'thread-1', payload: { allowed_mentions: { parse: [], users: ['223456789012345678', '123456789012345678'] } } });
  expect(sender.calls[0]!.payload).not.toHaveProperty('_reminder');
});

it.each(['offset', 'started', 'closed', 'banned'])('drops a queued reminder when %s changes', async (change) => {
  const post = await party();
  await job().runOnce(before(15));
  if (change === 'offset') await prisma.post.update({ where: { id: post.id }, data: { reminderOffsets: [] } });
  if (change === 'closed') await prisma.post.update({ where: { id: post.id }, data: { closedReason: 'manual' } });
  if (change === 'banned') await prisma.user.update({ where: { id: post.posterUserId }, data: { banned: true } });
  const sender = new FakeWebhookSender();
  await new WebhookWorker({ prisma, sender, now: () => change === 'started' ? T : before(10) }).runOnce();
  expect(sender.calls).toHaveLength(0);
});

it('clears a missing thread after a 404, so later reminders go to the bell only', async () => {
  const post = await party();
  await job().runOnce(before(1440));
  const sender = new FakeWebhookSender();
  sender.queue({ ok: false, status: 404, error: 'HTTP 404', discordCode: 10003 });
  await new WebhookWorker({ prisma, sender, now: () => before(1439) }).runOnce();
  expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).partyThreadId).toBeNull();
  await job().runOnce(before(15));
  expect(await prisma.notification.count()).toBe(2);
  expect(await prisma.webhookDelivery.count()).toBe(1);
});

it('reminds once for the next weekly occurrence', async () => {
  const post = await party({ weeklyTimeZone: 'UTC', weeklyAnchorAt: T, reminderOffsets: [15] });
  await job().runOnce(before(15));
  await new WeeklyReminderJob({ prisma, storage: new LocalDiskStorage('test-uploads'), webOrigin: 'https://pf.example' }).runOnce(T);
  const next = new Date(T.getTime() + 7 * 86_400_000 - 15 * 60_000);
  expect(await job().runOnce(next)).toBe(1);
  expect(await job().runOnce(next)).toBe(0);
  expect(await prisma.postReminderSent.count({ where: { postId: post.id } })).toBe(2);
});

it('cleans up records for runs more than a week old', async () => {
  const post = await party();
  await prisma.postReminderSent.create({ data: { postId: post.id, offsetMinutes: 15, runAt: new Date(T.getTime() - 10 * 86_400_000) } });
  await job().runOnce(before(2000));
  expect(await prisma.postReminderSent.count()).toBe(0);
});

it('keeps the thread when the 404 is a deleted webhook, not a deleted thread', async () => {
  const post = await party();
  await job().runOnce(before(1440));
  const sender = new FakeWebhookSender();
  sender.queue({ ok: false, status: 404, error: 'HTTP 404', discordCode: 10015 });
  await new WebhookWorker({ prisma, sender, now: () => before(1439) }).runOnce();
  expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).partyThreadId).toBe('thread-1');
  expect((await prisma.webhookDelivery.findFirstOrThrow()).status).toBe('failed');
});

function failingFor(postId: () => string, times = Infinity) {
  let left = times;
  return new Proxy(prisma, { get(target, key) {
    if (key !== '$transaction') return Reflect.get(target, key);
    return (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => target.$transaction((tx) => callback(new Proxy(tx, { get(inner, name) {
      if (name !== 'notification') return Reflect.get(inner, name);
      return { createMany: async (args: { data: Prisma.NotificationCreateManyInput[] }) => {
        if (left > 0 && args.data.some((row) => row.link === `/posts/${postId()}`)) { left--; throw new Error('boom'); }
        return inner.notification.createMany(args);
      } };
    } })));
  } }) as PrismaClient;
}

it('retries a one-off failure on the next pass instead of dropping the reminder', async () => {
  const post = await party({ reminderOffsets: [15] });
  const runner = new RunReminderJob({ prisma: failingFor(() => post.id, 1), webOrigin: 'https://pf.example', log: { error: () => undefined } });
  expect(await runner.runOnce(before(15))).toBe(0);
  expect(await prisma.postReminderSent.count()).toBe(0);
  expect(await runner.runOnce(before(14))).toBe(1);
  expect(await prisma.notification.count()).toBe(1);
});

it('drops a queued reminder that retries leave more than 15 minutes old', async () => {
  await party({ reminderOffsets: [1440] });
  await job().runOnce(before(1440));
  const sender = new FakeWebhookSender();
  await new WebhookWorker({ prisma, sender, now: () => before(1424) }).runOnce();
  expect(sender.calls).toHaveLength(0);
  expect(await prisma.webhookDelivery.count()).toBe(0);
});

it('leaves banned members out of the reminder message entirely', async () => {
  const post = await party({ reminderOffsets: [15] });
  const banned = await makeUser({ discordId: null, typedDiscordId: null, banned: true });
  await addMember(post.id, (await makeCharacter({ ownerId: banned.id, worldId: post.worldId, ign: 'Banned' })).id);
  await job().runOnce(before(15));
  const sender = new FakeWebhookSender();
  await new WebhookWorker({ prisma, sender, now: () => before(14) }).runOnce();
  expect(sender.calls[0]!.payload.content).not.toContain('Banned');
});

it('gives up on a post after it fails three passes in a row, so other parties still get their reminders', async () => {
  const bad = await party({ scheduledAt: new Date(T.getTime() - 60_000), reminderOffsets: [15] });
  const good = await party({ reminderOffsets: [15] });
  const runner = new RunReminderJob({ prisma: failingFor(() => bad.id), webOrigin: 'https://pf.example', log: { error: () => undefined } });
  expect(await runner.runOnce(before(15))).toBe(1);
  expect(await prisma.notification.findMany({ select: { link: true } })).toEqual([{ link: `/posts/${good.id}` }]);
  expect(await prisma.postReminderSent.count({ where: { postId: bad.id } })).toBe(0);
  expect(await runner.runOnce(before(15))).toBe(0);
  expect(await runner.runOnce(before(15))).toBe(0);
  expect(await prisma.postReminderSent.count({ where: { postId: bad.id } })).toBe(1);
  expect(await runner.runOnce(before(15))).toBe(0);
});
