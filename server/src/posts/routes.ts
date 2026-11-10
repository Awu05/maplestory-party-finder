import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { isValidTimeZone, MAX_POST_BOSSES } from '@pf/shared';
import { getViewer, requireAdmin, requireUser } from '../auth/guards.js';
import { adminDeletePost, closePost, createPost, deletePost, editPost, finalizePostTime, getVisiblePost, listBoard, listMyParties, listMyPosts, removeMember, renewPost } from './service.js';
import { toPostDetailDTO, toPostSummaryDTO } from './serialize.js';

// Field schemas are exported so the edit route can reuse them.
export const postTypeSchema = z.enum(['lfp', 'recruiting']);
export const bossDifficultyIdsSchema = z
  .array(z.number().int())
  .min(1)
  .max(MAX_POST_BOSSES)
  .refine((ids) => new Set(ids).size === ids.length, 'Duplicate bossDifficultyIds');
export const scheduledAtSchema = z.string().datetime().transform((s) => new Date(s)).nullable();
export const noteSchema = z.string().max(300);
export const partySizeSchema = z.number().int();
export const minCpSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
/** Local hour-of-week slots (day * 24 + hour, 0 = Sunday, 0-167) in the poster's zone; the service dedupes and sorts. */
export const freeTimesSchema = z.array(z.number().int().min(0).max(167)).max(168);
export const freeTimesZoneSchema = z.string().nullable();

/**
 * A sent zone must be a real IANA zone, and non-empty freeTimes needs one. An edit that omits the
 * zone keeps the stored one (`zoneMayBeStored`); the service then checks the resulting post.
 */
const checkFreeTimes = (zoneMayBeStored: boolean) => (b: { freeTimes?: number[]; freeTimesZone?: string | null }, ctx: z.RefinementCtx) => {
  if (b.freeTimesZone != null && !isValidTimeZone(b.freeTimesZone)) {
    ctx.addIssue({ code: 'custom', path: ['freeTimesZone'], message: 'Unknown time zone' });
  }
  const missingZone = b.freeTimesZone === null || (b.freeTimesZone === undefined && !zoneMayBeStored);
  if (b.freeTimes && b.freeTimes.length > 0 && missingZone) {
    ctx.addIssue({ code: 'custom', path: ['freeTimesZone'], message: 'freeTimesZone is required with freeTimes' });
  }
};

// No scheduledAt: the final time is set separately, and zod strips it as an unknown key.
const postFields = z.object({
  type: postTypeSchema,
  characterId: z.string().min(1),
  bossDifficultyIds: bossDifficultyIdsSchema,
  freeTimes: freeTimesSchema.default([]),
  freeTimesZone: freeTimesZoneSchema.optional(),
  partySize: partySizeSchema.optional(),
  minCp: minCpSchema.optional(),
  note: noteSchema,
});

export const createPostBody = postFields.superRefine(checkFreeTimes(false));

// Every create field optional; minCp may be null to clear it. At least one field is required.
export const editPostBody = postFields
  .partial()
  .extend({ freeTimes: freeTimesSchema.optional(), minCp: minCpSchema.nullable().optional() })
  .refine((b) => Object.values(b).some((v) => v !== undefined), 'Provide at least one field to change')
  .superRefine(checkFreeTimes(true));

const boardQuery = z.object({
  type: postTypeSchema.optional(),
  bossId: z.coerce.number().int().optional(),
  bossDifficultyId: z.coerce.number().int().optional(),
  guildId: z.string().min(1).optional(),
  worldIds: z
    .string()
    .regex(/^\d+(,\d+)*$/, 'worldIds must be comma-separated integers')
    .transform((s) => s.split(',').map(Number))
    .optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  flexible: z.enum(['1']).optional(),
  freeAt: z.coerce.date().optional(),
}).refine((q) => !(q.flexible && (q.from || q.to)), 'flexible cannot be combined with from/to');

export async function postRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, storage, events } = app.deps;

  const emitDeclined = (ids: string[], actorUserId: string | null) =>
    ids.forEach((requestId) => events.emit({ type: 'request.declined', requestId, auto: true, actorUserId }));

  app.post('/posts', async (req, reply) => {
    const viewer = await requireUser(req);
    const input = createPostBody.parse(req.body);
    const row = await createPost(prisma, viewer.user.id, input);
    events.emit({ type: 'post.created', postId: row.id });
    return reply.status(201).send(toPostDetailDTO(row, viewer, storage, new Date()));
  });

  app.patch('/posts/:id', async (req) => {
    const viewer = await requireUser(req);
    const { id } = req.params as { id: string };
    const input = editPostBody.parse(req.body);
    const now = new Date();
    const r = await editPost(prisma, viewer, id, input, now);
    emitDeclined(r.declinedRequestIds, viewer.user.id);
    events.emit({ type: 'post.updated', postId: id });
    if (r.reopened) events.emit({ type: 'post.reopened', postId: id });
    if (r.becameFull) events.emit({ type: 'post.closed', postId: id, reason: 'full' });
    return toPostDetailDTO(r.post, viewer, storage, now);
  });

  app.get('/posts', async (req) => {
    const query = boardQuery.parse(req.query);
    const viewer = await getViewer(req);
    const now = new Date();
    const rows = await listBoard(prisma, { ...query, flexible: query.flexible === '1' }, now);
    return rows.map((r) => toPostSummaryDTO(r, viewer?.user.id ?? null, storage, now));
  });

  app.get('/posts/:id', async (req) => {
    const { id } = req.params as { id: string };
    const viewer = await getViewer(req);
    const now = new Date();
    return toPostDetailDTO(await getVisiblePost(prisma, id, viewer, now), viewer, storage, now);
  });

  app.post('/posts/:id/close', async (req) => {
    const viewer = await requireUser(req);
    const { id } = req.params as { id: string };
    const { post, declinedRequestIds } = await closePost(prisma, viewer, id);
    emitDeclined(declinedRequestIds, viewer.user.id);
    events.emit({ type: 'post.closed', postId: id, reason: 'manual' });
    return toPostDetailDTO(post, viewer, storage, new Date());
  });

  app.delete('/posts/:id', async (req, reply) => {
    const viewer = await requireUser(req);
    const { id } = req.params as { id: string };
    const { hardDeleted, declinedRequestIds } = await deletePost(prisma, viewer, id);
    emitDeclined(declinedRequestIds, viewer.user.id);
    if (!hardDeleted) events.emit({ type: 'post.closed', postId: id, reason: 'deleted' });
    return reply.status(204).send();
  });

  app.post('/posts/:id/renew', async (req) => {
    const viewer = await requireUser(req);
    const { id } = req.params as { id: string };
    const now = new Date();
    const row = await renewPost(prisma, viewer, id, now);
    events.emit({ type: 'post.updated', postId: id });
    return toPostDetailDTO(row, viewer, storage, now);
  });

  app.put('/posts/:id/final-time', async (req) => {
    const viewer = await requireUser(req);
    const { id } = req.params as { id: string };
    const { scheduledAt } = z.object({ scheduledAt: z.string().datetime().transform((s) => new Date(s)) }).parse(req.body);
    const now = new Date();
    const row = await finalizePostTime(prisma, viewer, id, scheduledAt, now);
    events.emit({ type: 'post.finalized', postId: id, actorUserId: viewer.user.id });
    return toPostDetailDTO(row, viewer, storage, now);
  });

  app.delete('/posts/:id/members/:memberId', async (req) => {
    const viewer = await requireUser(req);
    const { id, memberId } = req.params as { id: string; memberId: string };
    const now = new Date();
    const r = await removeMember(prisma, viewer, id, memberId, now);
    events.emit({ type: 'member.left', postId: id, memberId, userId: r.member.userId, ign: r.member.ign, removedBy: r.removedBy });
    if (r.reopened) events.emit({ type: 'post.reopened', postId: id });
    if (r.reopenedLfpPostId) events.emit({ type: 'post.reopened', postId: r.reopenedLfpPostId });
    return toPostDetailDTO(r.post, viewer, storage, now);
  });

  app.get('/me/parties', async (req) => {
    const viewer = await requireUser(req);
    const now = new Date();
    return (await listMyParties(prisma, viewer.user.id)).map((r) => toPostDetailDTO(r, viewer, storage, now));
  });

  app.get('/me/posts', async (req) => {
    const viewer = await requireUser(req);
    const now = new Date();
    return (await listMyPosts(prisma, viewer.user.id)).map((r) => toPostSummaryDTO(r, viewer.user.id, storage, now));
  });

  app.delete('/admin/posts/:id', async (req, reply) => {
    const admin = await requireAdmin(req);
    const { id } = req.params as { id: string };
    emitDeclined(await adminDeletePost(prisma, id), admin.user.id);
    return reply.status(204).send();
  });
}
