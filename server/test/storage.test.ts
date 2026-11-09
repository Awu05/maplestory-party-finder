import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { sniffImageType, readImageUpload } from '../src/storage/imageType.js';
import { LocalDiskStorage } from '../src/storage/storage.js';
import { buildTestApp } from './helpers.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
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
    expect(served.headers['content-type']).toBe('image/png');
    expect(served.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect((await app.inject({ method: 'GET', url: '/uploads/nope.png' })).statusCode).toBe(404);
  });
});
