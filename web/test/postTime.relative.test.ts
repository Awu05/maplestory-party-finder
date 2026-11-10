import { relativeTime } from '../src/components/post/time';

describe('relativeTime', () => {
  const now = new Date('2026-11-09T12:00:00Z');
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  it.each([
    [30_000, 'just now'],
    [5 * 60_000, '5m ago'],
    [3 * 3600_000, '3h ago'],
    [2 * 86_400_000, '2d ago'],
  ])('%i ms -> %s', (ms, text) => {
    expect(relativeTime(ago(ms), now)).toBe(text);
  });
});
