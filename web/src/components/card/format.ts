const UNITS: [suffix: string, value: number][] = [
  ['B', 1e9],
  ['M', 1e6],
  ['K', 1e3],
];

/** Compact combat power: 1_500_000_000 → '1.5B', 12_345_678 → '12.3M', 950_000 → '950K', 999 → '999'. */
export function formatCp(n: number): string {
  for (let i = 0; i < UNITS.length; i++) {
    const [suffix, value] = UNITS[i];
    if (n < value) continue;
    const rounded = Math.round((n / value) * 10) / 10;
    // 999_960 rounds to 1000K; promote to the next unit instead.
    if (rounded >= 1000 && i > 0) return `${Math.round((n / UNITS[i - 1][1]) * 10) / 10}${UNITS[i - 1][0]}`;
    return `${rounded}${suffix}`;
  }
  return String(n);
}

const DAY_MS = 86_400_000;

/** "CP updated N days ago" (whole days elapsed since `iso`). */
export function cpUpdatedLabel(iso: string, now: number = Date.now()): string {
  const days = Math.max(0, Math.floor((now - new Date(iso).getTime()) / DAY_MS));
  if (days === 0) return 'CP updated today';
  return `CP updated ${days} ${days === 1 ? 'day' : 'days'} ago`;
}
