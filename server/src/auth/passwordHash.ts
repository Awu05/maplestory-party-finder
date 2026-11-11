import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { AppError } from '../http/errors.js';

const params = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const prefix = 'scrypt$32768$8$3';
const dummy = `${prefix}$${Buffer.alloc(16).toString('hex')}$${Buffer.alloc(64).toString('hex')}`;
/**
 * Runs at most `concurrency` jobs at once; later ones wait in arrival order. Only when `maxWaiting`
 * jobs are already waiting is a new one refused, so a short burst of sign-ins is queued, not failed.
 */
export class DerivationQueue {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly concurrency = 2, private readonly maxWaiting = 32) {}

  async run<T>(job: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      if (this.waiting.length >= this.maxWaiting) throw new AppError(429, 'AUTH_BUSY', 'Sign-in is busy. Please try again shortly.');
      // The finishing job hands its slot straight to the next waiter, so `active` stays counted.
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active++;
    }
    try {
      return await job();
    } finally {
      const next = this.waiting.shift();
      if (next) next();
      else this.active--;
    }
  }
}

const queue = new DerivationQueue();

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return queue.run(() => new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, params, (error, key) => error ? reject(error) : resolve(key));
  }));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `${prefix}$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  const valid = stored?.startsWith(`${prefix}$`) && /^scrypt\$32768\$8\$3\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(stored);
  const parts = (valid && stored ? stored : dummy).split('$');
  const key = await derive(password, Buffer.from(parts[4]!, 'hex'));
  return timingSafeEqual(key, Buffer.from(parts[5]!, 'hex')) && !!valid;
}
