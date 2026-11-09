export type LocalHour = { day: number; hour: number };

const WEEK = 168;
const mod = (n: number) => ((n % WEEK) + WEEK) % WEEK;
// Whole-hour shift; half-hour offsets floor to the hour.
const offsetHours = (tzOffsetMinutes: number) => Math.floor(tzOffsetMinutes / 60);

export function localHoursToUtcHours(slots: LocalHour[], tzOffsetMinutes: number): number[] {
  const shift = offsetHours(tzOffsetMinutes);
  return [...new Set(slots.map((s) => mod(s.day * 24 + s.hour + shift)))].sort((a, b) => a - b);
}

export function utcHoursToLocalHours(hours: number[], tzOffsetMinutes: number): LocalHour[] {
  const shift = offsetHours(tzOffsetMinutes);
  return [...new Set(hours.map((h) => mod(h - shift)))]
    .sort((a, b) => a - b)
    .map((h) => ({ day: Math.floor(h / 24), hour: h % 24 }));
}
