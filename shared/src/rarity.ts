export type TierLike = { name: string; minCp: number; sortOrder: number };

export function rarityFor<T extends TierLike>(
  cp: number,
  tiers: T[],
): { tier: T; rank: number; isTop: boolean } | null {
  const sorted = [...tiers].sort((a, b) => a.minCp - b.minCp);
  let rank = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].minCp <= cp) rank = i;
  }
  if (rank < 0) return null;
  return { tier: sorted[rank], rank, isTop: rank === sorted.length - 1 };
}
