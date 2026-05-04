import { AgentProvider } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';

const createWorkspaceSchema = z.object({
  name: z.string().trim().min(1),
  path: z.string().trim().min(1)
});

const createSessionSchema = z.object({
  provider: z.enum(['codex', 'codex-cli', 'cursor']),
  name: z.string().trim().min(1).optional()
});

const providerToDb = (provider: 'codex' | 'codex-cli' | 'cursor') => {
  if (provider === 'codex') return AgentProvider.CODEX;
  if (provider === 'codex-cli') return AgentProvider.CODEX_CLI;
  return AgentProvider.CURSOR;
};

const providerFromDb = (provider: AgentProvider) => {
  return provider === AgentProvider.CODEX_CLI ? 'codex-cli' : provider.toLowerCase();
};

export async function registerWorkspaceRoutes(app: FastifyInstance) {
  app.get('/workspaces', async () => {
    const workspaces = await prisma.workspace.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        sessions: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    return workspaces.map((workspace) => ({
      ...workspace,
      sessions: workspace.sessions.map((session) => ({
        ...session,
        provider: providerFromDb(session.provider)
      }))
    }));
  });

  app.post('/workspaces', async (request, reply) => {
    const parsed = createWorkspaceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'Invalid workspace payload', issues: parsed.error.issues });
    }

    const workspace = await prisma.workspace.create({
      data: parsed.data
    });

    return reply.code(201).send(workspace);
  });

  app.delete('/workspaces/:workspaceId', async (request, reply) => {
    const params = z.object({ workspaceId: z.string().min(1) }).safeParse(request.params);

    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid workspace id', issues: params.error.issues });
    }

    const workspace = await prisma.workspace.findFirst({
      where: {
        id: params.data.workspaceId,
        deletedAt: null
      }
    });

    if (!workspace) {
      return reply.code(404).send({ error: 'Workspace not found' });
    }

    await prisma.workspace.update({
      where: { id: workspace.id },
      data: { deletedAt: new Date() }
    });

    return reply.code(204).send();
  });

  app.post('/workspaces/:workspaceId/sessions', async (request, reply) => {
    const params = z.object({ workspaceId: z.string().min(1) }).safeParse(request.params);
    const body = createSessionSchema.safeParse(request.body);

    if (!params.success || !body.success) {
      return reply.code(400).send({
        error: 'Invalid session payload',
        issues: [...(params.success ? [] : params.error.issues), ...(body.success ? [] : body.error.issues)]
      });
    }

    const workspace = await prisma.workspace.findFirst({
      where: {
        id: params.data.workspaceId,
        deletedAt: null
      },
      include: { sessions: true }
    });

    if (!workspace) {
      return reply.code(404).send({ error: 'Workspace not found' });
    }

    const providerLabel = body.data.provider === 'codex'
      ? 'Codex SDK'
      : body.data.provider === 'codex-cli'
        ? 'Codex CLI'
        : 'Cursor';
    const session = await prisma.session.create({
      data: {
        workspaceId: workspace.id,
        provider: providerToDb(body.data.provider),
        name: body.data.name ?? `${providerLabel} Session ${workspace.sessions.length + 1}`
      }
    });

    return reply.code(201).send({
      ...session,
      provider: providerFromDb(session.provider)
    });
  });
}
