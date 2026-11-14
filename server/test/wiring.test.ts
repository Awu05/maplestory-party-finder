import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { WebhookWorker } from '../src/discord/outbox.js';
import { RunReminderJob } from '../src/jobs/runReminders.js';
import { buildTestApp, loginAs, makeBossDifficulty, makeCharacter, makeGuild, makeWorld, prisma, resetDb } from './helpers.js';

const HOOK = 'https://discord.test/api/webhooks/1/secret';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('notifications wiring (dispatcher + worker, end to end)', () => {
  beforeEach(resetDb);

  it('finalizes a party, captures its thread, and delivers its run reminder and bell notification', async () => {
    const { app, events, webhookSender } = await buildTestApp({ events: 'dispatcher' });
    try {
      const cookie = await loginAs(app, '123456789012345678', 'host');
      const owner = await prisma.user.findUniqueOrThrow({ where: { discordId: '123456789012345678' } });
      const world = await makeWorld();
      const guild = await makeGuild({ worldIds: [world.id], partyForumWebhookUrl: HOOK });
      const boss = await makeBossDifficulty();
      const character = await makeCharacter({ ownerId: owner.id, worldId: world.id, guildId: guild.id });
      const created = await app.inject({ method: 'POST', url: '/api/posts', headers: { cookie }, payload: {
        type: 'recruiting', characterId: character.id, bossDifficultyIds: [boss.id], partySize: 4,
        title: 'Crew', note: '', reminderOffsets: [15], partyForumGuildId: guild.id,
      } });
      expect(created.statusCode).toBe(201);
      const postId = created.json().id;
      const runAt = new Date(Date.now() + 15 * 60_000);
      expect((await app.inject({ method: 'PUT', url: `/api/posts/${postId}/final-time`, headers: { cookie }, payload: { scheduledAt: runAt.toISOString() } })).statusCode).toBe(200);
      await events.drain();
      webhookSender.queue({ ok: true, channelId: 'party-thread' });
      const worker = new WebhookWorker({ prisma, sender: webhookSender });
      expect((await worker.runOnce()).sent).toBe(1);
      await new RunReminderJob({ prisma, webOrigin: 'http://localhost:5173' }).runOnce();
      expect((await worker.runOnce()).sent).toBe(1);
      expect(webhookSender.calls[1]).toMatchObject({ threadId: 'party-thread', payload: { allowed_mentions: { users: ['123456789012345678'] } } });
      expect(await prisma.notification.findFirstOrThrow()).toMatchObject({ userId: owner.id, kind: 'reminder', text: 'Reminder: Crew starts in 15 minutes' });
    } finally { await events.drain(); await app.close(); }
  });

  it("a post's own title is the Discord notification's title", async () => {
    const { app, events, webhookSender } = await buildTestApp({ events: 'dispatcher' });
    const worker = new WebhookWorker({ prisma, sender: webhookSender });
    const u1 = await loginAs(app, 'u-1', 'one');
    const u1Id = (await prisma.user.findUniqueOrThrow({ where: { discordId: 'u-1' } })).id;
    const kronos = await makeWorld({ nexonWorldId: 45, name: 'Kronos' });
    const g1 = await makeGuild({ name: 'G1', worldIds: [kronos.id], webhookUrl: HOOK });
    const lucid = (await makeBossDifficulty({ bossName: 'Lucid', difficulty: 'Hard', partyCap: 6 })).id;
    const alice = await makeCharacter({ ownerId: u1Id, worldId: kronos.id, guildId: g1.id, ign: 'Alice' });
    const created = await app.inject({
      method: 'POST', url: '/api/posts', headers: { cookie: u1 },
      payload: { type: 'recruiting', characterId: alice.id, bossDifficultyIds: [lucid], partySize: 4, title: 'Chill Lucid clear', note: '', notificationGuildId: g1.id },
    });
    expect(created.statusCode).toBe(201);
    await events.drain();
    await worker.runOnce();
    const embed = webhookSender.calls[0]!.payload.embeds![0] as { title: string; fields: { name: string; value: string }[] };
    expect(embed.title).toBe('Chill Lucid clear');
    expect(embed.fields[0]).toMatchObject({ name: 'Bosses', value: 'Hard Lucid' });
  });

  it('post -> embed; join request -> notification + ping; accept -> notification + accept ping', async () => {
    const { app, events, webhookSender } = await buildTestApp({ events: 'dispatcher' });
    const worker = new WebhookWorker({ prisma, sender: webhookSender });
    const u1 = await loginAs(app, 'u-1', 'one');
    const u2 = await loginAs(app, 'u-2', 'two');
    const id = async (d: string) => (await prisma.user.findUniqueOrThrow({ where: { discordId: d } })).id;
    const [u1Id, u2Id] = [await id('u-1'), await id('u-2')];
    const kronos = await makeWorld({ nexonWorldId: 45, name: 'Kronos' });
    const g1 = await makeGuild({ name: 'G1', worldIds: [kronos.id], webhookUrl: HOOK });
    const g5 = await makeGuild({ name: 'G5', webhookUrl: HOOK });
    const lucid = (await makeBossDifficulty({ bossName: 'Lucid', difficulty: 'Hard', partyCap: 6 })).id;
    const alice = await makeCharacter({ ownerId: u1Id, worldId: kronos.id, guildId: g1.id, ign: 'Alice' });
    const bob = await makeCharacter({ ownerId: u2Id, worldId: kronos.id, guildId: g5.id, ign: 'Bob' });

    // 1. post -> one delivery enqueued
    const created = await app.inject({
      method: 'POST', url: '/api/posts', headers: { cookie: u1 },
      payload: { type: 'recruiting', characterId: alice.id, bossDifficultyIds: [lucid], partySize: 4, note: '', notificationGuildId: g1.id },
    });
    expect(created.statusCode).toBe(201);
    await events.drain();
    expect(await prisma.webhookDelivery.count({ where: { status: 'pending' } })).toBe(1);

    // 2. worker sends the embed
    await worker.runOnce();
    expect(webhookSender.calls).toHaveLength(1);
    expect(webhookSender.calls[0]!.url).toBe(HOOK);
    expect((webhookSender.calls[0]!.payload.embeds![0] as { title: string }).title).toBe('Recruiting: Hard Lucid');

    // 3. join request -> poster notified, ping sent
    const req = await app.inject({
      method: 'POST', url: `/api/posts/${created.json().id}/requests`, headers: { cookie: u2 }, payload: { characterId: bob.id },
    });
    expect(req.statusCode).toBe(201);
    await events.drain();
    expect(await prisma.notification.findMany({ where: { userId: u1Id, kind: 'join_request' } })).toHaveLength(1);
    await worker.runOnce();
    expect(webhookSender.calls).toHaveLength(2);
    expect(webhookSender.calls[1]!.payload.content).toContain('<@u-1>');

    // 4. accept -> applicant notified, accept ping sent
    const accepted = await app.inject({ method: 'POST', url: `/api/requests/${req.json().id}/accept`, headers: { cookie: u1 } });
    expect(accepted.statusCode).toBe(200);
    await events.drain();
    expect(await prisma.notification.findMany({ where: { userId: u2Id, kind: 'accepted' } })).toHaveLength(1);
    await worker.runOnce();
    expect(webhookSender.calls).toHaveLength(3);
    expect(webhookSender.calls[2]!.payload.content).toContain('<@u-2>');
    await app.close();
  });
});
