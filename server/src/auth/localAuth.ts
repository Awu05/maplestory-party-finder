import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../http/errors.js';
import { getViewer } from './guards.js';

const name = z.string().transform((value) => value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()).pipe(z.string().min(1).max(50));
export const signupBody = z.object({ discordUsername: name.transform((value) => value.replace(/^@/, '')).pipe(z.string().min(1)), displayName: name }).strict();

export interface AttemptLimiterOptions {
  windowMs?: number;
  /** Most keys tracked at once; past this the least recently used key is forgotten. */
  maxKeys?: number;
  now?: () => number;
}

export class AttemptLimiter {
  private readonly attempts = new Map<string, number[]>();
  private readonly windowMs: number;
  private readonly maxKeys: number;
  private readonly now: () => number;

  constructor(private readonly limit: number, options: AttemptLimiterOptions = {}) {
    this.windowMs = options.windowMs ?? 10 * 60_000;
    this.maxKeys = options.maxKeys ?? 5000;
    this.now = options.now ?? Date.now;
  }

  check(key: string): void {
    const now = this.now();
    const cutoff = now - this.windowMs;
    const recent = (this.attempts.get(key) ?? []).filter((time) => time > cutoff);
    if (recent.length >= this.limit) throw this.tooMany();
    // Re-insert so the map stays ordered from least to most recently used.
    this.attempts.delete(key);
    this.attempts.set(key, [...recent, now]);
    if (this.attempts.size > this.maxKeys) {
      for (const [id, times] of this.attempts) if (times.every((time) => time <= cutoff)) this.attempts.delete(id);
      // Never reject a new key because the map is full: forget the least recently used ones instead.
      for (const id of this.attempts.keys()) {
        if (this.attempts.size <= this.maxKeys) break;
        this.attempts.delete(id);
      }
    }
  }

  private tooMany() { return new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many sign-in attempts. Please try again in 10 minutes.'); }
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
