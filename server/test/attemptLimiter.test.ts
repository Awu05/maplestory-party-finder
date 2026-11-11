import { describe, expect, it } from 'vitest';
import { AttemptLimiter } from '../src/auth/localAuth.js';

describe('AttemptLimiter', () => {
  it('limits each key separately within the window', () => {
    let now = 0;
    const limiter = new AttemptLimiter(2, { windowMs: 1000, now: () => now });
    limiter.check('a');
    limiter.check('a');
    expect(() => limiter.check('a')).toThrow(expect.objectContaining({ status: 429, code: 'TOO_MANY_ATTEMPTS' }));
    limiter.check('b');
    now = 1001;
    expect(() => limiter.check('a')).not.toThrow();
  });

  it('evicts the least recently used key instead of rejecting new keys when full', () => {
    const now = 0;
    const limiter = new AttemptLimiter(1, { maxKeys: 3, now: () => now });
    limiter.check('a');
    limiter.check('b');
    limiter.check('c');
    // Full of keys that are all still inside the window: a new key must still be allowed.
    expect(() => limiter.check('d')).not.toThrow();
    expect(() => limiter.check('e')).not.toThrow();
    // 'a' and 'b' were the oldest, so they were evicted and start fresh.
    expect(() => limiter.check('a')).not.toThrow();
    // 'e' was used recently and is still tracked.
    expect(() => limiter.check('e')).toThrow(expect.objectContaining({ code: 'TOO_MANY_ATTEMPTS' }));
  });
});
