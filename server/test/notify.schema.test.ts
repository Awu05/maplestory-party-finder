import { beforeEach, describe, expect, it } from 'vitest';
import { makeGuild, makeUser, prisma, resetDb } from './helpers.js';

beforeEach(resetDb);

describe('notifications schema', () => {
  it('deleting a user cascades its notifications', async () => {
    const user = await makeUser();
    const other = await makeUser();
    await prisma.notification.create({ data: { userId: user.id, kind: 'invite', text: 'hi', link: '/posts/a' } });
    await prisma.notification.create({ data: { userId: other.id, kind: 'invite', text: 'hi', link: '/posts/b' } });
    await prisma.user.delete({ where: { id: user.id } });
    const left = await prisma.notification.findMany();
    expect(left).toHaveLength(1);
    expect(left[0]!.userId).toBe(other.id);
  });

  it('deleting a guild cascades its webhook deliveries; defaults apply', async () => {
    const guild = await makeGuild();
    const d = await prisma.webhookDelivery.create({ data: { guildId: guild.id, eventType: 'test', payload: { content: 'x' } } });
    expect(d).toMatchObject({ status: 'pending', attempts: 0, lastError: null, sentAt: null });
    await prisma.guild.delete({ where: { id: guild.id } });
    expect(await prisma.webhookDelivery.count()).toBe(0);
  });

  it('JobRun keyed by name', async () => {
    await prisma.jobRun.create({ data: { name: 'sweep', lastRunAt: new Date() } });
    await expect(prisma.jobRun.create({ data: { name: 'sweep', lastRunAt: new Date() } })).rejects.toMatchObject({ code: 'P2002' });
  });
});
