import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { WebhookWorker } from '../src/discord/outbox.js';
import { buildTestApp, loginAs, makeBossDifficulty, makeCharacter, makeGuild, makeWorld, prisma, resetDb } from './helpers.js';

const HOUR = 3_600_000;
const HOOK = 'https://discord.test/api/webhooks/1/secret';

afterAll(async () => {
  await prisma.$disconnect();
});

describe('notifications wiring (dispatcher + worker, end to end)', () => {
  beforeEach(resetDb);

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
      payload: { type: 'recruiting', characterId: alice.id, bossDifficultyIds: [lucid], scheduledAt: new Date(Date.now() + 24 * HOUR).toISOString(), partySize: 4, note: '' },
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
