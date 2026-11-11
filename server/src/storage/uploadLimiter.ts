import { AppError } from '../http/errors.js';

export const UPLOADS_PER_WINDOW = 10;
export const UPLOAD_WINDOW_MS = 10 * 60_000;

/**
 * Per-user sliding-window limit on uploads, kept in memory. It resets on restart, which is fine:
 * it exists to stop someone hammering the image decoder or filling the disk, not for accounting.
 */
export class UploadLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly limit = UPLOADS_PER_WINDOW,
    private readonly windowMs = UPLOAD_WINDOW_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records an upload attempt for `userId`, or throws 429 when the user is over the limit. */
  take(userId: string): void {
    const t = this.now();
    const recent = (this.hits.get(userId) ?? []).filter((at) => t - at < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(userId, recent);
      throw new AppError(429, 'TOO_MANY_UPLOADS', "You're uploading too often. Try again in a few minutes.");
    }
    recent.push(t);
    this.hits.set(userId, recent);
    // Drop users with no recent uploads so the map can't grow without bound.
    if (this.hits.size > 1000) {
      for (const [id, times] of this.hits) if (times.every((at) => t - at >= this.windowMs)) this.hits.delete(id);
    }
  }
}
