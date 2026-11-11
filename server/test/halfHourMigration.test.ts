import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { prisma } from './helpers.js';

it('preserves every saved post and member hour as two half-hours', async () => {
  const migration = readFileSync(new URL('../prisma/migrations/20261111000300_half_hour_slots/migration.sql', import.meta.url), 'utf8');
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "Post" ("freeTimes" INTEGER[] NOT NULL) ON COMMIT DROP');
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "PostMember" ("freeTimes" INTEGER[] NOT NULL) ON COMMIT DROP');
    await tx.$executeRawUnsafe('INSERT INTO "Post" VALUES (ARRAY[0, 68, 167]), (ARRAY[]::INTEGER[])');
    await tx.$executeRawUnsafe('INSERT INTO "PostMember" VALUES (ARRAY[20, 20, 21])');
    for (const statement of migration.split(';').map((s) => s.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
    const posts = await tx.$queryRawUnsafe<{ freeTimes: number[] }[]>('SELECT "freeTimes" FROM "Post" ORDER BY cardinality("freeTimes")');
    const members = await tx.$queryRawUnsafe<{ freeTimes: number[] }[]>('SELECT "freeTimes" FROM "PostMember"');
    expect(posts.map((p) => p.freeTimes)).toEqual([[], [0, 1, 136, 137, 334, 335]]);
    expect(members[0].freeTimes).toEqual([40, 41, 42, 43]);
  });
});
