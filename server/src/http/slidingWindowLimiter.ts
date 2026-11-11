export interface SlidingWindowLimiterOptions {
  /** Attempts allowed per key within the window. */
  limit: number;
  windowMs: number;
  /** Most keys tracked at once; past this the least recently used keys are forgotten (never rejected). */
  maxKeys: number;
  /** Error thrown by `take` when a key is over the limit. */
  error: () => Error;
  now?: () => number;
}

/**
 * Per-key sliding-window limit kept in memory. It resets on restart, which is fine: it exists to slow
 * down abuse, not for accounting.
 */
export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();
  private readonly now: () => number;

  constructor(private readonly options: SlidingWindowLimiterOptions) {
    this.now = options.now ?? Date.now;
  }

  private recent(key: string, now: number): number[] {
    const cutoff = now - this.options.windowMs;
    return (this.hits.get(key) ?? []).filter((at) => at > cutoff);
  }

  /** True when `key` has used its attempts in the current window. Records nothing. */
  isLimited(key: string): boolean {
    return this.recent(key, this.now()).length >= this.options.limit;
  }

  /** Records an attempt for `key` (whether or not it is over the limit). */
  record(key: string): void {
    const now = this.now();
    const recent = this.recent(key, now);
    recent.push(now);
    // Re-insert so the map stays ordered from least to most recently used.
    this.hits.delete(key);
    this.hits.set(key, recent);
    this.evict(now);
  }

  /** Records an attempt and returns true, or returns false (recording nothing) when over the limit. */
  tryTake(key: string): boolean {
    if (this.isLimited(key)) return false;
    this.record(key);
    return true;
  }

  /** Records an attempt, or throws the configured error when `key` is over the limit. */
  take(key: string): void {
    if (!this.tryTake(key)) throw this.options.error();
  }

  private evict(now: number): void {
    if (this.hits.size <= this.options.maxKeys) return;
    const cutoff = now - this.options.windowMs;
    for (const [key, times] of this.hits) if (times.every((at) => at <= cutoff)) this.hits.delete(key);
    // Never turn new keys away because the map is full: forget the least recently used ones instead.
    for (const key of this.hits.keys()) {
      if (this.hits.size <= this.options.maxKeys) break;
      this.hits.delete(key);
    }
  }
}
