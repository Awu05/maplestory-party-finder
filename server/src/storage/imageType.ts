import type { FastifyRequest } from 'fastify';
import { AppError } from '../http/errors.js';
import type { ImageExt } from './storage.js';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function sniffImageType(buf: Buffer): ImageExt | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return null;
}

export async function readImageUpload(req: FastifyRequest): Promise<{ buf: Buffer; ext: ImageExt }> {
  const file = await req.file();
  if (!file) throw new AppError(400, 'NO_FILE', 'No file uploaded');
  const buf = await file.toBuffer().catch((err: any) => {
    if (err?.code === 'FST_REQ_FILE_TOO_LARGE') throw new AppError(400, 'FILE_TOO_LARGE', 'File exceeds 5 MB');
    throw err;
  });
  if (file.file.truncated) throw new AppError(400, 'FILE_TOO_LARGE', 'File exceeds 5 MB');
  const ext = sniffImageType(buf);
  if (!ext) throw new AppError(400, 'UNSUPPORTED_IMAGE', 'Unsupported image type');
  return { buf, ext };
}
