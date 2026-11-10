import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getViewer, requireUser } from '../auth/guards.js';
import { readImageUpload } from '../storage/imageType.js';
import {
  claimRefresh, createCharacter, deleteCharacter, getCharacter, getOwnedCharacter, listCharacters, lookupCharacters,
  syncCharacterFromNexon, updateCharacter,
} from './service.js';
import { characterInclude, toCharacterDTO } from './serialize.js';

const lookupBody = z.object({ ign: z.string().trim().min(1) });

const createBody = z.object({
  ign: z.string().trim().min(1),
  nexonWorldId: z.number().int(),
  combatPower: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  guildId: z.string().min(1),
});

const updateBody = createBody.pick({ combatPower: true, guildId: true }).partial();

const listQuery = z.object({
  guildId: z.string().min(1).optional(),
  worldId: z.coerce.number().int().optional(),
  archetype: z.enum(['warrior', 'magician', 'bowman', 'thief', 'pirate', 'xenon', 'unknown']).optional(),
  q: z.string().trim().min(1).optional(),
  mine: z.enum(['1']).optional(),
});

export async function characterRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, nexon, storage, events } = app.deps;

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
    const row = await getOwnedCharacter(prisma, id, viewer.user.id);
    const { closedPostIds, declinedRequestIds } = await deleteCharacter(prisma, id);
    closedPostIds.forEach((postId) => events.emit({ type: 'post.closed', postId, reason: 'character_deleted' }));
    declinedRequestIds.forEach((requestId) => events.emit({ type: 'request.declined', requestId, auto: true, actorUserId: viewer.user.id }));
    if (row.screenshotKey) await storage.remove(row.screenshotKey).catch(() => undefined);
    return reply.status(204).send();
  });

  app.put('/characters/:id/screenshot', async (req) => {
    const viewer = await requireUser(req);
    const { id } = req.params as { id: string };
    const row = await getOwnedCharacter(prisma, id, viewer.user.id);
    const { buf, ext } = await readImageUpload(req);
    const key = await storage.save(buf, ext);
    let updated;
    try {
      updated = await prisma.character.update({ where: { id }, data: { screenshotKey: key }, include: characterInclude });
    } catch (err) {
      await storage.remove(key).catch(() => undefined);
      throw err;
    }
    if (row.screenshotKey) await storage.remove(row.screenshotKey).catch(() => undefined);
    return toCharacterDTO(updated, viewer.user.id, storage);
  });

  app.post('/characters/:id/refresh', async (req) => {
    const viewer = await requireUser(req);
    const { id } = req.params as { id: string };
    await getOwnedCharacter(prisma, id, viewer.user.id);
    await claimRefresh(prisma, id);
    await syncCharacterFromNexon(prisma, nexon, id);
    return toCharacterDTO(await getCharacter(prisma, id), viewer.user.id, storage);
  });
}
