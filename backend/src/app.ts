import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { env } from './config/env.js';
import { registerAgentOptionsRoutes } from './routes/agent-options.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerTerminalRoutes } from './routes/terminal.js';
import { registerWorkspaceRoutes } from './routes/workspaces.js';

export async function buildApp() {
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
  await registerAgentOptionsRoutes(app);
  await registerSessionRoutes(app);
  await registerTerminalRoutes(app);

  return app;
}
