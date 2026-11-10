import { describe, expect, it } from 'vitest';
import {
  freeSlotsForViewer,
  instantToZoned,
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
});
