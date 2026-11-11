import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { AppError } from '../http/errors.js';

export interface ScouterValidator {
  validate(image: Buffer): Promise<void>;
  /** Stops any background OCR process. */
  close?(): Promise<void>;
}

const INVALID_MESSAGE = 'Upload a full Maple Scouter screenshot showing Boss Clear and Scouter Graph or Stat Efficiency.';
/** Uploads that may wait while another is checked; a check takes a few seconds once OCR is warm. */
export const SCOUTER_MAX_WAITING = 20;
export const SCOUTER_MAX_WAIT_MS = 60_000;

export function isScouterText(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const bossClear = /\bboss\s+clear\b/.test(normalized);
  const analysis = /\bscouter\s+(?:graph|hexagon)\b|\bstat\s+efficiency\b/.test(normalized);
  const stats = /\bcombat\s+power\b|\bitem\s+stat\b|\bhexa\s+stat\b/.test(normalized);
  const results = /\bparty\s*able\b|\bsolo\s+min\b|\bimpossible\b|\bboss\s+standards\b/.test(normalized);
  return bossClear && analysis && stats && results;
}

type Job = { resolve: (text: string) => void; reject: (error: Error) => void };

/**
 * One long-lived OCR child process (see scouterOcr.ts), started on first use and reused, so the
 * tesseract model loads once instead of per upload. It is replaced if it exits, fails to start, or
 * a job is abandoned (timed out), since it may still be stuck on that job.
 */
export class OcrWorker {
  private child: ChildProcess | undefined;
  private starting: Promise<ChildProcess> | undefined;
  private readonly jobs = new Map<number, Job>();
  private nextId = 1;
  private readonly spawn: () => ChildProcess;
  private readonly startupTimeoutMs: number;

  constructor(options: { spawn?: () => ChildProcess; startupTimeoutMs?: number } = {}) {
    this.spawn = options.spawn ?? spawnOcrProcess;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 60_000;
  }

  /** Resolves once the process is up and its model is loaded, starting it if needed. */
  async warmUp(): Promise<void> {
    await this.start();
  }

  async read(image: Buffer, signal: AbortSignal): Promise<string> {
    const child = await this.start();
    signal.throwIfAborted();
    return new Promise<string>((resolve, reject) => {
      const id = this.nextId++;
      const onAbort = () => {
        if (!this.jobs.has(id)) return;
        this.fail(id, new Error('OCR job abandoned'));
        // It may still be working on this job: replace it rather than queue the next job behind it.
        this.stop(child);
      };
      this.jobs.set(id, {
        resolve: (text) => { signal.removeEventListener('abort', onAbort); resolve(text); },
        reject: (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
      });
      signal.addEventListener('abort', onAbort, { once: true });
      child.send({ id, image }, (error) => {
        if (!error) return;
        this.fail(id, error);
        this.stop(child);
      });
    });
  }

  async close(): Promise<void> {
    if (this.child) this.stop(this.child);
  }

  private start(): Promise<ChildProcess> {
    if (this.starting) return this.starting;
    const child = this.spawn();
    this.child = child;
    const starting = new Promise<ChildProcess>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('OCR worker did not start in time'));
        this.stop(child);
      }, this.startupTimeoutMs);
      child.on('message', (message: unknown) => {
        const { type, id, text } = (message ?? {}) as { type?: unknown; id?: unknown; text?: unknown };
        if (type === 'ready') {
          clearTimeout(timer);
          resolve(child);
          return;
        }
        if (typeof id !== 'number') return;
        const job = this.jobs.get(id);
        this.jobs.delete(id);
        if (typeof text === 'string') job?.resolve(text);
        else job?.reject(new Error('OCR failed'));
      });
      const gone = () => {
        clearTimeout(timer);
        reject(new Error('OCR worker exited'));
        this.forget(child);
      };
      child.once('exit', gone);
      child.once('error', () => {
        gone();
        child.kill('SIGKILL');
      });
    });
    starting.catch(() => {});
    this.starting = starting;
    return starting;
  }

  private fail(id: number, error: Error): void {
    const job = this.jobs.get(id);
    this.jobs.delete(id);
    job?.reject(error);
  }

  /** Drops `child` if it is still current and fails its unfinished jobs; the next job starts a new one. */
  private forget(child: ChildProcess): void {
    if (this.child !== child) return;
    this.child = undefined;
    this.starting = undefined;
    for (const id of [...this.jobs.keys()]) this.fail(id, new Error('OCR worker exited'));
  }

  private stop(child: ChildProcess): void {
    this.forget(child);
    child.kill('SIGKILL');
  }
}

function spawnOcrProcess(): ChildProcess {
  // From source (dev, tests) the .ts entry runs through tsx; the build emits dist/scouterOcr.js next to index.js.
  const source = import.meta.url.endsWith('.ts');
  const script = fileURLToPath(new URL(source ? '../scouterOcr.ts' : './scouterOcr.js', import.meta.url));
  const child = fork(script, [], {
    execArgv: source ? ['--import', 'tsx'] : [],
    windowsHide: true,
    serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'], killSignal: 'SIGKILL',
  });
  // An idle OCR process must not keep the server (or a test run) alive; pending uploads keep it busy anyway.
  child.unref();
  child.channel?.unref();
  return child;
}

export class LocalScouterValidator implements ScouterValidator {
  private checking = false;
  private readonly waiting: (() => void)[] = [];
  private readonly worker: OcrWorker | undefined;

  constructor(private readonly options: { readText?: (image: Buffer, signal: AbortSignal) => Promise<string>; timeoutMs?: number; worker?: OcrWorker } = {}) {
    this.worker = options.readText ? undefined : (options.worker ?? new OcrWorker());
  }

  async close(): Promise<void> {
    await this.worker?.close();
  }

  private readText(image: Buffer, signal: AbortSignal): Promise<string> {
    if (this.options.readText) return this.options.readText(image, signal);
    return this.worker!.read(image, signal);
  }

  private async acquire(): Promise<void> {
    if (!this.checking) {
      this.checking = true;
      return;
    }
    if (this.waiting.length >= SCOUTER_MAX_WAITING) {
      throw new AppError(429, 'SCOUTER_QUEUE_FULL', 'The screenshot queue is full. Please try again shortly.');
    }
    await new Promise<void>((resolve, reject) => {
      const start = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const index = this.waiting.indexOf(start);
        if (index < 0) return;
        this.waiting.splice(index, 1);
        reject(new AppError(503, 'SCOUTER_QUEUE_TIMEOUT', 'The screenshot queue is taking too long. Please try again.'));
      }, SCOUTER_MAX_WAIT_MS);
      this.waiting.push(start);
    });
  }

  async validate(image: Buffer): Promise<void> {
    await this.acquire();
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const check = async () => {
      const metadata = await sharp(image).metadata();
      if (!metadata.width || !metadata.height || metadata.width < 320 || metadata.height < 300) {
        throw new AppError(400, 'NOT_SCOUTER', INVALID_MESSAGE);
      }
      const prepared = await sharp(image).flatten({ background: '#fff' }).greyscale()
        .resize({ width: 2400, height: 2400, fit: 'inside' }).png().toBuffer();
      controller.signal.throwIfAborted();
      const text = await this.readText(prepared, controller.signal);
      if (!isScouterText(text)) throw new AppError(400, 'NOT_SCOUTER', INVALID_MESSAGE);
    };
    try {
      // A cold start loads the OCR model; it has its own startup limit and doesn't use up the job's time.
      await this.worker?.warmUp();
      await Promise.race([
        check(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Scouter check timed out')), this.options.timeoutMs ?? 20_000);
        }),
      ]);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(503, 'SCOUTER_CHECK_UNAVAILABLE', 'Screenshot verification is temporarily unavailable. Please try again.');
    } finally {
      controller.abort();
      clearTimeout(timer);
      const next = this.waiting.shift();
      if (next) next();
      else this.checking = false;
    }
  }
}
