import type { Prisma } from '@prisma/client';

/** Declines every pending request matching `where`; returns their ids so callers can emit request.declined{auto:true} after commit. */
export async function autoDeclinePending(tx: Prisma.TransactionClient, where: Prisma.RequestWhereInput): Promise<string[]> {
  const pendingWhere: Prisma.RequestWhereInput = { AND: [where, { status: 'pending' }] };
  const rows = await tx.request.findMany({ where: pendingWhere, select: { id: true } });
  const ids = rows.map((r) => r.id);
  if (ids.length > 0) {
    await tx.request.updateMany({ where: { id: { in: ids }, status: 'pending' }, data: { status: 'declined', decidedAt: new Date() } });
  }
  return ids;
}
