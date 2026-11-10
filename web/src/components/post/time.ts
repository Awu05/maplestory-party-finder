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

/** Inverse of localInputToUtcIso: a UTC ISO string to a datetime-local value in browser local time. */
export function utcIsoToLocalInput(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function overlaps(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) < OVERLAP_WINDOW_MS;
}

/** "just now", "5m ago", "3h ago", "2d ago". */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const mins = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
