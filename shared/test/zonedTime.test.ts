import { describe, expect, it } from 'vitest';
import {
  freeSlotsForViewer,
  instantToZoned,
  canonicalTimeZone,
  isValidTimeZone,
  nextOccurrence,
  zonedToInstant,
} from '../src/zonedTime';

const NY = 'America/New_York';

describe('isValidTimeZone', () => {
  it('accepts IANA zones and rejects junk', () => {
    expect(isValidTimeZone(NY)).toBe(true);
    expect(isValidTimeZone('Mars/Base')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
  });
  it('rejects UTC-offset strings that Intl accepts (Postgres AT TIME ZONE flips their sign)', () => {
    for (const z of ['+05:30', '-08:00', '+0530', '+05', '-0800']) {
      expect(isValidTimeZone(z)).toBe(false);
    }
    expect(isValidTimeZone('UTC+3')).toBe(false);
    expect(isValidTimeZone('GMT-05:00')).toBe(false);
  });
  it('keeps IANA names, including UTC and Etc/GMT zones', () => {
    for (const z of ['UTC', NY, 'Asia/Kolkata', 'Etc/GMT+3', 'America/Argentina/Buenos_Aires']) {
      expect(isValidTimeZone(z)).toBe(true);
    }
  });
});

describe('canonicalTimeZone', () => {
  it("returns Intl's canonical name", () => {
    expect(canonicalTimeZone(NY)).toBe(NY);
    expect(canonicalTimeZone('america/new_york')).toBe(NY);
    expect(canonicalTimeZone('utc')).toBe('UTC');
  });
});

describe('zonedToInstant', () => {
  it('converts an ordinary hour', () => {
    expect(zonedToInstant({ year: 2026, month: 11, day: 10, hour: 20 }, NY).toISOString()).toBe('2026-11-11T01:00:00.000Z');
  });
  it('moves a spring-forward gap hour to the next valid hour', () => {
    expect(zonedToInstant({ year: 2026, month: 3, day: 8, hour: 2 }, NY).toISOString()).toBe('2026-03-08T07:00:00.000Z');
  });
  it('picks the first occurrence in a fall-back overlap', () => {
    expect(zonedToInstant({ year: 2026, month: 11, day: 1, hour: 1 }, NY).toISOString()).toBe('2026-11-01T05:00:00.000Z');
  });
});

describe('instantToZoned', () => {
  it('reads wall time and weekday in the zone', () => {
    expect(instantToZoned(new Date('2026-11-11T01:00:00Z'), NY)).toEqual({ year: 2026, month: 11, day: 10, hour: 20, dayOfWeek: 2 });
  });
});

describe('freeSlotsForViewer', () => {
  it('shifts across zones', () => {
    expect(freeSlotsForViewer([68], NY, 'America/Los_Angeles', new Date('2026-11-10T15:00:00Z'))).toEqual([65]);
    expect(freeSlotsForViewer([68], NY, 'Asia/Kolkata', new Date('2026-11-10T15:00:00Z'))).toEqual([78]);
  });
  it('uses the DST rules of the week containing now', () => {
    expect(freeSlotsForViewer([68], NY, 'Europe/London', new Date('2026-03-05T12:00:00Z'))).toEqual([73]);
    expect(freeSlotsForViewer([68], NY, 'Europe/London', new Date('2026-03-10T12:00:00Z'))).toEqual([72]);
  });
  it('dedupes and sorts when zones are equal', () => {
    expect(freeSlotsForViewer([5, 3, 3], NY, NY, new Date('2026-11-10T15:00:00Z'))).toEqual([3, 5]);
  });
});

describe('nextOccurrence', () => {
  const now = new Date('2026-11-10T15:00:00Z');
  it('finds the next matching hour', () => {
    expect(nextOccurrence(68, NY, now).toISOString()).toBe('2026-11-11T01:00:00.000Z');
  });
  it('counts the current hour', () => {
    expect(nextOccurrence(58, NY, now).toISOString()).toBe('2026-11-10T15:00:00.000Z');
  });
  it('wraps to next week', () => {
    expect(nextOccurrence(57, NY, now).toISOString()).toBe('2026-11-17T14:00:00.000Z');
  });
  it('does not return an instant before the current hour during a repeated fall-back hour', () => {
    expect(nextOccurrence(1, NY, new Date('2026-11-01T06:30:00Z')).toISOString()).toBe('2026-11-01T06:00:00.000Z');
  });
});

describe('edge zones', () => {
  const SANTIAGO = 'America/Santiago';
  it('Santiago midnight spring-forward gap (2026-09-06 00:00 -> 01:00) gives the next valid hour', () => {
    expect(zonedToInstant({ year: 2026, month: 9, day: 6, hour: 0 }, SANTIAGO).toISOString()).toBe('2026-09-06T04:00:00.000Z');
    expect(instantToZoned(new Date('2026-09-06T04:00:00Z'), SANTIAGO)).toMatchObject({ day: 6, hour: 1 });
  });

  it('Santiago fall-back overlap (2026-04-04 23:00 twice) gives the first occurrence', () => {
    expect(zonedToInstant({ year: 2026, month: 4, day: 4, hour: 23 }, SANTIAGO).toISOString()).toBe('2026-04-05T02:00:00.000Z');
  });

  it("St John's (UTC-3:30) converts whole wall hours to half-hour instants and back", () => {
    expect(zonedToInstant({ year: 2026, month: 11, day: 10, hour: 20 }, 'America/St_Johns').toISOString()).toBe('2026-11-10T23:30:00.000Z');
    expect(instantToZoned(new Date('2026-11-11T01:00:00Z'), 'America/St_Johns')).toMatchObject({ dayOfWeek: 2, hour: 21 });
  });

  it('Lord Howe 30-minute DST gap (02:00 -> 02:30) lands on 02:30', () => {
    const t = zonedToInstant({ year: 2026, month: 10, day: 4, hour: 2 }, 'Australia/Lord_Howe');
    expect(t.toISOString()).toBe('2026-10-03T15:30:00.000Z');
    expect(instantToZoned(t, 'Australia/Lord_Howe')).toMatchObject({ day: 4, hour: 2 });
  });

  it('wraps Saturday to Sunday between zones (NY Sat 23 -> Kiritimati Sun 18, and back)', () => {
    const now = new Date('2026-11-10T15:00:00Z');
    expect(freeSlotsForViewer([6 * 24 + 23], NY, 'Pacific/Kiritimati', now)).toEqual([18]);
    expect(freeSlotsForViewer([0], 'Pacific/Kiritimati', NY, now)).toEqual([6 * 24 + 5]);
  });

  it('nextOccurrence skips the NY spring gap (Sun 2am on 2027-03-14) to the next week', () => {
    expect(nextOccurrence(2, NY, new Date('2027-03-13T12:00:00Z')).toISOString()).toBe('2027-03-21T06:00:00.000Z');
  });
});
