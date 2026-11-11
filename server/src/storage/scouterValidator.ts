import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { AppError } from '../http/errors.js';

export interface ScouterValidator {
  validate(image: Buffer): Promise<void>;
}

const INVALID_MESSAGE = 'Upload a full Maple Scouter screenshot showing Boss Clear and Scouter Graph or Stat Efficiency.';
const MAX_WAITING = 5;
const MAX_WAIT_MS = 30_000;

export function isScouterText(text: string): boolean {
  const normalized = text.toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const bossClear = /\bboss\s+clear\b/.test(normalized);
  const analysis = /\bscouter\s+(?:graph|hexagon)\b|\bstat\s+efficiency\b/.test(normalized);
  const stats = /\bcombat\s+power\b|\bitem\s+stat\b|\bhexa\s+stat\b/.test(normalized);
  const results = /\bparty\s*able\b|\bsolo\s+min\b|\bimpossible\b|\bboss\s+standards\b/.test(normalized);
  return bossClear && analysis && stats && results;
}

async function readLocalText(image: Buffer, signal: AbortSignal): Promise<string> {
  const source = import.meta.url.endsWith('.ts');
  const script = fileURLToPath(new URL(source ? '../scouterOcr.ts' : './scouterOcr.js', import.meta.url));
  const child = fork(script, [], {
    execArgv: source ? ['--import', 'tsx'] : [],
    windowsHide: true,
    serialization: 'advanced', stdio: ['ignore', 'ignore', 'ignore', 'ipc'], signal, killSignal: 'SIGKILL',
  });
  try {
    return await new Promise<string>((resolve, reject) => {
      child.once('message', (message: unknown) => {
        const text = (message as { text?: unknown } | null)?.text;
        if (typeof text === 'string') resolve(text);
        else reject(new Error('OCR failed'));
      });
      child.once('error', reject);
      child.once('exit', () => reject(new Error('OCR process exited')));
      child.send(image, (error) => { if (error) reject(error); });
    });
  } finally {
    child.kill('SIGKILL');
  }
}

export class LocalScouterValidator implements ScouterValidator {
  private checking = false;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly options: { readText?: (image: Buffer, signal: AbortSignal) => Promise<string>; timeoutMs?: number } = {}) {}

  private async acquire(): Promise<void> {
    if (!this.checking) {
      this.checking = true;
      return;
    }
    if (this.waiting.length >= MAX_WAITING) {
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
      }, MAX_WAIT_MS);
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
      const text = await (this.options.readText ?? readLocalText)(prepared, controller.signal);
      if (!isScouterText(text)) throw new AppError(400, 'NOT_SCOUTER', INVALID_MESSAGE);
    };
    try {
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
