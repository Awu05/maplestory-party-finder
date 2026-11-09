import { describe, expect, it } from 'vitest';
import { formatCpShort } from '../src/format';

describe('formatCpShort', () => {
  it('compacts to B / M / K', () => {
    expect(formatCpShort(1_500_000_000)).toBe('1.5B');
    expect(formatCpShort(12_345_678)).toBe('12.3M');
    expect(formatCpShort(950_000)).toBe('950K');
    expect(formatCpShort(999)).toBe('999');
  });
  it('promotes rounding overflow to the next unit', () => {
    expect(formatCpShort(999_960)).toBe('1M');
    expect(formatCpShort(999_960_000)).toBe('1B');
  });
});
