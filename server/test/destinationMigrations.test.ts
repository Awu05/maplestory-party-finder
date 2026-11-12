import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { Prisma } from '@prisma/client';
import { prisma } from './helpers.js';

// Comment lines are dropped first: they may contain semicolons.
const migration = (name: string) => readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8')
  .split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
const run = async (tx: Prisma.TransactionClient, sql: string) => {
  for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
};

it('clears the party chat guild of LFP posts only', async () => {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "Post" (id TEXT, type TEXT, "partyForumGuildId" TEXT) ON COMMIT DROP');
    await tx.$executeRawUnsafe(`INSERT INTO "Post" VALUES ('lfp', 'lfp', 'g1'), ('recruiting', 'recruiting', 'g1'), ('lfp-none', 'lfp', NULL)`);
    await run(tx, migration('20261112144356_clear_lfp_party_chat'));
    const posts = await tx.$queryRawUnsafe<{ id: string; partyForumGuildId: string | null }[]>('SELECT id, "partyForumGuildId" FROM "Post" ORDER BY id');
    expect(posts).toEqual([
      { id: 'lfp', partyForumGuildId: null },
      { id: 'lfp-none', partyForumGuildId: null },
      { id: 'recruiting', partyForumGuildId: 'g1' },
    ]);
  });
});

it('remembers which guilds saw a live post announced since its last closure notice', async () => {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "Post" (id TEXT, status TEXT, "deletedAt" TIMESTAMP) ON COMMIT DROP');
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "WebhookDelivery" ("postId" TEXT, "guildId" TEXT, "eventType" TEXT, status TEXT, "createdAt" TIMESTAMP) ON COMMIT DROP');
    await tx.$executeRawUnsafe(`INSERT INTO "Post" VALUES ('open', 'open', NULL), ('reopened', 'full', NULL), ('closed', 'closed', NULL), ('deleted', 'open', NOW())`);
    await tx.$executeRawUnsafe(`INSERT INTO "WebhookDelivery" VALUES
      ('open', 'b', 'post.created', 'sent', '2026-11-01'), ('open', 'a', 'post.announcement', 'sent', '2026-11-02'),
      ('open', 'a', 'post.created', 'sent', '2026-11-01'), ('open', 'c', 'post.created', 'failed', '2026-11-01'),
      ('open', 'd', 'request.created', 'sent', '2026-11-01'),
      ('reopened', 'a', 'post.created', 'sent', '2026-11-01'), ('reopened', 'a', 'post.closed', 'sent', '2026-11-02'),
      ('reopened', 'b', 'post.reopened', 'sent', '2026-11-03'),
      ('closed', 'a', 'post.created', 'sent', '2026-11-01'), ('deleted', 'a', 'post.created', 'sent', '2026-11-01')`);
    await run(tx, migration('20261112144937_post_announced_guilds'));
    const posts = await tx.$queryRawUnsafe<{ id: string; announcedGuildIds: string[] }[]>('SELECT id, "announcedGuildIds" FROM "Post" ORDER BY id');
    expect(posts).toEqual([
      { id: 'closed', announcedGuildIds: [] },
      { id: 'deleted', announcedGuildIds: [] },
      { id: 'open', announcedGuildIds: ['a', 'b'] },
      { id: 'reopened', announcedGuildIds: ['b'] },
    ]);
  });
});
