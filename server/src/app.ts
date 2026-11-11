import { createHash } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import secureSession from '@fastify/secure-session';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import type { Config } from './config.js';
import { registerErrorHandler } from './http/errors.js';
import type { NexonClient } from './nexon/client.js';
import type { DiscordOAuth } from './auth/discordOAuth.js';
import { authRoutes } from './auth/routes.js';
import { catalogRoutes } from './catalog/routes.js';
import { characterRoutes } from './characters/routes.js';
import { postRoutes } from './posts/routes.js';
import { requestRoutes } from './requests/routes.js';
import { notificationRoutes } from './notifications/routes.js';
import type { DomainEvents } from './events.js';
import type { Storage } from './storage/storage.js';
import type { WebhookSender } from './discord/sender.js';
import { adminWebhookRoutes } from './admin/webhooks.js';
import { adminModerationRoutes } from './admin/moderation.js';

export interface AppDeps {
  config: Config;
  nexon: NexonClient;
  prisma: PrismaClient;
  discord: DiscordOAuth;
  storage: Storage;
  events: DomainEvents;
  webhookSender: WebhookSender;
}

declare module 'fastify' {
  interface FastifyInstance {
    deps: AppDeps;
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: deps.config.logger });
  app.decorate('deps', deps);
  registerErrorHandler(app);

  const sessionMaxAgeSeconds = 60 * 60 * 24 * 30;
  await app.register(secureSession, {
    key: createHash('sha256').update(deps.config.sessionSecret).digest(),
    cookieName: 'pf_session',
    // Server-side expiry (checked against the session's write time); must match the cookie lifetime.
    expiry: sessionMaxAgeSeconds,
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: deps.config.webOrigin.startsWith('https://'),
      maxAge: sessionMaxAgeSeconds,
    },
  });

  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

  // API data is per-user and changes constantly: never let a browser or proxy reuse an old copy.
  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/api/') || req.url === '/api') reply.header('Cache-Control', 'no-store');
  });

  app.get<{ Params: { key: string } }>('/uploads/:key', async (req, reply) => {
    const found = await deps.storage.read(req.params.key);
    if (!found) return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    return reply
      .header('Content-Type', found.contentType)
      .header('Cache-Control', 'public, max-age=31536000, immutable')
      .header('X-Content-Type-Options', 'nosniff')
      .send(found.buf);
  });

  await app.register(
    async (api) => {
      api.get('/health', async () => ({ ok: true }));
      await api.register(authRoutes);
      await api.register(catalogRoutes);
      await api.register(characterRoutes);
      await api.register(postRoutes);
      await api.register(requestRoutes);
      await api.register(notificationRoutes);
      await api.register(adminWebhookRoutes);
      await api.register(adminModerationRoutes);
    },
    { prefix: '/api' },
  );

  if (deps.config.webDist) {
    await app.register(fastifyStatic, { root: path.resolve(deps.config.webDist) });
    app.setNotFoundHandler(async (req, reply) => {
      const isApiOrUploads = /^\/(api|uploads)(\/|\?|$)/.test(req.url);
      if (req.method === 'GET' && !isApiOrUploads) return reply.type('text/html').sendFile('index.html');
      return reply.status(404).send({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    });
  }

  return app;
}
