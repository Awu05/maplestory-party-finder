import type { PostStatus } from './types';

export const SCHEDULED_GRACE_MS = 3 * 3600_000;
export const FLEXIBLE_TTL_MS = 7 * 86_400_000;
export const MAX_PARTY_SIZE = 6;
export const MIN_PARTY_SIZE = 2;
export const MAX_SCHEDULE_AHEAD_MS = 30 * 86_400_000;
export const SCHEDULE_PAST_TOLERANCE_MS = 5 * 60_000;
export const OVERLAP_WINDOW_MS = 3 * 3600_000;
export const MAX_POST_BOSSES = 10;

export function postExpiresAt(scheduledAt: Date | null, createdAt: Date): Date {
  return scheduledAt
    ? new Date(scheduledAt.getTime() + SCHEDULED_GRACE_MS)
    : new Date(createdAt.getTime() + FLEXIBLE_TTL_MS);
}

export function effectivePostStatus(
  p: { status: PostStatus; expiresAt: Date | string; deletedAt: Date | string | null },
  now: Date,
): PostStatus {
  if (p.deletedAt !== null) return 'closed';
  if (new Date(p.expiresAt).getTime() <= now.getTime()) return 'closed';
  return p.status;
}

export function maxPartySizeFor(partyCaps: number[]): number {
  return Math.min(MAX_PARTY_SIZE, ...partyCaps);
}
