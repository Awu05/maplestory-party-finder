import { beforeEach, expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { WeeklyReminderJob } from '../src/jobs/weeklyReminders.js';
import { WebhookWorker } from '../src/discord/outbox.js';
import { weeklyRecipientIds } from '../src/discord/weeklyRecipients.js';
import { addMember, buildTestApp, FakeWebhookSender, makeCharacter, makeGuild, makePost, prisma, resetDb } from './helpers.js';

const at = new Date('2027-03-08T00:30:00Z'); // Sunday 19:30 in New York, before DST.
let job: WeeklyReminderJob;
beforeEach(async () => {
  await resetDb();
  const { storage, app } = await buildTestApp();
  job = new WeeklyReminderJob({ prisma, storage, webOrigin: 'https://pf.example' });
  await app.close();
});

it.each(['rescheduled', 'disabled', 'closed'] as const)('preserves a party %s after a reminder transaction fails', async (change) => {
  const { storage, app } = await buildTestApp();
  await app.close();
  const post = await makePost({ scheduledAt: at, weeklyAnchorAt: at, weeklyTimeZone: 'Not/AZone' });
  const future = new Date(at.getTime() + 86_400_000);
  let changed = false;
  const concurrent = new Proxy(prisma, { get(target, key) {
    if (key !== '$transaction') return Reflect.get(target, key);
    return async (callback: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      try { return await target.$transaction(callback); }
      catch (error) {
        if (!changed) {
          changed = true;
          await target.post.update({ where: { id: post.id }, data: change === 'rescheduled'
            ? { scheduledAt: future, weeklyAnchorAt: future, weeklyTimeZone: 'UTC' }
            : change === 'disabled' ? { weeklyAnchorAt: null, weeklyTimeZone: null }
            : { status: 'closed', closedReason: 'manual' } });
        }
        throw error;
      }
    };
  } });
  const recovering = new WeeklyReminderJob({ prisma: concurrent, storage, webOrigin: 'https://pf.example' });
  expect(await recovering.runOnce(at)).toBe(0);
  expect(changed).toBe(true);
  const saved = await prisma.post.findUniqueOrThrow({ where: { id: post.id } });
  expect(saved.scheduledAt).toEqual(change === 'rescheduled' ? future : at);
});

async function party(over: Parameters<typeof makePost>[0] = {}) {
  const guild = await makeGuild({ webhookUrl: 'https://discord.com/api/webhooks/1/test' });
  const character = await makeCharacter({ guildId: guild.id });
  await prisma.guildWorld.create({ data: { guildId: guild.id, worldId: character.worldId } });
  const post = await makePost({ posterCharacterId: character.id, scheduledAt: at, weeklyAnchorAt: at, weeklyTimeZone: 'America/New_York', ...over });
  return { guild, character, post };
}

it('routes guildless party members to a configured world channel', async () => {
  const { guild, character, post } = await party();
  await prisma.character.update({ where: { id: character.id }, data: { guildId: null } });
  await prisma.post.update({ where: { id: post.id }, data: { guildId: null } });
  expect(await job.runOnce(at)).toBe(1);
  const delivery = await prisma.webhookDelivery.findFirstOrThrow({ where: { postId: post.id } });
  expect(delivery.guildId).toBe(guild.id);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: character.ownerId } });
  expect(delivery.payload).toMatchObject({ allowed_mentions: { users: [user.discordId] } });
});

it('never treats an unlinked account contact username as a reminder recipient ID', async () => {
  const { guild, character, post } = await party();
  const member = await makeCharacter({ guildId: guild.id });
  await prisma.user.update({ where: { id: member.ownerId }, data: { discordId: null, username: '123456789012345678' } });
  await addMember(post.id, member.id);
  expect(await job.runOnce(at)).toBe(1);
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: character.ownerId } });
  const delivery = await prisma.webhookDelivery.findFirstOrThrow({ where: { postId: post.id } });
  expect(delivery.payload).toMatchObject({ allowed_mentions: { users: [owner.discordId] } });
  expect(JSON.stringify(delivery.payload)).not.toContain('123456789012345678');
});

it('includes typed IDs, deduplicates recipients and skips unavailable members', async () => {
  const { post, character } = await party();
  const id = '123456789012345678';
  await prisma.user.update({ where: { id: character.ownerId }, data: { discordId: null, typedDiscordId: id } });
  const second = await makeCharacter({ ownerId: character.ownerId, worldId: post.worldId });
  await addMember(post.id, second.id);
  const banned = await makeCharacter({ worldId: post.worldId });
  await prisma.user.update({ where: { id: banned.ownerId }, data: { banned: true, typedDiscordId: '223456789012345678', discordId: null } });
  await addMember(post.id, banned.id);
  expect(await weeklyRecipientIds(prisma, post.id)).toEqual([id]);
});

it('advances and queues weekly reminders for finalized carrying parties', async () => {
  const { post } = await party({ type: 'carrying', status: 'closed', closedReason: 'finalized' });
  expect(await job.runOnce(at)).toBe(1);
  expect(await prisma.webhookDelivery.count({ where: { postId: post.id, eventType: 'post.weekly_reminder' } })).toBe(1);
  expect((await prisma.post.findUniqueOrThrow({ where: { id: post.id } })).scheduledAt).toEqual(new Date('2027-03-14T23:30:00.000Z'));
});

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

it('excludes removed and banned members while including members from other guilds', async () => {
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
  expect((deliveries[0]!.payload as { allowed_mentions: { users: string[] } }).allowed_mentions.users).toHaveLength(2);
});

it('excludes deleted members, and sends nothing for a deleted poster\'s party', async () => {
  const { guild, post } = await party();
  const gone = await makeCharacter({ guildId: guild.id });
  await addMember(post.id, gone.id);
  await prisma.user.update({ where: { id: gone.ownerId }, data: { deletedAt: new Date() } });
  await job.runOnce(at);
  const deliveries = await prisma.webhookDelivery.findMany();
  expect(deliveries).toHaveLength(1);
  const mentioned = (deliveries[0]!.payload as { allowed_mentions: { users: string[] } }).allowed_mentions.users;
  const goneOwner = await prisma.user.findUniqueOrThrow({ where: { id: gone.ownerId } });
  expect(goneOwner.discordId).toEqual(expect.any(String));
  expect(mentioned).toHaveLength(1); // only the poster
  expect(mentioned).not.toContain(goneOwner.discordId);

  await resetDb();
  const second = await party();
  await prisma.user.update({ where: { id: second.post.posterUserId }, data: { deletedAt: new Date() } });
  await job.runOnce(at);
  expect(await prisma.webhookDelivery.count()).toBe(0);
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

it('queues reminders only for guilds that have recipients', async () => {
  const { guild, post } = await party();
  await makeGuild({ worldIds: [post.worldId], webhookUrl: 'https://discord.com/api/webhooks/2/test' });
  await job.runOnce(at);
  const deliveries = await prisma.webhookDelivery.findMany();
  expect(deliveries.map((d) => d.guildId)).toEqual([guild.id]);
});

it('sends one reminder to the selected guild and removes departed members from its mentions', async () => {
  const { guild, post } = await party();
  const member = await makeCharacter({ guildId: guild.id });
  await addMember(post.id, member.id);
  const otherGuild = await makeGuild({ webhookUrl: 'https://discord.com/api/webhooks/2/test' });
  const leaver = await addMember(post.id, (await makeCharacter({ guildId: otherGuild.id })).id);
  await job.runOnce(at);
  expect(await prisma.webhookDelivery.count()).toBe(1);
  await prisma.webhookDelivery.updateMany({ data: { createdAt: at } });
  await prisma.postMember.delete({ where: { id: leaver.id } });
  const sender = new FakeWebhookSender();
  expect(await new WebhookWorker({ prisma, sender, now: () => at }).runOnce()).toEqual({ sent: 1, retried: 0, failed: 0 });
  expect(sender.calls.map((c) => c.url)).toEqual(['https://discord.com/api/webhooks/1/test']);
  expect(await prisma.webhookDelivery.count({ where: { status: 'failed' } })).toBe(0);
  expect(await prisma.webhookDelivery.count({ where: { guildId: otherGuild.id } })).toBe(0);
});

it('builds the sent message from the reminder metadata and the members at send time', async () => {
  const { guild, character, post } = await party();
  await job.runOnce(at);
  await prisma.webhookDelivery.updateMany({ data: { createdAt: at } });
  const delivery = await prisma.webhookDelivery.findFirstOrThrow();
  // The stored text is not edited at send time; only the metadata is used.
  await prisma.webhookDelivery.update({ where: { id: delivery.id }, data: { payload: { ...(delivery.payload as object), content: 'stale text' } } });
  const joined = await makeCharacter({ guildId: guild.id });
  await addMember(post.id, joined.id);
  const [owner, member] = await Promise.all([character.ownerId, joined.ownerId].map((id) => prisma.user.findUniqueOrThrow({ where: { id } })));
  const sender = new FakeWebhookSender();
  expect((await new WebhookWorker({ prisma, sender, now: () => at }).runOnce()).sent).toBe(1);
  const content = sender.calls[0]!.payload.content!;
  expect(content).toBe(`<@${owner!.discordId}> <@${member!.discordId}> Weekly party reminder: ${content.split('Weekly party reminder: ')[1]}`);
  expect(content).toContain(`<t:${Math.floor(at.getTime() / 1000)}:F>`);
  expect(content).toContain(`https://pf.example/posts/${post.id}`);
  expect(content).not.toContain('stale text');
  expect(sender.calls[0]!.payload.allowed_mentions).toEqual({ parse: [], users: [owner!.discordId, member!.discordId] });
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
  expect(await prisma.postMember.findUniqueOrThrow({ where: { id: membership.id } })).toMatchObject({ characterId: null });
  await job.runOnce(at);
  const delivery = await prisma.webhookDelivery.findFirstOrThrow();
  expect((delivery.payload as { allowed_mentions: { users: string[] } }).allowed_mentions.users).toContain(discordId);
});

it('skips a post that fails a week ahead, logs it, and still reminds the other parties', async () => {
  const logged: { obj: object; msg: string }[] = [];
  const { storage, app } = await buildTestApp();
  await app.close();
  const logging = new WeeklyReminderJob({ prisma, storage, webOrigin: 'https://pf.example', log: { error: (obj, msg) => logged.push({ obj, msg }) } });
  // Older, so it is claimed first; an unknown zone makes the next-occurrence query throw.
  const poisoned = (await party({ scheduledAt: new Date(at.getTime() - 60_000) })).post;
  await prisma.$executeRaw`UPDATE "Post" SET "weeklyTimeZone" = 'Not/AZone' WHERE id = ${poisoned.id}`;
  const good = (await party()).post;
  expect(await logging.runOnce(at)).toBe(1);
  expect(await prisma.webhookDelivery.count({ where: { postId: good.id } })).toBe(1);
  expect(await prisma.webhookDelivery.count({ where: { postId: poisoned.id } })).toBe(0);
  const skipped = await prisma.post.findUniqueOrThrow({ where: { id: poisoned.id } });
  expect(skipped.scheduledAt!.getTime()).toBe(at.getTime() - 60_000 + 7 * 86_400_000);
  expect(skipped.expiresAt.getTime()).toBe(skipped.scheduledAt!.getTime() + 3 * 3600_000);
  expect(logged).toEqual([{ obj: { postId: poisoned.id, errName: expect.any(String) }, msg: expect.stringContaining('weekly reminder') }]);
  expect(await logging.runOnce(at)).toBe(0);
});
