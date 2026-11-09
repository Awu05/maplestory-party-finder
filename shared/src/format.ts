const UNITS: [suffix: string, value: number][] = [
  ['B', 1e9],
  ['M', 1e6],
  ['K', 1e3],
];

/** Compact combat power: 1_500_000_000 → '1.5B', 12_345_678 → '12.3M', 950_000 → '950K', 999 → '999'. */
export function formatCpShort(n: number): string {
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
