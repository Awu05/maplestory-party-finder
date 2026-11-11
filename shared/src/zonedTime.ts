// DST-safe time-zone helpers. Never touches the host's local time zone:
// all zone math goes through Intl with an explicit timeZone, all calendar math through UTC methods.

export type WallTime = { year: number; month: number; day: number; hour: number; minute?: number };

const HOUR_MS = 3_600_000;
export const SLOTS_PER_DAY = 48;
export const SLOT_MINUTES = 30;
const SLOT_MS = SLOT_MINUTES * 60_000;
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

/** IANA-style names only: a leading letter, then letters, digits, `_`, `+`, `-` and `/` (e.g. Etc/GMT+3). */
const IANA_NAME = /^[A-Za-z][A-Za-z0-9_+\-/]*$/;

/**
 * True for an IANA zone name Intl knows. Rejects UTC-offset strings like `+05:30` that Intl
 * accepts: Postgres reads those with POSIX semantics (sign flipped) in AT TIME ZONE.
 */
export function isValidTimeZone(zone: string): boolean {
  if (!IANA_NAME.test(zone)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** Intl's canonical spelling of a valid zone, e.g. `america/new_york` -> `America/New_York`. */
export function canonicalTimeZone(zone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
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
  const target = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute ?? 0);
  const offsets = new Set([offsetMs(target - 24 * HOUR_MS, zone), offsetMs(target + 24 * HOUR_MS, zone)]);
  const candidates = [...offsets].map((o) => target - o);
  const matching = candidates.filter((t) => offsetMs(t, zone) === target - t);
  if (matching.length > 0) return new Date(Math.min(...matching));
  // Gap: wall time does not exist; the later candidate is the next valid hour.
  return new Date(Math.max(...candidates));
}

/**
 * Returns a two-bit mask per viewer slot: bit 1 is its first 15 minutes and bit 2 its last.
 * Quarter-hour zone offsets can place a source half-hour across two viewer slots.
 */
export function freeSlotCoverageForViewer(freeTimes: number[], posterZone: string, viewerZone: string, now: Date): Map<number, number> {
  const unique = [...new Set(freeTimes)].sort((a, b) => a - b);
  // Anchor each participant's occurrences to the same UTC week. Source-zone calendar
  // weeks alone can straddle different sides of a DST change near the date line.
  const weekStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - now.getUTCDay());
  if (posterZone === viewerZone && offsetMs(weekStart, posterZone) === offsetMs(weekStart + 7 * 24 * HOUR_MS, posterZone)) {
    return new Map(unique.map((slot) => [slot, 3]));
  }
  const sourceAtStart = instantToZoned(new Date(weekStart), posterZone);
  const sourceSunday = Date.UTC(sourceAtStart.year, sourceAtStart.month - 1, sourceAtStart.day - sourceAtStart.dayOfWeek);
  const out = new Map<number, number>();
  for (const slot of unique) {
    const toInstant = (wallMs: number) => {
      const w = new Date(wallMs);
      return zonedToInstant({ year: w.getUTCFullYear(), month: w.getUTCMonth() + 1, day: w.getUTCDate(), hour: w.getUTCHours(), minute: w.getUTCMinutes() }, posterZone);
    };
    let wall = sourceSunday + slot * SLOT_MS;
    let instant = toInstant(wall);
    if (instant.getTime() < weekStart) {
      wall += 7 * 24 * HOUR_MS;
      instant = toInstant(wall);
    }
    // A wall time in a spring-forward gap never occurred in this week.
    const expected = new Date(wall);
    const actual = parts(instant.getTime(), posterZone);
    if (actual.year !== expected.getUTCFullYear() || actual.month !== expected.getUTCMonth() + 1 ||
      actual.day !== expected.getUTCDate() || actual.hour !== expected.getUTCHours() || actual.minute !== expected.getUTCMinutes()) continue;
    for (const quarter of [0, 15]) {
      const v = parts(instant.getTime() + quarter * 60_000, viewerZone);
      const day = new Date(Date.UTC(v.year, v.month - 1, v.day)).getUTCDay();
      const slot = day * SLOTS_PER_DAY + v.hour * 2 + Math.floor(v.minute / SLOT_MINUTES);
      const mask = v.minute % SLOT_MINUTES < 15 ? 1 : 2;
      out.set(slot, (out.get(slot) ?? 0) | mask);
    }
  }
  return out;
}

/** Viewer slots fully covered by the source availability. */
export function freeSlotsForViewer(freeTimes: number[], posterZone: string, viewerZone: string, now: Date): number[] {
  if (posterZone === viewerZone) return [...new Set(freeTimes)].sort((a, b) => a - b);
  return [...freeSlotCoverageForViewer(freeTimes, posterZone, viewerZone, now)]
    .filter(([, mask]) => mask === 3).map(([slot]) => slot).sort((a, b) => a - b);
}

/** Slots in a spring-forward gap are skipped to the next week where the time exists. */
export function nextOccurrence(slotOfWeek: number, zone: string, now: Date): Date {
  const nowMs = now.getTime();
  const p = parts(nowMs, zone);
  const start = nowMs - ((((p.minute % SLOT_MINUTES) * 60 + p.second) * 1000) + (((nowMs % 1000) + 1000) % 1000));
  for (let i = 0; i <= SLOTS_PER_DAY * 14; i++) {
    const t = start + i * SLOT_MS;
    const z = instantToZoned(new Date(t), zone);
    const minute = parts(t, zone).minute;
    if (z.dayOfWeek * SLOTS_PER_DAY + z.hour * 2 + Math.floor(minute / SLOT_MINUTES) === slotOfWeek) return new Date(t);
  }
  throw new Error(`No occurrence of half-hour slot ${slotOfWeek} in ${zone}`);
}
