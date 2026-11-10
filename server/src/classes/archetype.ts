import type { Prisma, PrismaClient } from '@prisma/client';
import { classToArchetype, type Archetype } from '@pf/shared';

/** Admin-managed JobClass wins; otherwise fall back to the built-in table (then 'unknown'). */
export async function resolveArchetype(db: PrismaClient | Prisma.TransactionClient, jobName: string): Promise<Archetype> {
  const row = await db.jobClass.findUnique({ where: { nameLower: jobName.trim().toLowerCase() } });
  return row?.archetype ?? classToArchetype(jobName);
}
