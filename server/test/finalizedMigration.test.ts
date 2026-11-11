import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { prisma } from './helpers.js';

it('closes existing scheduled posts and declines their pending requests', async () => {
  const sql = readFileSync(new URL('../prisma/migrations/20261111000000_close_finalized_recruitment/migration.sql', import.meta.url), 'utf8');
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "Post" (id TEXT, type TEXT, status TEXT, "closedReason" TEXT, "scheduledAt" TIMESTAMP, "deletedAt" TIMESTAMP, "expiresAt" TIMESTAMP, "weeklyTimeZone" TEXT) ON COMMIT DROP');
    await tx.$executeRawUnsafe('CREATE TEMP TABLE "Request" (id TEXT, "postId" TEXT, "lfpPostId" TEXT, status TEXT, "decidedAt" TIMESTAMP) ON COMMIT DROP');
    await tx.$executeRawUnsafe(`INSERT INTO "Post" VALUES ('scheduled', 'recruiting', 'open', NULL, NOW(), NULL, NOW() + INTERVAL '1 day', NULL), ('flexible', 'recruiting', 'open', NULL, NULL, NULL, NOW() + INTERVAL '1 day', NULL), ('ended', 'recruiting', 'closed', 'manual', NOW(), NULL, NOW() + INTERVAL '1 day', NULL)`);
    await tx.$executeRawUnsafe(`INSERT INTO "Request" VALUES ('pending', 'scheduled', NULL, 'pending', NULL), ('other', 'flexible', NULL, 'pending', NULL)`);
    for (const statement of sql.split(';').map((s) => s.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
    const posts = await tx.$queryRawUnsafe<{ id: string; status: string; closedReason: string | null }[]>('SELECT id, status, "closedReason" FROM "Post" ORDER BY id');
    expect(posts).toEqual([{ id: 'ended', status: 'closed', closedReason: 'manual' }, { id: 'flexible', status: 'open', closedReason: null }, { id: 'scheduled', status: 'closed', closedReason: 'finalized' }]);
    const requests = await tx.$queryRawUnsafe<{ id: string; status: string }[]>('SELECT id, status FROM "Request" ORDER BY id');
    expect(requests).toEqual([{ id: 'other', status: 'pending' }, { id: 'pending', status: 'declined' }]);
  });
});
