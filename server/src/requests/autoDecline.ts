import type { Prisma } from '@prisma/client';

/**
 * Declines every pending request matching `where` in one UPDATE ... RETURNING; returns the ids it
 * actually declined (a request decided concurrently no longer matches status = 'pending' and is skipped)
 * so callers can emit request.declined{auto:true} after commit.
 */
export async function autoDeclinePending(tx: Prisma.TransactionClient, where: Prisma.RequestWhereInput): Promise<string[]> {
  const rows = await tx.request.updateManyAndReturn({
    where: { AND: [where, { status: 'pending' }] },
    data: { status: 'declined', decidedAt: new Date() },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
