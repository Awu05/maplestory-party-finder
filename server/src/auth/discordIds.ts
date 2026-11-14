import { Prisma, type PrismaClient } from '@prisma/client';
import { AppError } from '../http/errors.js';

type Db = PrismaClient | Prisma.TransactionClient;
export const discordIdTaken = () => new AppError(409, 'DISCORD_ID_TAKEN', 'That Discord ID is already used by another account.');

/** A banned or deleted account's typed ID is unverified, so it never blocks anyone else from the ID. */
const removedAccount = { OR: [{ banned: true }, { deletedAt: { not: null } }] } satisfies Prisma.UserWhereInput;

export async function ensureDiscordIdAvailable(db: Db, id: string, selfUserId?: string): Promise<void> {
  const holder = await db.user.findFirst({ where: {
    ...(selfUserId ? { id: { not: selfUserId } } : {}),
    OR: [{ discordId: id }, { typedDiscordId: id, NOT: removedAccount }],
  }, select: { id: true } });
  if (holder) throw discordIdTaken();
}

export function isDiscordIdConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
    && String(error.meta?.target ?? '').includes('typedDiscordId');
}

export async function clearTypedDiscordId(tx: Prisma.TransactionClient, verifiedId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${verifiedId}))`;
  await tx.user.updateMany({ where: { typedDiscordId: verifiedId }, data: { typedDiscordId: null } });
}

export function withDiscordIdClaim<T>(prisma: PrismaClient, id: string, write: (tx: Prisma.TransactionClient) => Promise<T>, selfUserId?: string): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${id}))`;
    await ensureDiscordIdAvailable(tx, id, selfUserId);
    // Frees the unique index for the new holder.
    await tx.user.updateMany({ where: { typedDiscordId: id, ...removedAccount, ...(selfUserId ? { id: { not: selfUserId } } : {}) }, data: { typedDiscordId: null } });
    return write(tx);
  });
}
