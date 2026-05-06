import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { access } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { registerAgentOptionsRoutes } from './routes/agent-options.js';
import { registerCodeBrowserRoutes } from './routes/code-browser.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerTerminalRoutes } from './routes/terminal.js';
import { registerWorkspaceRoutes } from './routes/workspaces.js';

export async function buildApp() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const websiteDistDir = resolve(currentDir, '../../website/dist');
  const app = Fastify({
    logger: true
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin) || origin === env.websiteOrigin) {
        callback(null, true);
        return;
      }

      callback(new Error(`Origin ${origin} is not allowed`), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
  });

  await app.register(multipart, {
    limits: {
      files: 5,
      fileSize: 10 * 1024 * 1024
    }
  });
  await app.register(websocket);

  await registerHealthRoutes(app);
  await registerSystemRoutes(app);
  await registerWorkspaceRoutes(app);
  await registerCodeBrowserRoutes(app);
  await registerAgentOptionsRoutes(app);
  await registerSessionRoutes(app);
  await registerTerminalRoutes(app);

  try {
    await access(join(websiteDistDir, 'index.html'));
    await app.register(fastifyStatic, {
      root: websiteDistDir,
      prefix: '/'
    });

    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/sessions/') || request.url.startsWith('/workspaces/') || request.url.startsWith('/turns/') || request.url.startsWith('/agent-options/') || request.url.startsWith('/health') || request.url.startsWith('/system/')) {
        return reply.code(404).send({ error: 'Not Found' });
      }

      return reply.sendFile('index.html');
    });
  } catch {
    // Frontend dist is optional during split dev mode.
  }

  return app;
}
