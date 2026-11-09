import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import { registerErrorHandler } from './http/errors.js';
import type { NexonClient } from './nexon/client.js';

export interface AppDeps {
  config: Config;
  nexon: NexonClient;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.config.port !== 0 });
  registerErrorHandler(app);

  await app.register(
    async (api) => {
      api.get('/health', async () => ({ ok: true }));
    },
    { prefix: '/api' },
  );

  return app;
}
