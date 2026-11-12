import { afterEach, beforeEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp, loginAs, makeCharacter, prisma, resetDb } from './helpers.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==', 'base64');
const originalKey = '000000000000000000000000.webp';
let app: FastifyInstance;
let cookie: string;
let characterId: string;
let files: Set<string>;
let validate: () => Promise<void>;

beforeEach(async () => {
  await resetDb();
  files = new Set([originalKey]);
  validate = async () => {};
  let sequence = 0;
  ({ app } = await buildTestApp({
    storage: {
      save: async () => { const key = `${String(++sequence).padStart(24, '0')}.webp`; files.add(key); return key; },
      read: async () => null, remove: async (key) => { files.delete(key); }, publicUrl: (key) => `/uploads/${key}`,
    },
    scouterValidator: { validate: () => validate() },
  }));
  cookie = await loginAs(app, 'upload-owner');
  const owner = await prisma.user.findUniqueOrThrow({ where: { discordId: 'upload-owner' } });
  characterId = (await makeCharacter({ ownerId: owner.id, screenshotKey: originalKey })).id;
});
afterEach(async () => { await app.close(); });

function upload() {
  const boundary = 'upload-boundary';
  const payload = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n`), PNG, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  return app.inject({ method: 'PUT', url: `/api/characters/${characterId}/screenshot`, headers: { cookie, 'content-type': `multipart/form-data; boundary=${boundary}` }, payload });
}

it('keeps only the current file after overlapping screenshot replacements', async () => {
  let entered = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  validate = async () => { if (++entered === 2) release(); await gate; };
  const results = await Promise.all([upload(), upload()]);
  expect(results.map((response) => response.statusCode)).toEqual([200, 200]);
  const current = await prisma.character.findUniqueOrThrow({ where: { id: characterId } });
  expect([...files]).toEqual([current.screenshotKey]);
});

it('removes a newly uploaded file if the character is deleted during validation', async () => {
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  validate = async () => { entered(); await gate; };
  const pending = upload().then((result) => result);
  await started;
  try {
    expect((await app.inject({ method: 'DELETE', url: `/api/characters/${characterId}`, headers: { cookie } })).statusCode).toBe(204);
  } finally { release(); }
  expect((await pending).statusCode).toBe(404);
  expect(files.size).toBe(0);
});
