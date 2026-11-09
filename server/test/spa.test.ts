import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildTestApp, testConfig } from './helpers.js';

// Real HTTP (not inject): static file streaming under light-my-request emits listener warnings.
async function start(webDist?: string): Promise<{ app: FastifyInstance; base: string }> {
  const { app } = await buildTestApp({ config: testConfig({ webDist }) });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address() as { port: number };
  return { app, base: `http://127.0.0.1:${addr.port}` };
}

describe('static web serving', () => {
  const webDist = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-web-'));
  fs.writeFileSync(path.join(webDist, 'index.html'), '<html>spa</html>');
  let app: FastifyInstance | undefined;
  afterEach(async () => {
    await app?.close();
  });

  it('serves SPA for deep links but keeps /api and /uploads 404 JSON', async () => {
    const s = await start(webDist);
    app = s.app;
    expect(await (await fetch(`${s.base}/`)).text()).toContain('spa');
    expect(await (await fetch(`${s.base}/me/characters`)).text()).toContain('spa');
    const api = await fetch(`${s.base}/api/nope`);
    expect(api.status).toBe(404);
    expect(((await api.json()) as any).error.code).toBe('NOT_FOUND');
    const up = await fetch(`${s.base}/uploads/missing`);
    expect(up.status).toBe(404);
    expect(up.headers.get('content-type')).toContain('json');
  });

  it('does not serve the web app when webDist is unset', async () => {
    const s = await start();
    app = s.app;
    expect((await fetch(`${s.base}/me/characters`)).status).toBe(404);
  });
});
