import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.tsx'],
    // The free-time grid renders 336 cells; on a slow CI runner one of its tests passed the 5s default
    // and failed a release. A hung test still fails, just later.
    testTimeout: 20_000,
  },
});
