import type { FastifyInstance } from 'fastify';
import { loadCodexOptions } from '../services/codex-options.js';

export async function registerAgentOptionsRoutes(app: FastifyInstance) {
  app.get('/agent-options/codex', async () => {
    return loadCodexOptions();
  });
}
