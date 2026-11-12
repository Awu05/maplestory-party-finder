import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { DAY_MS, type WebhookHealthDTO } from '@pf/shared';
import { requireAdmin } from '../auth/guards.js';
import { AppError } from '../http/errors.js';
import { buildTestMessage } from '../discord/messages.js';

const RECENT_FAILURES = 10;

export async function adminWebhookRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, webhookSender } = app.deps;

  app.post<{ Params: { id: string } }>('/admin/guilds/:id/test-webhook', async (req) => {
    await requireAdmin(req);
    const guild = await prisma.guild.findUnique({ where: { id: req.params.id } });
    if (!guild) throw new AppError(404, 'NOT_FOUND');
    if (!guild.webhookUrl) throw new AppError(400, 'NO_WEBHOOK');

    const payload = buildTestMessage(guild.name);
    const result = await webhookSender.send(guild.webhookUrl, payload);
    await prisma.webhookDelivery.create({
      data: {
        guildId: guild.id,
        eventType: 'test',
        payload: payload as object,
        attempts: 1,
        ...(result.ok
          ? { status: 'sent' as const, sentAt: new Date() }
          : { status: 'failed' as const, lastError: result.error }),
      },
    });
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  });

  app.delete<{ Params: { id: string } }>('/admin/webhooks/deliveries/:id', async (req, reply) => {
    await requireAdmin(req);
    const { count } = await prisma.webhookDelivery.deleteMany({ where: { id: req.params.id } });
    if (count === 0) throw new AppError(404, 'NOT_FOUND');
    return reply.status(204).send();
  });

  app.delete('/admin/webhooks/deliveries', async (req, reply) => {
    await requireAdmin(req);
    // Only failed records can be cleared in bulk.
    z.object({ status: z.literal('failed') }).parse(req.query);
    await prisma.webhookDelivery.deleteMany({ where: { status: 'failed' } });
    return reply.status(204).send();
  });

  app.get('/admin/webhooks/health', async (req): Promise<WebhookHealthDTO[]> => {
    await requireAdmin(req);
    const since = new Date(Date.now() - DAY_MS);
    const guilds = await prisma.guild.findMany({
      select: { id: true, name: true, active: true, webhookUrl: true },
      orderBy: { name: 'asc' },
    });
    const [pending, failed, sent] = await Promise.all([
      prisma.webhookDelivery.groupBy({ by: ['guildId'], where: { status: 'pending' }, _count: { _all: true } }),
      prisma.webhookDelivery.groupBy({
        by: ['guildId'],
        where: { status: 'failed', createdAt: { gte: since } },
        _count: { _all: true },
      }),
      prisma.webhookDelivery.groupBy({ by: ['guildId'], where: { status: 'sent' }, _max: { sentAt: true } }),
    ]);
    const pendingBy = new Map(pending.map((r) => [r.guildId, r._count._all]));
    const failedBy = new Map(failed.map((r) => [r.guildId, r._count._all]));
    const sentBy = new Map(sent.map((r) => [r.guildId, r._max.sentAt]));

    return Promise.all(
      guilds.map(async (g) => {
        const failures = await prisma.webhookDelivery.findMany({
          where: { guildId: g.id, status: 'failed' },
          orderBy: { createdAt: 'desc' },
          take: RECENT_FAILURES,
        });
        return {
          guildId: g.id,
          guildName: g.name,
          hasWebhook: g.webhookUrl !== null,
          active: g.active,
          lastSentAt: sentBy.get(g.id)?.toISOString() ?? null,
          pending: pendingBy.get(g.id) ?? 0,
          failedLast24h: failedBy.get(g.id) ?? 0,
          recentFailures: failures.map((f) => ({
            id: f.id,
            eventType: f.eventType,
            attempts: f.attempts,
            lastError: f.lastError,
            createdAt: f.createdAt.toISOString(),
          })),
        };
      }),
    );
  });
}
