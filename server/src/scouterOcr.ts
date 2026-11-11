import { createRequire } from 'node:module';
import path from 'node:path';
import { createWorker, OEM, PSM } from 'tesseract.js';

const require = createRequire(import.meta.url);
const langPath = path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');

process.once('disconnect', () => process.exit(1));
process.once('message', async (image: unknown) => {
  try {
    if (!Buffer.isBuffer(image)) throw new Error('Expected image buffer');
    const worker = await createWorker('eng', OEM.LSTM_ONLY, {
      langPath, cacheMethod: 'none', errorHandler: () => {},
    });
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const { data } = await worker.recognize(image);
    process.send?.({ text: data.text }, () => process.exit(0));
  } catch {
    process.send?.({ error: true }, () => process.exit(1));
  }
});
