import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import secureSession from '@fastify/secure-session';
import type { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import { registerErrorHandler } from './http/errors.js';
import type { NexonClient } from './nexon/client.js';
import type { DiscordOAuth } from './auth/discordOAuth.js';
import { authRoutes } from './auth/routes.js';

export interface AppDeps {
  config: Config;
  nexon: NexonClient;
  prisma: PrismaClient;
  discord: DiscordOAuth;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.config.port !== 0 });
  app.decorate('deps', deps);
  registerErrorHandler(app);

  await app.register(secureSession, {
    key: createHash('sha256').update(deps.config.sessionSecret).digest(),
    cookieName: 'pf_session',
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: deps.config.webOrigin.startsWith('https://'),
      maxAge: 60 * 60 * 24 * 30,
    },
  });

  await app.register(
    async (api) => {
      api.get('/health', async () => ({ ok: true }));
      await api.register(authRoutes);
    },
    { prefix: '/api' },
  );

  return app;
}
