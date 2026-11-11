import { AppError } from '../http/errors.js';
import { SlidingWindowLimiter } from '../http/slidingWindowLimiter.js';

export const UPLOADS_PER_WINDOW = 10;
export const UPLOAD_WINDOW_MS = 10 * 60_000;

/**
 * Per-user limit on uploads. It exists to stop someone hammering the image decoder or filling the
 * disk, not for accounting.
 */
export class UploadLimiter extends SlidingWindowLimiter {
  constructor(limit = UPLOADS_PER_WINDOW, windowMs = UPLOAD_WINDOW_MS, now: () => number = Date.now) {
    super({
      limit, windowMs, now, maxKeys: 10_000,
      error: () => new AppError(429, 'TOO_MANY_UPLOADS', "You're uploading too often. Try again in a few minutes."),
    });
  }
}
