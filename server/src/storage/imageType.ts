import type { FastifyRequest } from 'fastify';
import sharp from 'sharp';
import { AppError } from '../http/errors.js';
import type { ImageExt } from './storage.js';

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Largest accepted input, in pixels (about 8000 × 5000). Larger headers are refused before decoding. */
export const MAX_INPUT_PIXELS = 40_000_000;
/** Stored screenshots fit inside this box; larger ones are scaled down. */
export const MAX_STORED_SIDE = 2560;

export function sniffImageType(buf: Buffer): ImageExt | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    return 'webp';
  }
  return null;
}

/**
 * Decodes the image and draws a brand-new WebP from its pixels only. Anything else in the upload
 * (appended or embedded data, EXIF/GPS and other metadata, extra animation frames) is discarded,
 * so the stored file can only ever be a plain picture.
 */
export async function sanitizeImage(buf: Buffer): Promise<Buffer> {
  try {
    return await sharp(buf, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
      .rotate() // apply the EXIF orientation before the metadata is dropped
      .resize({ width: MAX_STORED_SIDE, height: MAX_STORED_SIDE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    throw new AppError(400, 'UNSUPPORTED_IMAGE', "That file isn't a valid image");
  }
}

export async function readImageUpload(req: FastifyRequest): Promise<{ buf: Buffer; ext: ImageExt }> {
  const file = await req.file();
  if (!file) throw new AppError(400, 'NO_FILE', 'No file uploaded');
  const raw = await file.toBuffer().catch((err: any) => {
    if (err?.code === 'FST_REQ_FILE_TOO_LARGE') throw new AppError(400, 'FILE_TOO_LARGE', 'File exceeds 5 MB');
    throw err;
  });
  if (file.file.truncated) throw new AppError(400, 'FILE_TOO_LARGE', 'File exceeds 5 MB');
  // Cheap first gate: only hand real PNG/JPEG/WebP files to the decoder.
  if (!sniffImageType(raw)) throw new AppError(400, 'UNSUPPORTED_IMAGE', 'Unsupported image type');
  return { buf: await sanitizeImage(raw), ext: 'webp' };
}
