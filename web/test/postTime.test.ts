import { describe, expect, it } from 'vitest';
import { formatWhen, localInputToUtcIso, overlaps, utcIsoToLocalInput } from '../src/components/post/time';

describe('post time helpers', () => {
  it('formatWhen(null) is Flexible', () => {
    expect(formatWhen(null)).toBe('Flexible');
  });

  it('formatWhen renders a weekday/date/time in the given zone', () => {
    const opts = { locale: 'en-US', timeZone: 'UTC' };
    const now = new Date('2026-11-01T00:00:00Z');
    expect(formatWhen('2026-11-10T20:00:00Z', now, opts)).toBe('Tue, Nov 10, 8:00 PM');
  });

  it('formatWhen adds a relative hint within 24h only', () => {
    const opts = { locale: 'en-US', timeZone: 'UTC' };
    const now = new Date('2026-11-10T17:00:00Z');
    expect(formatWhen('2026-11-10T20:00:00Z', now, opts)).toBe('Tue, Nov 10, 8:00 PM (in 3h)');
    expect(formatWhen('2026-11-12T20:00:00Z', now, opts)).toBe('Thu, Nov 12, 8:00 PM');
  });

  it('localInputToUtcIso treats the value as local time', () => {
    expect(localInputToUtcIso('2026-11-10T20:00')).toBe(new Date(2026, 10, 10, 20, 0).toISOString());
  });

  it('utcIsoToLocalInput round-trips with localInputToUtcIso', () => {
    expect(utcIsoToLocalInput(localInputToUtcIso('2026-11-10T20:00'))).toBe('2026-11-10T20:00');
    expect(utcIsoToLocalInput(localInputToUtcIso('2026-01-02T03:04'))).toBe('2026-01-02T03:04');
  });

  it('overlaps is true under 3h apart, false at 3h, false with a null', () => {
    const base = '2026-11-10T20:00:00Z';
    expect(overlaps(base, '2026-11-10T22:59:00Z')).toBe(true);
    expect(overlaps('2026-11-10T22:59:00Z', base)).toBe(true);
    expect(overlaps(base, '2026-11-10T23:00:00Z')).toBe(false);
    expect(overlaps(null, base)).toBe(false);
    expect(overlaps(base, null)).toBe(false);
  });
});
