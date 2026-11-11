import { describe, expect, it } from 'vitest';
import { SlidingWindowLimiter } from '../src/http/slidingWindowLimiter.js';

const limiter = (over: { limit?: number; maxKeys?: number } = {}, clock = { now: 0 }) => new SlidingWindowLimiter({
  limit: over.limit ?? 2, windowMs: 1000, maxKeys: over.maxKeys ?? 100,
  error: () => new Error('limited'), now: () => clock.now,
});

describe('SlidingWindowLimiter', () => {
  it('take records attempts and throws the configured error past the limit', () => {
    const clock = { now: 0 };
    const l = limiter({}, clock);
    l.take('a');
    l.take('a');
    expect(() => l.take('a')).toThrow('limited');
    clock.now = 1000;
    expect(() => l.take('a')).not.toThrow();
  });

  it('can check without recording and record separately', () => {
    const l = limiter();
    expect(l.isLimited('a')).toBe(false);
    expect(l.isLimited('a')).toBe(false);
    l.record('a');
    l.record('a');
    expect(l.isLimited('a')).toBe(true);
    expect(l.isLimited('b')).toBe(false);
  });

  it('tryTake reports instead of throwing', () => {
    const l = limiter({ limit: 1 });
    expect(l.tryTake('a')).toBe(true);
    expect(l.tryTake('a')).toBe(false);
    expect(l.tryTake('b')).toBe(true);
  });

  it('evicts the least recently used keys when full', () => {
    const l = limiter({ limit: 1, maxKeys: 2 });
    l.take('a');
    l.take('b');
    l.take('c');
    expect(l.isLimited('a')).toBe(false);
    expect(l.isLimited('b')).toBe(true);
    expect(l.isLimited('c')).toBe(true);
  });
});
