// Long-lived OCR process: loads the tesseract model once, then answers { id, image } jobs one at a time.
import { createRequire } from 'node:module';
import path from 'node:path';
import { createWorker, OEM, PSM } from 'tesseract.js';

const require = createRequire(import.meta.url);
const langPath = path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');

// The parent owns this process: exit as soon as it goes away.
process.once('disconnect', () => process.exit(1));

const ready = (async () => {
  const worker = await createWorker('eng', OEM.LSTM_ONLY, { langPath, cacheMethod: 'none', errorHandler: () => {} });
  await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
  return worker;
})();
ready.then(() => process.send?.({ type: 'ready' }), () => process.exit(1));

let queue = Promise.resolve();
process.on('message', (message: unknown) => {
  queue = queue.then(() => recognize(message));
});

async function recognize(message: unknown): Promise<void> {
  const { id, image } = (message ?? {}) as { id?: unknown; image?: unknown };
  if (typeof id !== 'number') return;
  try {
    if (!(image instanceof Uint8Array)) throw new Error('Expected image buffer');
    const worker = await ready;
    const { data } = await worker.recognize(Buffer.isBuffer(image) ? image : Buffer.from(image.buffer, image.byteOffset, image.byteLength));
    process.send?.({ id, text: data.text });
  } catch {
    process.send?.({ id, error: true });
  }
}
