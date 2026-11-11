import { beforeEach, expect, it } from 'vitest';
import { WeeklyReminderJob } from '../src/jobs/weeklyReminders.js';
import { WebhookWorker } from '../src/discord/outbox.js';
import { addMember, buildTestApp, FakeWebhookSender, makeCharacter, makeGuild, makePost, prisma, resetDb } from './helpers.js';

const at = new Date('2027-03-08T00:30:00Z'); // Sunday 19:30 in New York, before DST.
let job: WeeklyReminderJob;
beforeEach(async () => {
  await resetDb();
  const { storage, app } = await buildTestApp();
  job = new WeeklyReminderJob({ prisma, storage, webOrigin: 'https://pf.example' });
  await app.close();
});

async function party(over: Parameters<typeof makePost>[0] = {}) {
  const guild = await makeGuild({ webhookUrl: 'https://discord.com/api/webhooks/1/test' });
  const character = await makeCharacter({ guildId: guild.id });
  const post = await makePost({ posterCharacterId: character.id, scheduledAt: at, weeklyAnchorAt: at, weeklyTimeZone: 'America/New_York', ...over });
  return { guild, character, post };
}

it('pings current members including the owner, advances to the same local time across DST, and claims once', async () => {
  const { guild, character, post } = await party();
  const member = await makeCharacter({ guildId: guild.id });
  await addMember(post.id, member.id);
  const ids = (await prisma.user.findMany({ where: { id: { in: [character.ownerId, member.ownerId] } } })).map((u) => u.discordId);
  expect(await job.runOnce(new Date(at.getTime() - 1))).toBe(0);
  await Promise.all([job.runOnce(at), job.runOnce(at)]);
  const deliveries = await prisma.webhookDelivery.findMany();
  expect(deliveries).toHaveLength(1);
  const payload = deliveries[0]!.payload as { content: string; allowed_mentions: { users: string[]; parse: string[] } };
  expect(payload.allowed_mentions.users.sort()).toEqual(ids.sort());
  expect(payload.allowed_mentions.parse).toEqual([]);
  expect(payload.content).toContain('Weekly party reminder');
  expect(payload.content).toContain(`/posts/${post.id}`);
  const updated = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
  expect(updated.scheduledAt!.toISOString()).toBe('2027-03-14T23:30:00.000Z');
  expect(updated.expiresAt.getTime()).toBe(updated.scheduledAt!.getTime() + 3 * 3600_000);
  expect(await job.runOnce(at)).toBe(0);
  expect(await job.runOnce(updated.scheduledAt!)).toBe(1);
  expect(await prisma.webhookDelivery.count()).toBe(2);
});

it('sends weekly reminders for a finalized party with recruitment closed', async () => {
  await party({ status: 'closed', closedReason: 'finalized' });
  expect(await job.runOnce(at)).toBe(1);
  await prisma.webhookDelivery.updateMany({ data: { createdAt: at } });
  const sender = new FakeWebhookSender();
  const worker = new WebhookWorker({ prisma, sender, now: () => at });
  expect((await worker.runOnce()).sent).toBe(1);
  expect(sender.calls[0]!.payload.content).toContain('Weekly party reminder');
});

it.each([
  { status: 'closed' as const },
  { deletedAt: new Date() },
  { weeklyTimeZone: null, weeklyAnchorAt: null },
])('does not remind disabled or ended parties: %j', async (over) => {
  await party(over);
  expect(await job.runOnce(at)).toBe(0);
  expect(await prisma.webhookDelivery.count()).toBe(0);
});

it('skips stale reminders after downtime and advances straight to the next future week', async () => {
  const { post } = await party();
  const now = new Date('2027-03-22T12:00:00Z');
  expect(await job.runOnce(now)).toBe(1);
  expect(await prisma.webhookDelivery.count()).toBe(0);
  const updated = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
  expect(updated.scheduledAt!.toISOString()).toBe('2027-03-28T23:30:00.000Z');
});

it('excludes removed and banned members and guilds without a webhook', async () => {
  const { guild, post } = await party();
  const member = await makeCharacter({ guildId: guild.id });
  const membership = await addMember(post.id, member.id);
  await prisma.postMember.delete({ where: { id: membership.id } });
  const banned = await makeCharacter({ guildId: guild.id });
  await addMember(post.id, banned.id);
  await prisma.user.update({ where: { id: banned.ownerId }, data: { banned: true } });
  const unconfigured = await makeGuild();
  await addMember(post.id, (await makeCharacter({ guildId: unconfigured.id })).id);
  await job.runOnce(at);
  const deliveries = await prisma.webhookDelivery.findMany();
  expect(deliveries).toHaveLength(1);
  expect((deliveries[0]!.payload as { allowed_mentions: { users: string[] } }).allowed_mentions.users).toHaveLength(1);
});

it('returns to the original wall time after the spring-forward gap', async () => {
  const anchor = new Date('2027-03-07T07:30:00Z'); // Sunday 02:30 EST.
  const { post } = await party({ scheduledAt: anchor, weeklyAnchorAt: anchor });
  await job.runOnce(anchor);
  let updated = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
  expect(updated.scheduledAt!.toISOString()).toBe('2027-03-14T07:30:00.000Z'); // 03:30 in the gap.
  await job.runOnce(updated.scheduledAt!);
  updated = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
  expect(updated.scheduledAt!.toISOString()).toBe('2027-03-21T06:30:00.000Z'); // Back to 02:30 EDT.
});

it('keeps the local time across the fall-back transition', async () => {
  const anchor = new Date('2027-10-31T23:30:00Z'); // Sunday 19:30 EDT.
  const { post } = await party({ scheduledAt: anchor, weeklyAnchorAt: anchor });
  await job.runOnce(anchor);
  const updated = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
  expect(updated.scheduledAt!.toISOString()).toBe('2027-11-08T00:30:00.000Z'); // Sunday 19:30 EST.
});

it.each([{ status: 'closed' as const }, { weeklyTimeZone: null, weeklyAnchorAt: null }])(
  'suppresses a queued reminder when the party is closed or recurrence disabled: %j', async (data) => {
    const { post } = await party();
    await job.runOnce(at);
    await prisma.webhookDelivery.updateMany({ data: { createdAt: at } });
    await prisma.post.update({ where: { id: post.id }, data });
    const sender = new FakeWebhookSender();
    const worker = new WebhookWorker({ prisma, sender, now: () => at });
    expect(await worker.runOnce()).toEqual({ sent: 0, retried: 0, failed: 1 });
    expect(sender.calls).toHaveLength(0);
  },
);

it('does not deliver stale queued reminders after an outage', async () => {
  await party();
  await job.runOnce(at);
  await prisma.webhookDelivery.updateMany({ data: { createdAt: new Date(at.getTime() - 16 * 60_000) } });
  const sender = new FakeWebhookSender();
  const worker = new WebhookWorker({ prisma, sender, now: () => at });
  expect(await worker.runOnce()).toEqual({ sent: 0, retried: 0, failed: 1 });
  expect(sender.calls).toHaveLength(0);
});

it('does not deliver a queued reminder after the weekly schedule is changed', async () => {
  const { post } = await party();
  await job.runOnce(at);
  await prisma.webhookDelivery.updateMany({ data: { createdAt: at } });
  await prisma.post.update({ where: { id: post.id }, data: { weeklyAnchorAt: new Date(at.getTime() + 3600_000) } });
  const sender = new FakeWebhookSender();
  const worker = new WebhookWorker({ prisma, sender, now: () => at });
  expect(await worker.runOnce()).toEqual({ sent: 0, retried: 0, failed: 1 });
  expect(sender.calls).toHaveLength(0);
});

it('only pings members who remain in the party at delivery time', async () => {
  const { guild, post } = await party();
  const member = await makeCharacter({ guildId: guild.id });
  const membership = await addMember(post.id, member.id);
  const discordId = (await prisma.user.findUniqueOrThrow({ where: { id: member.ownerId } })).discordId;
  await job.runOnce(at);
  await prisma.webhookDelivery.updateMany({ data: { createdAt: at } });
  await prisma.postMember.delete({ where: { id: membership.id } });
  const sender = new FakeWebhookSender();
  const worker = new WebhookWorker({ prisma, sender, now: () => at });
  expect(await worker.runOnce()).toEqual({ sent: 1, retried: 0, failed: 0 });
  expect(sender.calls[0]!.payload.allowed_mentions.users).not.toContain(discordId);
  expect(sender.calls[0]!.payload.content).not.toContain(`<@${discordId}>`);
  expect(sender.calls[0]!.payload).not.toHaveProperty('_weekly');
});

it('can notify a member who joins another configured guild while delivery is queued', async () => {
  const { post } = await party();
  const guild = await makeGuild({ worldIds: [post.worldId], webhookUrl: 'https://discord.com/api/webhooks/2/test' });
  await job.runOnce(at);
  await prisma.webhookDelivery.updateMany({ data: { createdAt: at } });
  const character = await makeCharacter({ guildId: guild.id, worldId: post.worldId });
  await addMember(post.id, character.id);
  const discordId = (await prisma.user.findUniqueOrThrow({ where: { id: character.ownerId } })).discordId;
  const sender = new FakeWebhookSender();
  const worker = new WebhookWorker({ prisma, sender, now: () => at });
  expect((await worker.runOnce()).sent).toBe(2);
  expect(sender.calls.find((call) => call.url.includes('/2/test'))?.payload.allowed_mentions.users).toContain(discordId);
});

it('uses a configured guild when another character of the same user has no webhook', async () => {
  const { guild, post } = await party();
  const noWebhook = await makeGuild();
  const first = await makeCharacter({ guildId: noWebhook.id });
  await addMember(post.id, first.id);
  const second = await makeCharacter({ guildId: guild.id, ownerId: first.ownerId });
  await addMember(post.id, second.id);
  const discordId = (await prisma.user.findUniqueOrThrow({ where: { id: first.ownerId } })).discordId;
  await job.runOnce(at);
  const deliveries = await prisma.webhookDelivery.findMany();
  expect(deliveries).toHaveLength(1);
  expect((deliveries[0]!.payload as { allowed_mentions: { users: string[] } }).allowed_mentions.users).toContain(discordId);
});

it('continues routing a member after their character is deleted', async () => {
  const { guild, post } = await party();
  const member = await makeCharacter({ guildId: guild.id });
  const membership = await addMember(post.id, member.id);
  const discordId = (await prisma.user.findUniqueOrThrow({ where: { id: member.ownerId } })).discordId;
  const { deleteCharacter } = await import('../src/characters/service.js');
  await deleteCharacter(prisma, member.id);
  expect(await prisma.postMember.findUniqueOrThrow({ where: { id: membership.id } })).toMatchObject({ characterId: null, reminderGuildId: guild.id });
  await job.runOnce(at);
  const delivery = await prisma.webhookDelivery.findFirstOrThrow();
  expect((delivery.payload as { allowed_mentions: { users: string[] } }).allowed_mentions.users).toContain(discordId);
});
