import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { NotificationListDTO } from '@pf/shared';
import { requireUser } from '../auth/guards.js';

const listQuery = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) });

const readBody = z.union([
  z.object({ ids: z.array(z.string().min(1)).min(1).max(100) }).strict(),
  z.object({ all: z.literal(true) }).strict(),
]);

export async function notificationRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = app.deps;

  app.get('/notifications', async (req): Promise<NotificationListDTO> => {
    const viewer = await requireUser(req);
    const { limit } = listQuery.parse(req.query);
    const userId = viewer.user.id;
    const [rows, unreadCount] = await Promise.all([
      prisma.notification.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit }),
      prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return {
      items: rows.map((n) => ({
        id: n.id, kind: n.kind, text: n.text, link: n.link, createdAt: n.createdAt.toISOString(), read: n.readAt !== null,
      })),
      unreadCount,
    };
  });

  app.post('/notifications/read', async (req, reply) => {
    const viewer = await requireUser(req);
    const body = readBody.parse(req.body ?? {});
    await prisma.notification.updateMany({
      where: { userId: viewer.user.id, readAt: null, ...('ids' in body ? { id: { in: body.ids } } : {}) },
      data: { readAt: new Date() },
    });
    return reply.status(204).send();
  });
}
