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

// 改动说明：允许本机与局域网调试来源，解决 Windows 下通过本机网卡 IP 访问前端时触发的 CORS 500。
const localDevOriginPattern = /^https?:\/\/(?:localhost|127\.0\.0\.1|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?::\d+)?$/;

const isAllowedOrigin = (origin: string | undefined): boolean => {
  if (!origin) {
    return true;
  }

  // 改动说明：保留既有 WEBSITE_ORIGIN 单值配置兼容性。
  if (origin === env.websiteOrigin) {
    return true;
  }

  // 改动说明：支持通过 CORS_ALLOWED_ORIGINS 配置多个精确来源。
  if (env.corsAllowedOrigins.includes(origin)) {
    return true;
  }

  // 改动说明：默认允许常见本机/私网开发地址，减少开发期跨网卡访问失败。
  return localDevOriginPattern.test(origin);
};

export async function buildApp() {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const websiteDistDir = resolve(currentDir, '../../website/dist');
  const app = Fastify({
    logger: true
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
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
