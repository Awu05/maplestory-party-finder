import fs from 'node:fs';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { sniffImageType, readImageUpload } from '../src/storage/imageType.js';
import { buildTestApp } from './helpers.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==',
  'base64',
);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([0x1a, 0, 0, 0]),
  Buffer.from('WEBPVP8L'),
  Buffer.from([0x0d, 0, 0, 0, 0x2f, 0, 0, 0, 0x10, 0x07, 0x10, 0x11, 0x11, 0x88, 0x88, 0xfe, 0x07, 0]),
]);

describe('sniffImageType', () => {
  it('detects png, jpg, webp and rejects others', () => {
    expect(sniffImageType(PNG)).toBe('png');
    expect(sniffImageType(JPG)).toBe('jpg');
    expect(sniffImageType(WEBP)).toBe('webp');
    expect(sniffImageType(Buffer.from('hello'))).toBeNull();
    expect(sniffImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe('LocalDiskStorage', () => {
  it('round-trips and rejects traversal keys', async () => {
    const { storage } = await buildTestApp();
    const key = await storage.save(PNG, 'png');
    expect(key).toMatch(/^[a-f0-9]{24}\.png$/);
    expect(storage.publicUrl(key)).toBe(`/uploads/${key}`);
    const got = await storage.read(key);
    expect(got?.contentType).toBe('image/png');
    expect(got?.buf.equals(PNG)).toBe(true);
    expect(await storage.read('../etc/passwd')).toBeNull();
    await expect(storage.remove('../etc/passwd')).resolves.toBeUndefined();
    await storage.remove(key);
    expect(await storage.read(key)).toBeNull();
  });
});

function multipartBody(filename: string, content: Buffer) {
  const boundary = '----pfboundary';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

async function uploadApp() {
  const ctx = await buildTestApp();
  ctx.app.post('/api/_test/upload', async (req) => {
    const { buf, ext } = await readImageUpload(req);
    return { key: await ctx.storage.save(buf, ext) };
  });
  return ctx;
}

describe('upload validation', () => {
  it('rejects non-image content named .png', async () => {
    const { app, uploadDir } = await uploadApp();
    const { body, headers } = multipartBody('x.png', Buffer.from('this is text'));
    const res = await app.inject({ method: 'POST', url: '/api/_test/upload', payload: body, headers });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('UNSUPPORTED_IMAGE');
    expect(fs.readdirSync(uploadDir)).toEqual([]);
  });

  it('rejects files over 5 MB', async () => {
    const { app, uploadDir } = await uploadApp();
    const big = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]);
    const { body, headers } = multipartBody('x.png', big);
    const res = await app.inject({ method: 'POST', url: '/api/_test/upload', payload: body, headers });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('FILE_TOO_LARGE');
    expect(fs.readdirSync(uploadDir)).toEqual([]);
  });

  it('returns NO_FILE when there is no file part and accepts a valid image', async () => {
    const { app, uploadDir } = await uploadApp();
    const b = '----pfboundary';
    const none = Buffer.from(`--${b}\r\nContent-Disposition: form-data; name="note"\r\n\r\nhi\r\n--${b}--\r\n`);
    const r1 = await app.inject({
      method: 'POST',
      url: '/api/_test/upload',
      payload: none,
      headers: { 'content-type': `multipart/form-data; boundary=${b}` },
    });
    expect(r1.json().error.code).toBe('NO_FILE');
    const ok = multipartBody('x.png', PNG);
    const r2 = await app.inject({ method: 'POST', url: '/api/_test/upload', payload: ok.body, headers: ok.headers });
    expect(r2.statusCode).toBe(200);
    const key = r2.json().key as string;
    expect(fs.readdirSync(uploadDir)).toEqual([key]);
    const served = await app.inject({ method: 'GET', url: `/uploads/${key}` });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/webp');
    expect(served.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    expect((await app.inject({ method: 'GET', url: '/uploads/nope.png' })).statusCode).toBe(404);
  });
});

/** A PNG whose header claims `w`×`h` pixels, with almost no pixel data: a decompression-bomb shape. */
function pngClaiming(w: number, h: number): Buffer {
  const buf = Buffer.from(PNG);
  // IHDR data starts at byte 16 (8 signature + 4 length + 4 type); its CRC covers type + data.
  buf.writeUInt32BE(w, 16);
  buf.writeUInt32BE(h, 20);
  buf.writeUInt32BE(crc32(buf.subarray(12, 29)), 29);
  return buf;
}

describe('upload sanitizing', () => {
  const upload = async (content: Buffer, name = 'x.png') => {
    const ctx = await uploadApp();
    const { body, headers } = multipartBody(name, content);
    const res = await ctx.app.inject({ method: 'POST', url: '/api/_test/upload', payload: body, headers });
    return { ...ctx, res };
  };
  const stored = (uploadDir: string, key: string) => fs.readFileSync(path.join(uploadDir, key));

  it('re-encodes a valid image as a fresh WebP', async () => {
    const { res, uploadDir } = await upload(PNG);
    expect(res.statusCode).toBe(200);
    const key = res.json().key as string;
    expect(key).toMatch(/\.webp$/);
    expect((await sharp(stored(uploadDir, key)).metadata()).format).toBe('webp');
  });

  it('drops anything hidden after or inside the image', async () => {
    const payload = '<script>alert(1)</script>PK\x03\x04MZ-hidden-payload';
    const { res, uploadDir } = await upload(Buffer.concat([PNG, Buffer.from(payload)]));
    expect(res.statusCode).toBe(200);
    const file = stored(uploadDir, res.json().key);
    expect(file.includes('hidden-payload')).toBe(false);
    expect(file.includes('<script>')).toBe(false);
  });

  it('strips metadata such as EXIF', async () => {
    const jpeg = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#336' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'secret-gps-owner' } })
      .toBuffer();
    expect(jpeg.includes('secret-gps-owner')).toBe(true);
    const { res, uploadDir } = await upload(jpeg, 'x.jpg');
    expect(res.statusCode).toBe(200);
    expect(stored(uploadDir, res.json().key).includes('secret-gps-owner')).toBe(false);
  });

  it('rejects an image claiming an enormous size without decoding it', async () => {
    const { res, uploadDir } = await upload(pngClaiming(60_000, 60_000));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('UNSUPPORTED_IMAGE');
    expect(fs.readdirSync(uploadDir)).toEqual([]);
  });

  it('rejects a truncated or corrupt image', async () => {
    const { res, uploadDir } = await upload(PNG.subarray(0, 40));
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('UNSUPPORTED_IMAGE');
    expect(fs.readdirSync(uploadDir)).toEqual([]);
  });

  it('shrinks very large screenshots to fit 2560px', async () => {
    const big = await sharp({ create: { width: 4000, height: 1000, channels: 3, background: '#123' } }).png().toBuffer();
    const { res, uploadDir } = await upload(big);
    expect(res.statusCode).toBe(200);
    const meta = await sharp(stored(uploadDir, res.json().key)).metadata();
    expect(meta.width).toBe(2560);
    expect(meta.height).toBe(640);
  });
});
