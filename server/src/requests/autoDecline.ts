import { Prisma } from '@prisma/client';

/**
 * Declines every pending request matching `where`; returns the ids it actually declined (a request
 * decided concurrently is skipped) so callers can emit request.declined{auto:true} after commit.
 */
export async function autoDeclinePending(tx: Prisma.TransactionClient, where: Prisma.RequestWhereInput): Promise<string[]> {
  const pendingWhere: Prisma.RequestWhereInput = { AND: [where, { status: 'pending' }] };
  const rows = await tx.request.findMany({ where: pendingWhere, select: { id: true } });
  if (rows.length === 0) return [];
  const updated = await tx.$queryRaw<{ id: string }[]>`
    UPDATE "Request" SET status = 'declined', "decidedAt" = ${new Date()}
    WHERE id IN (${Prisma.join(rows.map((r) => r.id))}) AND status = 'pending'
    RETURNING id`;
  return updated.map((r) => r.id);
}
