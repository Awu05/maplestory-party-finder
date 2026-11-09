import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/guards.js';
import { AppError } from '../http/errors.js';
import { toPostDetailDTO } from '../posts/serialize.js';
import { acceptRequest, cancelRequest, createInvite, createJoinRequest, declineRequest } from './service.js';
import { toRequestDTO } from './serialize.js';

const createRequestBody = z.object({ characterId: z.string().min(1) });

const createInviteBody = z.object({ recruitingPostId: z.string().min(1) });

export async function requestRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, storage, events } = app.deps;

  app.post('/posts/:id/requests', async (req, reply) => {
    const viewer = await requireUser(req);
    const { id } = req.params as { id: string };
    const { characterId } = createRequestBody.parse(req.body);
    const row = await createJoinRequest(prisma, viewer, id, characterId, new Date());
    events.emit({ type: 'request.created', requestId: row.id });
    return reply.status(201).send(toRequestDTO(row, viewer.user.id, storage));
  });

  app.post('/posts/:id/invites', async (req, reply) => {
    const viewer = await requireUser(req);
    const { id } = req.params as { id: string };
    const { recruitingPostId } = createInviteBody.parse(req.body);
    const row = await createInvite(prisma, viewer, id, recruitingPostId, new Date());
    events.emit({ type: 'request.created', requestId: row.id });
    return reply.status(201).send(toRequestDTO(row, viewer.user.id, storage));
  });

  app.post('/requests/:id/accept', async (req) => {
    const viewer = await requireUser(req);
    const { id } = req.params as { id: string };
    const now = new Date();
    const result = await acceptRequest(prisma, viewer, id, now);
    if (!result.ok) {
      events.emit({ type: 'request.declined', requestId: result.declinedRequestId, auto: true });
      throw new AppError(409, 'ALREADY_MEMBER', 'That character is already in the party');
    }
    events.emit({ type: 'request.accepted', requestId: id });
    if (result.closedLfpPostId) events.emit({ type: 'post.closed', postId: result.closedLfpPostId, reason: 'lfp_matched' });
    result.declinedRequestIds.forEach((requestId) => events.emit({ type: 'request.declined', requestId, auto: true }));
    return toPostDetailDTO(result.post, viewer, storage, now);
  });

  app.post('/requests/:id/decline', async (req) => {
    const viewer = await requireUser(req);
    const { id } = req.params as { id: string };
    const row = await declineRequest(prisma, viewer, id, new Date());
    events.emit({ type: 'request.declined', requestId: id, auto: false });
    return toRequestDTO(row, viewer.user.id, storage);
  });

  app.post('/requests/:id/cancel', async (req) => {
    const viewer = await requireUser(req);
    const { id } = req.params as { id: string };
    const row = await cancelRequest(prisma, viewer, id, new Date());
    events.emit({ type: 'request.cancelled', requestId: id });
    return toRequestDTO(row, viewer.user.id, storage);
  });
}
