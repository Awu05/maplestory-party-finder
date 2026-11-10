// DST-safe time-zone helpers. Never touches the host's local time zone:
// all zone math goes through Intl with an explicit timeZone, all calendar math through UTC methods.

export type WallTime = { year: number; month: number; day: number; hour: number };

const HOUR_MS = 3_600_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(zone, f);
  }
  return f;
}

function parts(ms: number, zone: string) {
  const out: Record<string, number> = {};
  for (const p of formatter(zone).formatToParts(new Date(ms))) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  return out as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Zone offset from UTC in ms at the given instant (wall-as-UTC minus instant). */
function offsetMs(ms: number, zone: string): number {
  const p = parts(ms, zone);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - Math.floor(ms / 1000) * 1000;
}

export function isValidTimeZone(zone: string): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function instantToZoned(date: Date, zone: string): WallTime & { dayOfWeek: number } {
  const p = parts(date.getTime(), zone);
  const dayOfWeek = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, dayOfWeek };
}

/**
 * Wall time in a zone to an instant. Spring-forward gap: the next valid hour.
 * Fall-back overlap: the first occurrence.
 */
export function zonedToInstant(wall: WallTime, zone: string): Date {
  const target = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour);
  const offsets = new Set([offsetMs(target - 24 * HOUR_MS, zone), offsetMs(target + 24 * HOUR_MS, zone)]);
  const candidates = [...offsets].map((o) => target - o);
  const matching = candidates.filter((t) => offsetMs(t, zone) === target - t);
  if (matching.length > 0) return new Date(Math.min(...matching));
  // Gap: wall time does not exist; the later candidate is the next valid hour.
  return new Date(Math.max(...candidates));
}

export function freeSlotsForViewer(freeTimes: number[], posterZone: string, viewerZone: string, now: Date): number[] {
  const unique = [...new Set(freeTimes)].sort((a, b) => a - b);
  if (posterZone === viewerZone) return unique;
  const z = instantToZoned(now, posterZone);
  const sundayUtc = Date.UTC(z.year, z.month - 1, z.day - z.dayOfWeek);
  const out = new Set<number>();
  for (const slot of unique) {
    const w = new Date(sundayUtc + slot * HOUR_MS);
    const instant = zonedToInstant(
      { year: w.getUTCFullYear(), month: w.getUTCMonth() + 1, day: w.getUTCDate(), hour: w.getUTCHours() },
      posterZone,
    );
    const v = instantToZoned(instant, viewerZone);
    out.add(v.dayOfWeek * 24 + v.hour);
  }
  return [...out].sort((a, b) => a - b);
}

/** Slots in a spring-forward gap are skipped to the next week where the hour exists. */
export function nextOccurrence(hourOfWeek: number, zone: string, now: Date): Date {
  const nowMs = now.getTime();
  const p = parts(nowMs, zone);
  const start = nowMs - (((p.minute * 60 + p.second) * 1000) + (((nowMs % 1000) + 1000) % 1000));
  for (let i = 0; i <= 24 * 14; i++) {
    const t = start + i * HOUR_MS;
    const z = instantToZoned(new Date(t), zone);
    if (z.dayOfWeek * 24 + z.hour === hourOfWeek) return new Date(t);
  }
  throw new Error(`No occurrence of hour-of-week ${hourOfWeek} in ${zone}`);
}
