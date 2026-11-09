import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { MAX_POST_BOSSES } from '@pf/shared';
import { getViewer, requireUser } from '../auth/guards.js';
import { createPost, getVisiblePost, listBoard } from './service.js';
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

export const createPostBody = z.object({
  type: postTypeSchema,
  characterId: z.string().min(1),
  bossDifficultyIds: bossDifficultyIdsSchema,
  scheduledAt: scheduledAtSchema,
  partySize: partySizeSchema.optional(),
  minCp: minCpSchema.optional(),
  note: noteSchema,
});

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
}).refine((q) => !(q.flexible && (q.from || q.to)), 'flexible cannot be combined with from/to');

export async function postRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, storage, events } = app.deps;

  app.post('/posts', async (req, reply) => {
    const viewer = await requireUser(req);
    const input = createPostBody.parse(req.body);
    const row = await createPost(prisma, viewer.user.id, input);
    events.emit({ type: 'post.created', postId: row.id });
    return reply.status(201).send(toPostDetailDTO(row, viewer, storage, new Date()));
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
}
