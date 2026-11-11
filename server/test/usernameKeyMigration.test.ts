import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { prisma } from './helpers.js';

it('backfills one case-insensitive claim per Discord username without failing on duplicates', async () => {
  const sql = readFileSync(new URL('../prisma/migrations/20261111220000_unique_discord_username/migration.sql', import.meta.url), 'utf8');
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "User" (id TEXT, "discordId" TEXT, username TEXT NOT NULL, "createdAt" TIMESTAMP NOT NULL) ON COMMIT DROP');
    await tx.$executeRawUnsafe(`INSERT INTO "User" VALUES
      ('linked-old', 'd-1', 'Maple', '2026-01-01'),
      ('linked-new', 'd-2', 'maple', '2026-02-01'),
      ('unlinked-vs-linked', NULL, 'MAPLE', '2025-01-01'),
      ('unlinked-first', NULL, 'Solo', '2026-01-01'),
      ('unlinked-second', NULL, 'solo', '2026-03-01'),
      ('unlinked-unique', NULL, 'Unique', '2026-01-01'),
      ('linked-unique', 'd-3', 'Other', '2026-01-01')`);
    for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
    const users = await tx.$queryRawUnsafe<{ id: string; username: string; usernameKey: string | null }[]>('SELECT id, username, "usernameKey" FROM "User" ORDER BY id');
    expect(users).toEqual([
      { id: 'linked-new', username: 'maple', usernameKey: 'maple' },
      // A stale linked name keeps its text; it refreshes on the next Discord login.
      { id: 'linked-old', username: 'Maple', usernameKey: null },
      { id: 'linked-unique', username: 'Other', usernameKey: 'other' },
      { id: 'unlinked-first', username: 'Solo', usernameKey: 'solo' },
      { id: 'unlinked-second', username: '', usernameKey: null },
      { id: 'unlinked-unique', username: 'Unique', usernameKey: 'unique' },
      // The real Discord account wins even over an older typed name.
      { id: 'unlinked-vs-linked', username: '', usernameKey: null },
    ]);
    const indexes = await tx.$queryRawUnsafe<{ indexdef: string }[]>(`SELECT indexdef FROM pg_indexes WHERE tablename = 'User' AND schemaname LIKE 'pg_temp%'`);
    expect(indexes.map((i) => i.indexdef)).toEqual([expect.stringMatching(/^CREATE UNIQUE INDEX "User_usernameKey_key" .*\("usernameKey"\)$/)]);
  });
});
