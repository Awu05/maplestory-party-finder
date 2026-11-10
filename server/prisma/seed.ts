import { pathToFileURL } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { KNOWN_CLASSES } from '@pf/shared';

const WORLDS = [
  { nexonWorldId: 1, name: 'Bera', worldType: 'interactive' },
  { nexonWorldId: 19, name: 'Scania', worldType: 'interactive' },
  { nexonWorldId: 45, name: 'Kronos', worldType: 'heroic' },
  { nexonWorldId: 70, name: 'Hyperion', worldType: 'heroic' },
] as const;

const TIERS: [name: string, minCp: bigint][] = [
  ['Common', 0n],
  ['Rare', 20_000_000n],
  ['Epic', 60_000_000n],
  ['Unique', 150_000_000n],
  ['Legendary', 400_000_000n],
];

const BOSSES: [name: string, difficulties: string[]][] = [
  ['Zakum', ['Chaos']],
  ['Magnus', ['Hard']],
  ['Hilla', ['Hard']],
  ['Pink Bean', ['Chaos']],
  ['Cygnus', ['Easy', 'Normal']],
  ['Pierre', ['Chaos']],
  ['Von Bon', ['Chaos']],
  ['Crimson Queen', ['Chaos']],
  ['Vellum', ['Chaos']],
  ['Papulatus', ['Chaos']],
  ['Lotus', ['Normal', 'Hard', 'Extreme']],
  ['Damien', ['Normal', 'Hard']],
  ['Guardian Angel Slime', ['Normal', 'Chaos']],
  ['Lucid', ['Easy', 'Normal', 'Hard']],
  ['Will', ['Easy', 'Normal', 'Hard']],
  ['Gloom', ['Normal', 'Chaos']],
  ['Verus Hilla', ['Normal', 'Hard']],
  ['Darknell', ['Normal', 'Hard']],
  ['Black Mage', ['Hard', 'Extreme']],
  ['Chosen Seren', ['Normal', 'Hard', 'Extreme']],
  ['Kalos the Guardian', ['Easy', 'Normal', 'Chaos', 'Extreme']],
  ['Kaling', ['Easy', 'Normal', 'Hard', 'Extreme']],
  ['First Adversary', ['Easy', 'Normal', 'Hard', 'Extreme']],
  ['Limbo', ['Normal', 'Hard']],
  ['Baldrix', ['Normal', 'Hard']],
];

export async function seed(prisma: PrismaClient): Promise<void> {
  for (const w of WORLDS) {
    await prisma.world.upsert({
      where: { nexonWorldId: w.nexonWorldId },
      create: w,
      update: {},
    });
  }

  for (const [sortOrder, [name, minCp]] of TIERS.entries()) {
    await prisma.rarityTier.upsert({
      where: { name },
      create: { name, minCp, sortOrder },
      update: {},
    });
  }

  for (const { name, archetype } of KNOWN_CLASSES) {
    await prisma.jobClass.upsert({
      where: { nameLower: name.toLowerCase() },
      create: { name, nameLower: name.toLowerCase(), archetype },
      update: {},
    });
  }
  for (const jc of await prisma.jobClass.findMany()) {
    await prisma.character.updateMany({
      where: { jobName: { equals: jc.name, mode: 'insensitive' }, archetype: 'unknown' },
      data: { archetype: jc.archetype },
    });
  }

  for (const [bossIndex, [name, difficulties]] of BOSSES.entries()) {
    const boss = await prisma.boss.upsert({
      where: { name },
      create: { name, sortOrder: bossIndex },
      update: {},
    });
    for (const [sortOrder, difficulty] of difficulties.entries()) {
      await prisma.bossDifficulty.upsert({
        where: { bossId_difficulty: { bossId: boss.id, difficulty } },
        create: { bossId: boss.id, difficulty, sortOrder },
        update: {},
      });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const prisma = new PrismaClient();
  seed(prisma)
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
