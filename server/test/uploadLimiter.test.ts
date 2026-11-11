import { describe, expect, it } from 'vitest';
import { UploadLimiter } from '../src/storage/uploadLimiter.js';

describe('UploadLimiter', () => {
  it('allows `limit` uploads per window per user, then frees up as old ones age out', () => {
    let now = 0;
    const limiter = new UploadLimiter(2, 1000, () => now);
    limiter.take('a');
    limiter.take('a');
    expect(() => limiter.take('a')).toThrow(expect.objectContaining({ code: 'TOO_MANY_UPLOADS' }));
    limiter.take('b');
    now = 1000;
    expect(() => limiter.take('a')).not.toThrow();
  });
});
