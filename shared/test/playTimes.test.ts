import { describe, expect, it } from 'vitest';
import { localHoursToUtcHours, utcHoursToLocalHours } from '../src/playTimes';

describe('play time conversion', () => {
  it('converts local to UTC (UTC-5)', () => {
    expect(localHoursToUtcHours([{ day: 0, hour: 20 }, { day: 0, hour: 21 }], 300)).toEqual([25, 26]);
  });
  it('wraps around the week', () => {
    expect(localHoursToUtcHours([{ day: 6, hour: 23 }], 300)).toEqual([4]);
    expect(localHoursToUtcHours([{ day: 0, hour: 1 }], -540)).toEqual([160]);
  });
  it('sorts and dedupes', () => {
    expect(localHoursToUtcHours([{ day: 1, hour: 0 }, { day: 0, hour: 0 }, { day: 1, hour: 0 }], 0)).toEqual([0, 24]);
  });
  it('floors half-hour offsets', () => {
    expect(localHoursToUtcHours([{ day: 0, hour: 10 }], -330)).toEqual([4]);
  });
  it('converts UTC to local', () => {
    expect(utcHoursToLocalHours([25], 300)).toEqual([{ day: 0, hour: 20 }]);
    expect(utcHoursToLocalHours([4, 0], 300)).toEqual([{ day: 6, hour: 19 }, { day: 6, hour: 23 }]);
  });
  it('round trips', () => {
    const b = [{ day: 3, hour: 9 }, { day: 5, hour: 0 }];
    expect(utcHoursToLocalHours(localHoursToUtcHours(b, -540), -540)).toEqual(b);
  });
});
