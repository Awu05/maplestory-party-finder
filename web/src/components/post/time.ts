import { OVERLAP_WINDOW_MS } from '@pf/shared';

export interface WhenOptions {
  locale?: string;
  timeZone?: string;
}

/** "Flexible", or local "Tue, Nov 10, 8:00 PM" plus " (in 3h)" when within the next 24h. */
export function formatWhen(scheduledAt: string | null, now: Date = new Date(), opts: WhenOptions = {}): string {
  if (scheduledAt === null) return 'Flexible';
  const d = new Date(scheduledAt);
  const text = new Intl.DateTimeFormat(opts.locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: opts.timeZone,
  }).format(d);
  const diff = d.getTime() - now.getTime();
  if (diff > 0 && diff <= 24 * 3600_000) {
    const mins = Math.round(diff / 60_000);
    const rel = mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;
    return `${text} (in ${rel})`;
  }
  return text;
}

/** Converts a datetime-local value (browser local time) to a UTC ISO string. */
export function localInputToUtcIso(value: string): string {
  return new Date(value).toISOString();
}

export function overlaps(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) < OVERLAP_WINDOW_MS;
}
