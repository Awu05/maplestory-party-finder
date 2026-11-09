import { describe, expect, it } from 'vitest';
import { effectivePostStatus, maxPartySizeFor, postExpiresAt } from '../src/posts';

describe('postExpiresAt', () => {
  it('adds the grace period to scheduled posts and the TTL to flexible ones', () => {
    const t0 = new Date('2026-11-10T00:00:00Z');
    expect(postExpiresAt(t0, new Date('2026-11-09T00:00:00Z')).toISOString()).toBe('2026-11-10T03:00:00.000Z');
    expect(postExpiresAt(null, t0).toISOString()).toBe('2026-11-17T00:00:00.000Z');
  });
});

describe('effectivePostStatus', () => {
  const base = { status: 'open' as const, expiresAt: '2026-11-10T03:00:00Z', deletedAt: null };
  it('is open until expiry, then closed', () => {
    expect(effectivePostStatus(base, new Date('2026-11-10T02:59:59Z'))).toBe('open');
    expect(effectivePostStatus(base, new Date('2026-11-10T03:00:00Z'))).toBe('closed');
  });
  it('keeps full before expiry', () => {
    expect(effectivePostStatus({ ...base, status: 'full' }, new Date('2026-11-10T01:00:00Z'))).toBe('full');
  });
  it('is closed when deleted', () => {
    expect(effectivePostStatus({ ...base, deletedAt: '2026-11-09T00:00:00Z' }, new Date('2026-11-09T01:00:00Z'))).toBe('closed');
  });
});

describe('maxPartySizeFor', () => {
  it('takes the smallest cap, capped at the global max', () => {
    expect(maxPartySizeFor([6, 3, 6])).toBe(3);
    expect(maxPartySizeFor([])).toBe(6);
    expect(maxPartySizeFor([10])).toBe(6);
  });
});
