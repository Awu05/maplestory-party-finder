import { Prisma, type PrismaClient } from '@prisma/client';
import { AppError } from '../http/errors.js';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The case-insensitive claim key for a Discord username (User.usernameKey). An empty name is never a
 * claim: it maps to null, so two accounts without a name don't collide and '' can't be "taken".
 */
export const usernameKey = (username: string): string | null => username.toLowerCase() || null;

export const usernameTaken = (): AppError => new AppError(409, 'USERNAME_TAKEN', 'That Discord username is already in use.');

/** True when `error` is the unique-index violation on User.usernameKey. */
export function isUsernameConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return false;
  return String(error.meta?.target ?? '').includes('usernameKey');
}

/** Throws USERNAME_TAKEN when an account other than `exceptUserId` holds `username`. */
export async function ensureUsernameAvailable(db: Db, username: string, exceptUserId?: string): Promise<void> {
  const key = usernameKey(username);
  if (key === null) return;
  const holder = await db.user.findUnique({ where: { usernameKey: key }, select: { id: true } });
  if (holder && holder.id !== exceptUserId) throw usernameTaken();
}

/**
 * "Real Discord wins": before a Discord account takes `username`, whichever other account holds the
 * claim gives it up. A typed (unlinked) name is cleared so its owner picks a new one; a linked
 * account's stale name keeps its text and refreshes on that account's next Discord login.
 * `isSelf` recognises the claiming account's own row, which keeps its claim.
 */
export async function releaseUsernameClaim(tx: Prisma.TransactionClient, username: string, isSelf: (holder: { id: string; discordId: string | null }) => boolean): Promise<void> {
  const key = usernameKey(username);
  if (key === null) return;
  const holder = await tx.user.findUnique({ where: { usernameKey: key }, select: { id: true, discordId: true } });
  if (!holder || isSelf(holder)) return;
  await tx.user.update({
    where: { id: holder.id },
    data: holder.discordId === null ? { username: '', usernameKey: null } : { usernameKey: null },
  });
}

/**
 * Runs a Discord account's name-claiming write (`claim` true: release the name from others and take it).
 * If another account takes the name between the release and the write, the unique index rejects it:
 * retry once, and if it is taken again, save without a claim (`claim` false, usernameKey null) rather
 * than fail the login. The account's next Discord login claims the name.
 */
export async function withUsernameClaim<T>(write: (claim: boolean) => Promise<T>): Promise<T> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await write(true);
    } catch (error) {
      // P2034: Postgres aborted this transaction for a write conflict or deadlock (two accounts
      // swapping names at the same moment); it is safe to run again.
      const retryable = isUsernameConflict(error) || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034');
      if (!retryable) throw error;
    }
  }
  return write(false);
}
