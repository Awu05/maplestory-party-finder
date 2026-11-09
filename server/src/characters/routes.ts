import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireUser } from '../auth/guards.js';
import { createCharacter, lookupCharacters } from './service.js';
import { toCharacterDTO } from './serialize.js';

const lookupBody = z.object({ ign: z.string().trim().min(1) });

const createBody = z.object({
  ign: z.string().trim().min(1),
  nexonWorldId: z.number().int(),
  combatPower: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  guildId: z.string().min(1),
  bosses: z.array(
    z.object({ bossDifficultyId: z.number().int(), experience: z.enum(['learning', 'cleared', 'can_carry']) }),
  ),
  playTimes: z
    .array(z.number().int().min(0).max(167))
    .refine((p) => new Set(p).size === p.length, 'Duplicate playTimes'),
  note: z.string().max(300),
});

export async function characterRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, nexon, storage } = app.deps;

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
}
