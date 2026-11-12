import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getViewer, requireUser } from '../auth/guards.js';
import { readImageUpload } from '../storage/imageType.js';
import { UploadLimiter } from '../storage/uploadLimiter.js';
import {
  claimRefresh, createCharacter, createManualCharacter, deleteCharacter, getCharacter, getOwnedCharacter, listCharacters, lookupCharacters,
  moveCharacterWorld, refreshCharacter, updateCharacter,
} from './service.js';
import type { RefreshResultDTO } from '@pf/shared';
import { characterInclude, toCharacterDTO } from './serialize.js';

const lookupBody = z.object({ ign: z.string().trim().min(1) });

const createBody = z.object({
  ign: z.string().trim().min(1),
  nexonWorldId: z.number().int(),
  combatPower: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  // Guild membership is optional.
  guildId: z.string().min(1).nullable().optional().transform((v) => v ?? null),
});

const manualBody = z.object({
  ign: z.string().trim().min(1).max(32),
  worldId: z.number().int(),
  jobName: z.string().trim().min(1),
  level: z.number().int().min(1).max(300),
  combatPower: createBody.shape.combatPower,
  guildId: createBody.shape.guildId,
});

const updateBody = createBody
  .pick({ combatPower: true })
  .extend({
    // null clears the guild; omitted leaves it unchanged.
    guildId: z.string().min(1).nullable(),
    jobName: z.string().trim().min(1),
    level: z.number().int().min(1).max(300),
  })
  .partial();

const moveBody = z.object({ worldId: z.number().int(), guildId: z.string().min(1).nullable() });

const listQuery = z.object({
  worldId: z.coerce.number().int().optional(),
  archetype: z.enum(['warrior', 'magician', 'bowman', 'thief', 'pirate', 'xenon', 'unknown']).optional(),
  q: z.string().trim().min(1).optional(),
  mine: z.enum(['1']).optional(),
});

export async function characterRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, nexon, storage, events } = app.deps;
  const uploads = new UploadLimiter();

  app.post('/characters/lookup', async (req) => {
    await requireUser(req);
    const { ign } = lookupBody.parse(req.body);
    return lookupCharacters({ prisma, nexon }, ign);
  });

  app.post('/characters', async (req, reply) => {
    const viewer = await requireUser(req);
    const input = createBody.parse(req.body);
    const row = await createCharacter({ prisma, nexon }, viewer.user.id, input);
    return reply.status(201).send(toCharacterDTO(row, viewer.user.id, storage));
  });

  app.post('/characters/manual', async (req, reply) => {
    const viewer = await requireUser(req);
    const input = manualBody.parse(req.body);
    const row = await createManualCharacter(prisma, viewer.user.id, input);
    return reply.status(201).send(toCharacterDTO(row, viewer.user.id, storage));
  });

  app.get('/characters', async (req) => {
    const query = listQuery.parse(req.query);
    const viewer = query.mine ? await requireUser(req) : await getViewer(req);
    const rows = await listCharacters(prisma, { ...query, ownerId: query.mine ? viewer!.user.id : undefined });
    return rows.map((r) => toCharacterDTO(r, viewer?.user.id ?? null, storage));
  });

  app.get('/characters/:id', async (req) => {
    const { id } = req.params as { id: string };
    const viewer = await getViewer(req);
    return toCharacterDTO(await getCharacter(prisma, id), viewer?.user.id ?? null, storage);
  });

  app.patch('/characters/:id', async (req) => {
    const viewer = await requireUser(req);
    const { id } = req.params as { id: string };
    const row = await getOwnedCharacter(prisma, id, viewer.user.id);
    const input = updateBody.parse(req.body);
    return toCharacterDTO(await updateCharacter(prisma, row, input), viewer.user.id, storage);
  });

  app.delete('/characters/:id', async (req, reply) => {
    const viewer = await requireUser(req);
    const { id } = req.params as { id: string };
    await getOwnedCharacter(prisma, id, viewer.user.id);
    const { closedPostIds, declinedRequestIds, screenshotKey } = await deleteCharacter(prisma, id);
    closedPostIds.forEach((postId) => events.emit({ type: 'post.closed', postId, reason: 'character_deleted' }));
    declinedRequestIds.forEach((requestId) => events.emit({ type: 'request.declined', requestId, auto: true, actorUserId: viewer.user.id }));
    if (screenshotKey) await storage.remove(screenshotKey).catch(() => undefined);
    return reply.status(204).send();
  });

  app.put('/characters/:id/screenshot', async (req) => {
    const viewer = await requireUser(req);
    const { id } = req.params as { id: string };
    await getOwnedCharacter(prisma, id, viewer.user.id);
    uploads.take(viewer.user.id); // before reading or decoding anything
    const { buf, ext } = await readImageUpload(req);
    await app.deps.scouterValidator.validate(buf);
    const key = await storage.save(buf, ext);
    let replacement;
    try {
      replacement = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Character" WHERE id = ${id} FOR UPDATE`;
        const current = await getOwnedCharacter(tx, id, viewer.user.id);
        const character = await tx.character.update({ where: { id }, data: { screenshotKey: key }, include: characterInclude });
        return { character, previousKey: current.screenshotKey };
      });
    } catch (err) {
      await storage.remove(key).catch(() => undefined);
      throw err;
    }
    if (replacement.previousKey) await storage.remove(replacement.previousKey).catch(() => undefined);
    return toCharacterDTO(replacement.character, viewer.user.id, storage);
  });

  app.post('/characters/:id/refresh', async (req): Promise<RefreshResultDTO> => {
    const viewer = await requireUser(req);
    const { id } = req.params as { id: string };
    const row = await getOwnedCharacter(prisma, id, viewer.user.id);
    await claimRefresh(prisma, id);
    const { outcome, candidates } = await refreshCharacter(prisma, nexon, row);
    return { outcome, candidates, character: toCharacterDTO(await getCharacter(prisma, id), viewer.user.id, storage) };
  });

  app.post('/characters/:id/move', async (req) => {
    const viewer = await requireUser(req);
    const { id } = req.params as { id: string };
    const input = moveBody.parse(req.body);
    return toCharacterDTO(await moveCharacterWorld(prisma, nexon, viewer.user.id, id, input), viewer.user.id, storage);
  });
}
