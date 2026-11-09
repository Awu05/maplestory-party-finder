import { defineConfig } from 'tsup';

// @pf/shared exports raw .ts, so it must be bundled rather than left external.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  noExternal: ['@pf/shared'],
});
