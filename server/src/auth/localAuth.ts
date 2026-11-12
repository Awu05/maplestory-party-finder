import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../http/errors.js';
import { SlidingWindowLimiter } from '../http/slidingWindowLimiter.js';
import { getViewer } from './guards.js';

const name = z.string().transform((value) => value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()).pipe(z.string().min(1).max(50));
/**
 * A typed Discord username. Any leading @ signs and the spaces around them are dropped, then it must
 * follow Discord's own rule: 2 to 32 letters, digits, dots or underscores. Nothing else is accepted, so
 * a lookalike ("@ name", a Cyrillic letter, an invisible character) can't sit next to the real name.
 */
export const discordUsernameField = z
  .string()
  // Invisible characters picked up when pasting (zero-width spaces and the like) are removed, not kept.
  .transform((value) => value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim().replace(/^(?:@\s*)+/, '').trim())
  .pipe(z.string().regex(/^[A-Za-z0-9_.]{2,32}$/, 'Enter a Discord username: 2 to 32 letters, numbers, dots or underscores.'));
export const signupBody = z.object({ discordUsername: discordUsernameField, displayName: name }).strict();

export interface AttemptLimiterOptions {
  windowMs?: number;
  /** Most keys tracked at once; past this the least recently used key is forgotten. */
  maxKeys?: number;
  now?: () => number;
}

/** Sign-in attempt limit: `limit` attempts per key per 10 minutes by default. */
export class AttemptLimiter extends SlidingWindowLimiter {
  constructor(limit: number, options: AttemptLimiterOptions = {}) {
    super({
      limit, windowMs: options.windowMs ?? 10 * 60_000, maxKeys: options.maxKeys ?? 5000, now: options.now,
      error: () => new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many sign-in attempts. Please try again in 10 minutes.'),
    });
  }

  /** Records an attempt, or throws 429 TOO_MANY_ATTEMPTS when `key` is over the limit. */
  check(key: string): void {
    this.take(key);
  }
}

export function createAuthRequestGuard(api: FastifyInstance, limit = 60, allowAuthenticated = false): (req: FastifyRequest) => Promise<void> {
  const origin = new URL(api.deps.config.webOrigin);
  const attempts = new AttemptLimiter(limit);
  return async (req) => {
    if (req.headers.origin !== origin.origin) throw new AppError(403, 'FORBIDDEN', 'Sign in from the Party Finder website.');
    if (req.session.get('userId')) {
      const viewer = await getViewer(req);
      if (!viewer) req.session.regenerate();
      else if (!allowAuthenticated) throw new AppError(409, 'ALREADY_LOGGED_IN', 'Log out before signing in to another account.');
    }
    if (origin.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)) {
      throw new AppError(503, 'AUTH_UNAVAILABLE', 'Sign-in requires an HTTPS connection.');
    }
    attempts.check(req.ip);
  };
}
