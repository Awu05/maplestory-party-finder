import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export type ImageExt = 'png' | 'jpg' | 'webp';

export interface Storage {
  save(buf: Buffer, ext: ImageExt): Promise<string>;
  read(key: string): Promise<{ buf: Buffer; contentType: string } | null>;
  remove(key: string): Promise<void>;
  publicUrl(key: string): string;
}

const KEY_RE = /^[a-f0-9]{24}\.(png|jpg|webp)$/;
const CONTENT_TYPES: Record<ImageExt, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

export class LocalDiskStorage implements Storage {
  constructor(private readonly dir: string) {}

  async save(buf: Buffer, ext: ImageExt): Promise<string> {
    const key = `${randomBytes(12).toString('hex')}.${ext}`;
    await fs.mkdir(this.dir, { recursive: true });
    await fs.writeFile(path.join(this.dir, key), buf);
    return key;
  }

  async read(key: string): Promise<{ buf: Buffer; contentType: string } | null> {
    if (!KEY_RE.test(key)) return null;
    try {
      const buf = await fs.readFile(path.join(this.dir, key));
      return { buf, contentType: CONTENT_TYPES[key.split('.')[1] as ImageExt] };
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null;
      throw err;
    }
  }

  async remove(key: string): Promise<void> {
    if (!KEY_RE.test(key)) return;
    await fs.rm(path.join(this.dir, key), { force: true });
  }

  publicUrl(key: string): string {
    return `/uploads/${key}`;
  }
}
