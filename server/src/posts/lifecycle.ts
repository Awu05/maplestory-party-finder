import { Prisma } from '@prisma/client';
import { autoDeclinePending } from '../requests/autoDecline.js';

export type LivePostOwner = { posterUserId: string } | { posterCharacterId: string };

/**
 * Closes every live (open or full, not deleted) post of `owner` with `reason`, and auto-declines the
 * pending requests on them (as the recruiting post or the LFP post), plus any matching `alsoDecline`.
 * The posts are locked first in the global lock order (recruiting before LFP) so a concurrent close
 * can't make us report a post this call didn't close. Returns ids for events emitted after commit.
 */
export async function closeLivePosts(
  tx: Prisma.TransactionClient,
  owner: LivePostOwner,
  reason: string,
  alsoDecline?: Prisma.RequestWhereInput,
): Promise<{ closedPostIds: string[]; declinedIds: string[] }> {
  const ownerSql =
    'posterUserId' in owner ? Prisma.sql`"posterUserId" = ${owner.posterUserId}` : Prisma.sql`"posterCharacterId" = ${owner.posterCharacterId}`;
  const locked = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM "Post"
    WHERE ${ownerSql} AND "deletedAt" IS NULL AND status IN ('open', 'full')
    ORDER BY (type = 'lfp'), id
    FOR UPDATE`;
  const closedPostIds = locked.map((p) => p.id);
  await tx.post.updateMany({ where: { id: { in: closedPostIds } }, data: { status: 'closed', closedReason: reason } });
  const declinedIds = await autoDeclinePending(tx, {
    OR: [{ postId: { in: closedPostIds } }, { lfpPostId: { in: closedPostIds } }, ...(alsoDecline ? [alsoDecline] : [])],
  });
  return { closedPostIds, declinedIds };
}
