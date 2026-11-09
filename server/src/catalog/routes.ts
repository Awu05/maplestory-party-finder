import type { FastifyInstance } from 'fastify';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import type { AdminGuildDTO, BossDTO, GuildDTO, RarityTierDTO, WorldDTO } from '@pf/shared';
import { getViewer, requireAdmin } from '../auth/guards.js';
import { AppError } from '../http/errors.js';

const WEBHOOK_RE = /^https:\/\/(discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+$/;

const webhookUrl = z.string().regex(WEBHOOK_RE, 'Invalid Discord webhook URL');
const worldIds = z.array(z.number().int());

const guildCreate = z.object({
  name: z.string().trim().min(1),
  iconUrl: z.string().min(1).nullish(),
  webhookUrl: webhookUrl.nullish(),
  worldIds,
});
const guildPatch = z.object({
  name: z.string().trim().min(1).optional(),
  iconUrl: z.string().min(1).nullish(),
  webhookUrl: webhookUrl.nullish(),
  active: z.boolean().optional(),
  worldIds: worldIds.optional(),
});

const worldType = z.enum(['heroic', 'interactive']);
const worldCreate = z.object({ nexonWorldId: z.number().int(), name: z.string().trim().min(1), worldType });
const worldPatch = z.object({
  name: z.string().trim().min(1).optional(),
  worldType: worldType.optional(),
  active: z.boolean().optional(),
});

const difficultyInput = z.object({
  difficulty: z.string().trim().min(1),
  partyCap: z.number().int().positive().optional(),
  sortOrder: z.number().int().optional(),
});
const difficultiesInput = z.array(difficultyInput).refine(
  (ds) => new Set(ds.map((d) => d.difficulty)).size === ds.length,
  'Duplicate difficulty names',
);
const bossCreate = z.object({
  name: z.string().trim().min(1),
  imageUrl: z.string().min(1).nullish(),
  sortOrder: z.number().int().optional(),
  difficulties: difficultiesInput,
});
const bossPatch = z.object({
  name: z.string().trim().min(1).optional(),
  imageUrl: z.string().min(1).nullish(),
  sortOrder: z.number().int().optional(),
  difficulties: difficultiesInput.optional(),
});

const tiersInput = z.object({
  tiers: z.array(
    z.object({
      name: z.string().trim().min(1),
      minCp: z.number().int().nonnegative(),
      sortOrder: z.number().int(),
    }),
  ),
});

const idParam = z.object({ id: z.coerce.number().int() });
const guildIdParam = z.object({ id: z.string().min(1) });

type GuildRow = Prisma.GuildGetPayload<{ include: { worlds: true } }>;

function toGuildDTO(g: GuildRow): GuildDTO {
  return {
    id: g.id,
    name: g.name,
    iconUrl: g.iconUrl,
    worldIds: g.worlds.map((w) => w.worldId).sort((a, b) => a - b),
    active: g.active,
  };
}

function toAdminGuildDTO(g: GuildRow): AdminGuildDTO {
  return { ...toGuildDTO(g), webhookUrl: g.webhookUrl };
}

function toWorldDTO(w: { id: number; nexonWorldId: number; name: string; worldType: string; active: boolean }): WorldDTO {
  return { id: w.id, nexonWorldId: w.nexonWorldId, name: w.name, worldType: w.worldType as WorldDTO['worldType'], active: w.active };
}

type BossRow = Prisma.BossGetPayload<{ include: { difficulties: true } }>;

function toBossDTO(b: BossRow): BossDTO {
  return {
    id: b.id,
    name: b.name,
    imageUrl: b.imageUrl,
    difficulties: [...b.difficulties]
      .sort((a, c) => a.sortOrder - c.sortOrder || a.id - c.id)
      .map((d) => ({ id: d.id, difficulty: d.difficulty, partyCap: d.partyCap })),
  };
}

function toTierDTO(t: { id: number; name: string; minCp: bigint; sortOrder: number }): RarityTierDTO {
  return { id: t.id, name: t.name, minCp: Number(t.minCp), sortOrder: t.sortOrder };
}

function isCode(err: unknown, code: string): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === code;
}

/** Runs fn, turning a unique-constraint violation into 409 DUPLICATE. */
async function mapDuplicate<T>(fn: () => Promise<T>, what: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isCode(err, 'P2002')) throw new AppError(409, 'DUPLICATE', `${what} already exists`);
    throw err;
  }
}

async function assertWorldsExist(prisma: PrismaClient | Prisma.TransactionClient, ids: number[]): Promise<void> {
  const unique = [...new Set(ids)];
  const found = await prisma.world.count({ where: { id: { in: unique } } });
  if (found !== unique.length) throw new AppError(400, 'VALIDATION', 'Unknown worldIds');
}

export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = app.deps;

  // ---- Public ----
  app.get('/worlds', async (req) => {
    const all = (req.query as { all?: string }).all === '1';
    const viewer = all ? await getViewer(req) : null;
    const where = all && viewer?.isAdmin ? {} : { active: true };
    const worlds = await prisma.world.findMany({ where, orderBy: { id: 'asc' } });
    return worlds.map(toWorldDTO);
  });

  app.get('/guilds', async () => {
    const guilds = await prisma.guild.findMany({
      where: { active: true },
      include: { worlds: true },
      orderBy: { name: 'asc' },
    });
    return guilds.map(toGuildDTO);
  });

  app.get('/bosses', async () => {
    const bosses = await prisma.boss.findMany({
      include: { difficulties: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    });
    return bosses.map(toBossDTO);
  });

  app.get('/rarity-tiers', async () => {
    const tiers = await prisma.rarityTier.findMany({ orderBy: { minCp: 'asc' } });
    return tiers.map(toTierDTO);
  });

  // ---- Admin: guilds ----
  app.get('/admin/guilds', async (req) => {
    await requireAdmin(req);
    const guilds = await prisma.guild.findMany({ include: { worlds: true }, orderBy: { name: 'asc' } });
    return guilds.map(toAdminGuildDTO);
  });

  app.post('/admin/guilds', async (req, reply) => {
    await requireAdmin(req);
    const body = guildCreate.parse(req.body);
    await assertWorldsExist(prisma, body.worldIds);
    const guild = await mapDuplicate(
      () =>
        prisma.guild.create({
          data: {
            name: body.name,
            iconUrl: body.iconUrl ?? null,
            webhookUrl: body.webhookUrl ?? null,
            worlds: { create: [...new Set(body.worldIds)].map((worldId) => ({ worldId })) },
          },
          include: { worlds: true },
        }),
      'Guild',
    );
    return reply.status(201).send(toAdminGuildDTO(guild));
  });

  app.patch('/admin/guilds/:id', async (req) => {
    await requireAdmin(req);
    const { id } = guildIdParam.parse(req.params);
    const body = guildPatch.parse(req.body);
    if (body.worldIds) await assertWorldsExist(prisma, body.worldIds);
    const guild = await mapDuplicate(
      () =>
        prisma.$transaction(async (tx) => {
          if (!(await tx.guild.findUnique({ where: { id } }))) throw new AppError(404, 'NOT_FOUND');
          if (body.worldIds) {
            await tx.guildWorld.deleteMany({ where: { guildId: id } });
            await tx.guildWorld.createMany({
              data: [...new Set(body.worldIds)].map((worldId) => ({ guildId: id, worldId })),
            });
          }
          return tx.guild.update({
            where: { id },
            data: {
              name: body.name,
              iconUrl: body.iconUrl,
              webhookUrl: body.webhookUrl,
              active: body.active,
            },
            include: { worlds: true },
          });
        }),
      'Guild',
    );
    return toAdminGuildDTO(guild);
  });

  // ---- Admin: worlds ----
  app.post('/admin/worlds', async (req, reply) => {
    await requireAdmin(req);
    const body = worldCreate.parse(req.body);
    const world = await mapDuplicate(() => prisma.world.create({ data: body }), 'World');
    return reply.status(201).send(toWorldDTO(world));
  });

  app.patch('/admin/worlds/:id', async (req) => {
    await requireAdmin(req);
    const { id } = idParam.parse(req.params);
    const body = worldPatch.parse(req.body);
    try {
      return toWorldDTO(await prisma.world.update({ where: { id }, data: body }));
    } catch (err) {
      if (isCode(err, 'P2025')) throw new AppError(404, 'NOT_FOUND');
      throw err;
    }
  });

  // ---- Admin: bosses ----
  app.post('/admin/bosses', async (req, reply) => {
    await requireAdmin(req);
    const body = bossCreate.parse(req.body);
    const boss = await mapDuplicate(
      () =>
        prisma.boss.create({
          data: {
            name: body.name,
            imageUrl: body.imageUrl ?? null,
            sortOrder: body.sortOrder,
            difficulties: { create: body.difficulties },
          },
          include: { difficulties: true },
        }),
      'Boss',
    );
    return reply.status(201).send(toBossDTO(boss));
  });

  app.patch('/admin/bosses/:id', async (req) => {
    await requireAdmin(req);
    const { id } = idParam.parse(req.params);
    const body = bossPatch.parse(req.body);
    const boss = await mapDuplicate(
      () =>
        prisma.$transaction(async (tx) => {
          if (!(await tx.boss.findUnique({ where: { id } }))) throw new AppError(404, 'NOT_FOUND');
          await tx.boss.update({
            where: { id },
            data: { name: body.name, imageUrl: body.imageUrl, sortOrder: body.sortOrder },
          });
          if (body.difficulties) {
            const wanted = new Map(body.difficulties.map((d) => [d.difficulty, d]));
            const existing = await tx.bossDifficulty.findMany({ where: { bossId: id } });
            const stale = existing.filter((e) => !wanted.has(e.difficulty));
            if (stale.length > 0) {
              const staleIds = stale.map((s) => s.id);
              const used =
                (await tx.characterBoss.count({ where: { bossDifficultyId: { in: staleIds } } })) +
                (await tx.postBoss.count({ where: { bossDifficultyId: { in: staleIds } } }));
              if (used > 0) throw new AppError(409, 'IN_USE', 'A removed difficulty is referenced by characters or posts');
              await tx.bossDifficulty.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
            }
            const byName = new Map(existing.map((e) => [e.difficulty, e]));
            for (const d of body.difficulties) {
              const current = byName.get(d.difficulty);
              if (current) {
                await tx.bossDifficulty.update({
                  where: { id: current.id },
                  data: { partyCap: d.partyCap, sortOrder: d.sortOrder },
                });
              } else {
                await tx.bossDifficulty.create({ data: { bossId: id, ...d } });
              }
            }
          }
          return tx.boss.findUniqueOrThrow({ where: { id }, include: { difficulties: true } });
        }),
      'Boss',
    );
    return toBossDTO(boss);
  });

  app.delete('/admin/bosses/:id', async (req, reply) => {
    await requireAdmin(req);
    const { id } = idParam.parse(req.params);
    await prisma.$transaction(async (tx) => {
      if (!(await tx.boss.findUnique({ where: { id } }))) throw new AppError(404, 'NOT_FOUND');
      const used =
        (await tx.characterBoss.count({ where: { bossDifficulty: { bossId: id } } })) +
        (await tx.postBoss.count({ where: { bossDifficulty: { bossId: id } } }));
      if (used > 0) throw new AppError(409, 'IN_USE', 'Boss is referenced by characters or posts');
      await tx.boss.delete({ where: { id } });
    });
    return reply.status(204).send();
  });

  // ---- Admin: rarity tiers ----
  app.put('/admin/rarity-tiers', async (req) => {
    await requireAdmin(req);
    const { tiers } = tiersInput.parse(req.body);
    if (!tiers.some((t) => t.minCp === 0)) {
      throw new AppError(400, 'NEEDS_BASE_TIER', 'A tier with minCp 0 is required');
    }
    await mapDuplicate(
      () =>
        prisma.$transaction([
          prisma.rarityTier.deleteMany(),
          prisma.rarityTier.createMany({ data: tiers.map((t) => ({ ...t, minCp: BigInt(t.minCp) })) }),
        ]),
      'Rarity tier',
    );
    const saved = await prisma.rarityTier.findMany({ orderBy: { minCp: 'asc' } });
    return saved.map(toTierDTO);
  });
}
