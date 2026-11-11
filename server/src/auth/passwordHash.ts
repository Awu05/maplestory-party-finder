import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { AppError } from '../http/errors.js';

const params = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
const prefix = 'scrypt$32768$8$3';
const dummy = `${prefix}$${Buffer.alloc(16).toString('hex')}$${Buffer.alloc(64).toString('hex')}`;
let active = 0;

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  if (active >= 2) throw new AppError(429, 'AUTH_BUSY', 'Sign-in is busy. Please try again shortly.');
  active++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, params, (error, key) => error ? reject(error) : resolve(key));
    });
  } finally { active--; }
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
