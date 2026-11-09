import { beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../prisma/seed.js';
import { prisma, resetDb } from './helpers.js';

describe('seed', () => {
  beforeEach(resetDb);

  it('is idempotent and inserts worlds, tiers, bosses', async () => {
    await seed(prisma);
    await seed(prisma);

    const worlds = await prisma.world.findMany();
    expect(worlds).toHaveLength(4);
    expect(worlds.find((w) => w.nexonWorldId === 45)).toMatchObject({ name: 'Kronos', worldType: 'heroic' });

    const tiers = await prisma.rarityTier.findMany({ orderBy: { sortOrder: 'asc' } });
    expect(tiers.map((t) => t.name)).toEqual(['Common', 'Rare', 'Epic', 'Unique', 'Legendary']);
    expect(tiers[4]!.minCp).toBe(400_000_000n);

    const lucid = await prisma.boss.findUnique({ where: { name: 'Lucid' }, include: { difficulties: true } });
    expect(lucid!.difficulties.map((d) => d.difficulty).sort()).toEqual(['Easy', 'Hard', 'Normal']);
    expect(lucid!.difficulties.every((d) => d.partyCap === 6)).toBe(true);

    const names = (await prisma.boss.findMany()).map((b) => b.name);
    expect(new Set(names).size).toBe(names.length);
    const pairs = (await prisma.bossDifficulty.findMany()).map((d) => `${d.bossId}:${d.difficulty}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });
});
