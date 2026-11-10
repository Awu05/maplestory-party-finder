import { beforeEach, describe, expect, it } from 'vitest';
import { FakeNexon, makeCharacter, makeUser, makeWorld, prisma, resetDb } from './helpers.js';
import { DailySyncJob } from '../src/jobs/dailySync.js';

const T0 = new Date('2026-06-01T00:00:00Z');
const DAY = 86_400_000;
let nexon: FakeNexon;
let clock: Date;
let sleeps: number[];
const job = () =>
  new DailySyncJob({ prisma, nexon, now: () => clock, sleep: async (ms) => void sleeps.push(ms) });

const nx = (ign: string, level: number) => ({ ign, level, jobName: 'Hero', imageUrl: 'https://x/y.png', nexonWorldId: 45 });

beforeEach(async () => {
  await resetDb();
  nexon = new FakeNexon();
  clock = T0;
  sleeps = [];
});

describe('DailySyncJob', () => {
  it('syncs non-banned characters oldest first, throttles between, records JobRun', async () => {
    await makeWorld();
    const a = await makeCharacter({ ign: 'Aaa', lastSyncedAt: new Date('2026-05-03T00:00:00Z') });
    const b = await makeCharacter({ ign: 'Bbb', lastSyncedAt: new Date('2026-05-01T00:00:00Z') });
    const c = await makeCharacter({ ign: 'Ccc', lastSyncedAt: new Date('2026-05-02T00:00:00Z') });
    nexon.set([nx('Aaa', 280), nx('Bbb', 281), nx('Ccc', 282)]);

    expect(await job().runIfDue()).toEqual({ synced: 3, stale: 0 });
    expect(nexon.calls).toEqual([
      { ign: 'Bbb', fresh: true },
      { ign: 'Ccc', fresh: true },
      { ign: 'Aaa', fresh: true },
    ]);
    expect(sleeps).toEqual([2000, 2000]);
    expect((await prisma.character.findUniqueOrThrow({ where: { id: a.id } })).level).toBe(280);
    expect((await prisma.character.findUniqueOrThrow({ where: { id: b.id } })).level).toBe(281);
    expect((await prisma.character.findUniqueOrThrow({ where: { id: c.id } })).level).toBe(282);
    const run = await prisma.jobRun.findUniqueOrThrow({ where: { name: 'daily-sync' } });
    expect(run.lastRunAt).toEqual(T0);
    expect(run.lastResult).toEqual({ synced: 3, stale: 0 });
  });

  it("skips within 24h, runs after 24h", async () => {
    await makeWorld();
    await makeCharacter({ ign: 'Aaa' });
    nexon.set([nx('Aaa', 280)]);
    expect(await job().runIfDue()).toEqual({ synced: 1, stale: 0 });
    clock = new Date(T0.getTime() + DAY - 1000);
    expect(await job().runIfDue()).toBe('skipped');
    expect(nexon.calls).toHaveLength(1);
    clock = new Date(T0.getTime() + DAY + 1000);
    expect(await job().runIfDue()).toEqual({ synced: 1, stale: 0 });
    expect(nexon.calls).toHaveLength(2);
  });

  it("does not sync a banned user's character", async () => {
    await makeWorld();
    const banned = await makeUser({ banned: true });
    await makeCharacter({ ign: 'Banned', ownerId: banned.id });
    await makeCharacter({ ign: 'Fine' });
    nexon.set([nx('Banned', 1), nx('Fine', 2)]);
    expect(await job().runIfDue()).toEqual({ synced: 1, stale: 0 });
    expect(nexon.calls.map((c) => c.ign)).toEqual(['Fine']);
  });

  it('one Nexon failure marks that character stale; others ok; run completes', async () => {
    await makeWorld();
    const a = await makeCharacter({ ign: 'Aaa', lastSyncedAt: new Date('2026-05-01T00:00:00Z') });
    const b = await makeCharacter({ ign: 'Bbb', lastSyncedAt: new Date('2026-05-02T00:00:00Z') });
    nexon.set([nx('Aaa', 280), nx('Bbb', 281)]);
    nexon.failNext();
    expect(await job().runIfDue()).toEqual({ synced: 1, stale: 1 });
    expect((await prisma.character.findUniqueOrThrow({ where: { id: a.id } })).syncStatus).toBe('stale');
    expect((await prisma.character.findUniqueOrThrow({ where: { id: b.id } })).syncStatus).toBe('ok');
    expect(await prisma.jobRun.findUniqueOrThrow({ where: { name: 'daily-sync' } })).toMatchObject({ lastResult: { synced: 1, stale: 1 } });
  });

  it('prunes 61-day-old notifications, keeps 59-day-old; prunes only old sent and failed deliveries', async () => {
    const user = await makeUser();
    const mk = (days: number) =>
      prisma.notification.create({ data: { userId: user.id, kind: 'invite', text: 't', link: '/x', createdAt: new Date(T0.getTime() - days * DAY) } });
    const old = await mk(61);
    const recent = await mk(59);
    const guild = await prisma.guild.create({ data: { name: 'G' } });
    const dl = (status: 'sent' | 'pending' | 'failed', days: number) =>
      prisma.webhookDelivery.create({ data: { guildId: guild.id, eventType: 'test', payload: {}, status, createdAt: new Date(T0.getTime() - days * DAY) } });
    const oldSent = await dl('sent', 31);
    const recentSent = await dl('sent', 29);
    const oldPending = await dl('pending', 31);
    const oldFailed = await dl('failed', 31);
    const recentFailed = await dl('failed', 29);

    await job().runIfDue();
    const nIds = (await prisma.notification.findMany()).map((n) => n.id);
    expect(nIds).toContain(recent.id);
    expect(nIds).not.toContain(old.id);
    const dIds = (await prisma.webhookDelivery.findMany()).map((d) => d.id);
    expect(dIds).not.toContain(oldSent.id);
    expect(dIds).toContain(recentSent.id);
    expect(dIds).toContain(oldPending.id);
    expect(dIds).not.toContain(oldFailed.id);
    expect(dIds).toContain(recentFailed.id);
  });
});

describe('DailySyncJob.stop()', () => {
  it('stops an in-flight run after at most one more character and records a partial result', async () => {
    await makeWorld();
    for (const [i, ign] of ['Aaa', 'Bbb', 'Ccc', 'Ddd'].entries()) {
      await makeCharacter({ ign, lastSyncedAt: new Date(Date.UTC(2026, 4, 1 + i)) });
    }
    nexon.set([nx('Aaa', 1), nx('Bbb', 2), nx('Ccc', 3), nx('Ddd', 4)]);
    let release!: () => void;
    let entered!: () => void;
    const inSleep = new Promise<void>((r) => (entered = r));
    const gate = new Promise<void>((r) => (release = r));
    let sleepCalls = 0;
    const j = new DailySyncJob({
      prisma, nexon, now: () => clock,
      sleep: async () => {
        sleepCalls++;
        entered();
        await gate;
      },
    });
    j.start(10 * DAY);
    await inSleep; // first character synced, blocked in the throttle sleep
    const stopped = j.stop();
    release();
    await stopped;
    expect(nexon.calls.length).toBeLessThanOrEqual(2);
    expect(sleepCalls).toBe(1);
    const run = await prisma.jobRun.findUniqueOrThrow({ where: { name: 'daily-sync' } });
    expect(run.lastResult).toMatchObject({ synced: nexon.calls.length, stale: 0 });
  });
});
