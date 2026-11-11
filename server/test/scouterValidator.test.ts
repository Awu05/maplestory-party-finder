import fs from 'node:fs';
import sharp from 'sharp';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppError } from '../src/http/errors.js';
import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { isScouterText, LocalScouterValidator, OcrWorker, SCOUTER_MAX_WAIT_MS, SCOUTER_MAX_WAITING } from '../src/storage/scouterValidator.js';
import { buildTestApp, loginAs, makeCharacter, prisma, resetDb } from './helpers.js';

const SCOUTER_TEXT = 'Lv.289 Lynn Combat Power ITEM STAT HEXA STAT Boss Clear (Cut) Scouter Graph Stat Efficiency Party-able Impossible';
const image = () => sharp({ create: { width: 815, height: 835, channels: 3, background: 'white' } }).png().toBuffer();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

it('requires multiple independent Scouter markers', () => {
  expect(isScouterText(SCOUTER_TEXT)).toBe(true);
  expect(isScouterText('BOSS\nCLEAR (Cut)\nScouter   Graph\nCombat\nPower\nParty-able')).toBe(true);
  for (const text of ['', 'MapleStory screenshot', 'Scouter Graph', 'Boss Clear Combat Power', 'Boss Clear Scouter Graph Party-able']) {
    expect(isScouterText(text)).toBe(false);
  }
});

it('reads representative Scouter headings with the real local OCR process', async () => {
  const svg = `<svg width="815" height="835" xmlns="http://www.w3.org/2000/svg">
    <rect width="815" height="835" fill="#f3f3f3"/>
    <rect x="4" y="4" width="250" height="250" rx="12" fill="white"/>
    <rect x="266" y="4" width="545" height="827" rx="12" fill="white"/>
    <rect x="4" y="266" width="250" height="250" rx="12" fill="white"/>
    <rect x="4" y="530" width="250" height="300" rx="12" fill="white"/>
    <g fill="#111" font-family="Arial, sans-serif">
      <text x="16" y="28" font-size="16">Lv.289 Lynn</text>
      <text x="16" y="62" font-size="13">Combat Power</text>
      <text x="16" y="108" font-size="13">ITEM STAT 611,551,429</text>
      <text x="16" y="140" font-size="13">HEXA STAT 534,148,215</text>
      <text x="280" y="28" font-size="18">Boss Clear (Cut)</text>
      <text x="280" y="65" font-size="13">View all boss standards</text>
      <text x="16" y="296" font-size="18">Scouter Graph</text>
      <text x="16" y="558" font-size="18">Stat Efficiency</text>
      <text x="280" y="400" font-size="14">Impossible</text>
      <text x="430" y="400" font-size="14">Party-able</text>
      <text x="580" y="400" font-size="14">Solo Min</text>
    </g>
  </svg>`;
  const buf = await sharp(Buffer.from(svg)).png().toBuffer();
  const validator = new LocalScouterValidator();
  try {
    await expect(validator.validate(buf)).resolves.toBeUndefined();
    // The same long-lived OCR process handles the next upload too.
    await expect(validator.validate(await image())).rejects.toMatchObject({ code: 'NOT_SCOUTER' });
    await expect(validator.validate(buf)).resolves.toBeUndefined();
  } finally {
    await validator.close();
  }
}, 60_000);

it('rejects an unrelated image using real OCR', async () => {
  const validator = new LocalScouterValidator();
  try {
    await expect(validator.validate(await image())).rejects.toMatchObject({ code: 'NOT_SCOUTER' });
  } finally {
    await validator.close();
  }
}, 30_000);

/** A stand-in for the forked OCR process: says ready, then answers each job with `reply`. */
class FakeOcrChild extends EventEmitter {
  killed = false;
  jobs: { id: number }[] = [];
  constructor(private readonly behavior: { readyAfterMs?: number; reply?: (job: number) => string | null } = {}) {
    super();
    setTimeout(() => this.emit('message', { type: 'ready' }), behavior.readyAfterMs ?? 0);
  }
  send(message: { id: number; image: Buffer }, callback?: (error: Error | null) => void): boolean {
    this.jobs.push({ id: message.id });
    const text = (this.behavior.reply ?? (() => SCOUTER_TEXT))(this.jobs.length);
    if (text !== null) setImmediate(() => this.emit('message', { id: message.id, text }));
    callback?.(null);
    return true;
  }
  kill(): boolean {
    if (this.killed) return true;
    this.killed = true;
    setImmediate(() => this.emit('exit', null, 'SIGKILL'));
    return true;
  }
  crash(): void {
    this.emit('exit', 1, null);
  }
}

function fakeSpawner(behavior: ConstructorParameters<typeof FakeOcrChild>[0] = {}) {
  const children: FakeOcrChild[] = [];
  const spawn = vi.fn(() => {
    const child = new FakeOcrChild(behavior);
    children.push(child);
    return child as unknown as ChildProcess;
  });
  return { spawn, children };
}

it('starts one OCR worker lazily and reuses it for later checks', async () => {
  const { spawn, children } = fakeSpawner();
  const validator = new LocalScouterValidator({ worker: new OcrWorker({ spawn }) });
  expect(spawn).not.toHaveBeenCalled();
  const buf = await image();
  await expect(validator.validate(buf)).resolves.toBeUndefined();
  await expect(validator.validate(buf)).resolves.toBeUndefined();
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(children[0]!.jobs).toHaveLength(2);
  await validator.close();
  expect(children[0]!.killed).toBe(true);
});

it('replaces a crashed OCR worker on the next check', async () => {
  const { spawn, children } = fakeSpawner();
  const validator = new LocalScouterValidator({ worker: new OcrWorker({ spawn }) });
  const buf = await image();
  await expect(validator.validate(buf)).resolves.toBeUndefined();
  children[0]!.crash();
  await expect(validator.validate(buf)).resolves.toBeUndefined();
  expect(spawn).toHaveBeenCalledTimes(2);
  expect(children[1]!.jobs).toHaveLength(1);
  await validator.close();
});

it('logs when the OCR worker crashes, but not when it is closed on purpose', async () => {
  const { spawn, children } = fakeSpawner();
  const warn = vi.fn();
  const validator = new LocalScouterValidator({ worker: new OcrWorker({ spawn, log: { warn } }) });
  const buf = await image();
  await expect(validator.validate(buf)).resolves.toBeUndefined();
  children[0]!.crash();
  expect(warn).toHaveBeenCalledTimes(1);
  expect(warn.mock.calls[0]![1]).toMatch(/OCR worker exited unexpectedly/);
  await expect(validator.validate(buf)).resolves.toBeUndefined();
  await validator.close();
  expect(warn).toHaveBeenCalledTimes(1);
});

it('fails a check whose worker dies mid-job, then recovers', async () => {
  const { spawn, children } = fakeSpawner({ reply: () => null });
  const validator = new LocalScouterValidator({ worker: new OcrWorker({ spawn }) });
  const buf = await image();
  const first = validator.validate(buf);
  await vi.waitFor(() => expect(children[0]?.jobs).toHaveLength(1));
  children[0]!.crash();
  await expect(first).rejects.toMatchObject({ code: 'SCOUTER_CHECK_UNAVAILABLE' });
  expect(spawn).toHaveBeenCalledTimes(1);
  await validator.close();
});

it('does not count the worker cold start against the per-job timeout', async () => {
  // Starting takes longer than the job timeout; the job itself is quick, so the check still passes.
  const { spawn } = fakeSpawner({ readyAfterMs: 1500 });
  const validator = new LocalScouterValidator({ worker: new OcrWorker({ spawn }), timeoutMs: 1000 });
  await expect(validator.validate(await image())).resolves.toBeUndefined();
  await validator.close();
});

it('kills a worker whose job times out and starts a fresh one for the next check', async () => {
  let jobs = 0;
  // The first job ever sent hangs; later ones (on the replacement worker) answer.
  const { spawn, children } = fakeSpawner({ reply: () => (++jobs === 1 ? null : SCOUTER_TEXT) });
  const validator = new LocalScouterValidator({ worker: new OcrWorker({ spawn }), timeoutMs: 2000 });
  const buf = await image();
  await expect(validator.validate(buf)).rejects.toMatchObject({ code: 'SCOUTER_CHECK_UNAVAILABLE' });
  expect(children[0]!.killed).toBe(true);
  await expect(validator.validate(buf)).resolves.toBeUndefined();
  expect(spawn).toHaveBeenCalledTimes(2);
  await validator.close();
});

it('gives up on a worker that never becomes ready', async () => {
  const { spawn, children } = fakeSpawner({ readyAfterMs: 10_000 });
  const validator = new LocalScouterValidator({ worker: new OcrWorker({ spawn, startupTimeoutMs: 100 }) });
  await expect(validator.validate(await image())).rejects.toMatchObject({ code: 'SCOUTER_CHECK_UNAVAILABLE' });
  expect(children[0]!.killed).toBe(true);
  await validator.close();
});

it('rejects tiny images before starting OCR', async () => {
  const readText = vi.fn(async () => SCOUTER_TEXT);
  const tiny = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'white' } }).png().toBuffer();
  await expect(new LocalScouterValidator({ readText }).validate(tiny)).rejects.toMatchObject({ code: 'NOT_SCOUTER' });
  expect(readText).not.toHaveBeenCalled();
});

it('processes simultaneous checks one at a time in arrival order', async () => {
  const entered = deferred<void>();
  const text = deferred<string>();
  const readText = vi.fn(() => { entered.resolve(); return text.promise; });
  const validator = new LocalScouterValidator({ readText });
  const buf = await image();
  const completed: number[] = [];
  const first = validator.validate(buf).then(() => completed.push(1));
  await entered.promise;
  const second = validator.validate(buf).then(() => completed.push(2));
  const third = validator.validate(buf).then(() => completed.push(3));
  expect(readText).toHaveBeenCalledTimes(1);
  text.resolve(SCOUTER_TEXT);
  await Promise.all([first, second, third]);
  expect(completed).toEqual([1, 2, 3]);
  await expect(validator.validate(buf)).resolves.toBeUndefined();
});

it('accepts a bounded number of waiting uploads and rejects additional ones until space is available', async () => {
  expect(SCOUTER_MAX_WAITING).toBe(20);
  const entered = deferred<void>();
  const text = deferred<string>();
  const readText = vi.fn(() => { entered.resolve(); return text.promise; });
  const validator = new LocalScouterValidator({ readText });
  const buf = await image();
  const first = validator.validate(buf);
  await entered.promise;
  const waiting = Array.from({ length: SCOUTER_MAX_WAITING }, () => validator.validate(buf));
  await expect(validator.validate(buf)).rejects.toMatchObject({ code: 'SCOUTER_QUEUE_FULL', status: 429 });
  text.resolve(SCOUTER_TEXT);
  await Promise.all([first, ...waiting]);
  await expect(validator.validate(buf)).resolves.toBeUndefined();
});

it('expires queued uploads without running OCR for them', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const entered = deferred<void>();
  const text = deferred<string>();
  const readText = vi.fn(() => { entered.resolve(); return text.promise; });
  const validator = new LocalScouterValidator({ readText, timeoutMs: 2 * SCOUTER_MAX_WAIT_MS });
  const buf = await image();
  const first = validator.validate(buf);
  await entered.promise;
  const queued = validator.validate(buf);
  const rejected = expect(queued).rejects.toMatchObject({ code: 'SCOUTER_QUEUE_TIMEOUT', status: 503 });
  vi.advanceTimersByTime(SCOUTER_MAX_WAIT_MS);
  await rejected;
  text.resolve(SCOUTER_TEXT);
  await first;
  expect(readText).toHaveBeenCalledTimes(1);
  await expect(validator.validate(buf)).resolves.toBeUndefined();
});

it('continues the queue when the current check fails', async () => {
  const entered = deferred<void>();
  const text = deferred<string>();
  const readText = vi.fn(() => { entered.resolve(); return text.promise; }).mockResolvedValueOnce('Unrelated image');
  const validator = new LocalScouterValidator({ readText });
  const buf = await image();
  const first = validator.validate(buf);
  const rejected = expect(first).rejects.toMatchObject({ code: 'NOT_SCOUTER' });
  const queued = validator.validate(buf);
  await rejected;
  await entered.promise;
  text.resolve(SCOUTER_TEXT);
  await expect(queued).resolves.toBeUndefined();
});

it('aborts timed-out OCR and permits a retry', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const entered = deferred<AbortSignal>();
  const readText = vi.fn((_buf: Buffer, signal: AbortSignal) => {
    entered.resolve(signal);
    return new Promise<string>(() => {});
  });
  const validator = new LocalScouterValidator({ readText });
  const buf = await image();
  const first = validator.validate(buf);
  const rejected = expect(first).rejects.toMatchObject({ code: 'SCOUTER_CHECK_UNAVAILABLE', status: 503 });
  const signal = await entered.promise;
  const queued = validator.validate(buf);
  readText.mockResolvedValueOnce(SCOUTER_TEXT);
  vi.advanceTimersByTime(20_000);
  await rejected;
  expect(signal.aborted).toBe(true);
  await expect(queued).resolves.toBeUndefined();
  readText.mockResolvedValueOnce(SCOUTER_TEXT);
  await expect(validator.validate(buf)).resolves.toBeUndefined();
});

it('fails closed when OCR errors without exposing its error message', async () => {
  const validator = new LocalScouterValidator({ readText: async () => { throw new Error('private OCR diagnostics'); } });
  await expect(validator.validate(await image())).rejects.toMatchObject({ code: 'SCOUTER_CHECK_UNAVAILABLE', message: 'Screenshot verification is temporarily unavailable. Please try again.' });
});

beforeEach(resetDb);

it.each([
  new AppError(400, 'NOT_SCOUTER', 'Upload a full Maple Scouter screenshot.'),
  new AppError(503, 'SCOUTER_CHECK_UNAVAILABLE', 'Please try again.'),
])('does not save rejected uploads or replace an existing screenshot ($code)', async (error) => {
  const validate = vi.fn<(image: Buffer) => Promise<void>>().mockResolvedValue(undefined);
  const { app, uploadDir } = await buildTestApp({ scouterValidator: { validate } });
  try {
    const cookie = await loginAs(app);
    const owner = await prisma.user.findUniqueOrThrow({ where: { discordId: 'u-1' } });
    const character = await makeCharacter({ ownerId: owner.id });
    const buf = await image();
    const payload = Buffer.concat([
      Buffer.from('--scouter\r\nContent-Disposition: form-data; name="file"; filename="scouter.png"\r\nContent-Type: image/png\r\n\r\n'),
      buf, Buffer.from('\r\n--scouter--\r\n'),
    ]);
    const upload = (asCookie = cookie) => app.inject({ method: 'PUT', url: `/api/characters/${character.id}/screenshot`, headers: { cookie: asCookie, 'content-type': 'multipart/form-data; boundary=scouter' }, payload });
    expect((await upload(await loginAs(app, 'not-owner'))).statusCode).toBe(403);
    expect(validate).not.toHaveBeenCalled();
    expect((await upload()).statusCode).toBe(200);
    const previous = await prisma.character.findUniqueOrThrow({ where: { id: character.id } });
    const files = fs.readdirSync(uploadDir);
    validate.mockRejectedValueOnce(error);
    const rejected = await upload();
    expect(rejected.statusCode).toBe(error.status);
    expect(rejected.json().error.code).toBe(error.code);
    expect(fs.readdirSync(uploadDir)).toEqual(files);
    expect((await prisma.character.findUniqueOrThrow({ where: { id: character.id } })).screenshotKey).toBe(previous.screenshotKey);
  } finally {
    await app.close();
  }
});

it('stops the OCR worker when the app closes', async () => {
  const close = vi.fn(async () => {});
  const { app } = await buildTestApp({ scouterValidator: { validate: async () => {}, close } });
  expect(close).not.toHaveBeenCalled();
  await app.close();
  expect(close).toHaveBeenCalledTimes(1);
});
