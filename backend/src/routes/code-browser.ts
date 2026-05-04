import type { FastifyInstance } from 'fastify';
import { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { ensureReviewdock } from '../db/workspace-prisma.js';

const workspaceParamsSchema = z.object({
  workspaceId: z.string().min(1)
});

const fileQuerySchema = z.object({
  path: z.string().default('')
});

const historyBodySchema = z.object({
  path: z.string().min(1),
  startLine: z.number().int().positive().optional(),
  endLine: z.number().int().positive().optional(),
  selectedText: z.string().default('')
});

const ignoredDirs = new Set([
  '.git',
  '.reviewdock',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.turbo',
  '.cache',
  'coverage',
  'vendor'
]);

const resolveWorkspacePath = (workspacePath: string, requestedPath: string) => {
  const root = resolve(workspacePath);
  const resolvedPath = isAbsolute(requestedPath) ? resolve(requestedPath) : resolve(root, requestedPath);
  if (resolvedPath !== root && !resolvedPath.startsWith(`${root}${sep}`)) return null;
  return resolvedPath;
};

const splitLines = (text: string | null | undefined) => (text || '').replace(/\r\n/g, '\n').split('\n');

type DiffOp = { kind: 'same' | 'add' | 'delete'; text: string; beforeLine: number | null; afterLine: number | null };

const buildLineDiffOps = (beforeText: string | null | undefined, afterText: string | null | undefined) => {
  const beforeLines = splitLines(beforeText);
  const afterLines = splitLines(afterText);
  const table = Array.from({ length: beforeLines.length + 1 }, () => Array(afterLines.length + 1).fill(0));

  for (let i = beforeLines.length - 1; i >= 0; i -= 1) {
    for (let j = afterLines.length - 1; j >= 0; j -= 1) {
      table[i][j] = beforeLines[i] === afterLines[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  let beforeLine = 1;
  let afterLine = 1;

  while (i < beforeLines.length && j < afterLines.length) {
    if (beforeLines[i] === afterLines[j]) {
      ops.push({ kind: 'same', text: beforeLines[i], beforeLine, afterLine });
      i += 1;
      j += 1;
      beforeLine += 1;
      afterLine += 1;
      continue;
    }

    if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ kind: 'delete', text: beforeLines[i], beforeLine, afterLine: null });
      i += 1;
      beforeLine += 1;
    } else {
      ops.push({ kind: 'add', text: afterLines[j], beforeLine: null, afterLine });
      j += 1;
      afterLine += 1;
    }
  }

  while (i < beforeLines.length) {
    ops.push({ kind: 'delete', text: beforeLines[i], beforeLine, afterLine: null });
    i += 1;
    beforeLine += 1;
  }

  while (j < afterLines.length) {
    ops.push({ kind: 'add', text: afterLines[j], beforeLine: null, afterLine });
    j += 1;
    afterLine += 1;
  }

  return ops;
};

const excerptAround = (text: string | null | undefined, lineNumber: number | null | undefined) => {
  if (!text || !lineNumber) return '';
  const lines = splitLines(text);
  const start = Math.max(0, lineNumber - 3);
  const end = Math.min(lines.length, lineNumber + 2);
  return lines.slice(start, end).join('\n');
};

const providerFromDb = (provider: string) => provider === 'CODEX_CLI' ? 'codex-cli' : provider.toLowerCase();

export async function registerCodeBrowserRoutes(app: FastifyInstance) {
  app.get('/workspaces/:workspaceId/files', async (request, reply) => {
    const params = workspaceParamsSchema.safeParse(request.params);
    const query = fileQuerySchema.safeParse(request.query);

    if (!params.success || !query.success) {
      return reply.code(400).send({ error: 'Invalid file browser payload' });
    }

    const workspace = await prisma.workspace.findFirst({ where: { id: params.data.workspaceId, deletedAt: null } });
    if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });

    const fullPath = resolveWorkspacePath(workspace.path, query.data.path);
    if (!fullPath) return reply.code(400).send({ error: 'Invalid path' });

    let entries: Dirent[];
    try {
      entries = await readdir(fullPath, { withFileTypes: true });
    } catch {
      return reply.code(404).send({ error: 'Directory not found' });
    }

    return {
      path: relative(resolve(workspace.path), fullPath),
      entries: entries
        .filter((entry) => entry.isDirectory() || entry.isFile())
        .filter((entry) => !entry.isDirectory() || !ignoredDirs.has(entry.name))
        .map((entry) => ({
          name: entry.name,
          path: relative(resolve(workspace.path), join(fullPath, entry.name)),
          type: entry.isDirectory() ? 'directory' : 'file'
        }))
        .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1)
    };
  });

  app.get('/workspaces/:workspaceId/files/content', async (request, reply) => {
    const params = workspaceParamsSchema.safeParse(request.params);
    const query = fileQuerySchema.safeParse(request.query);

    if (!params.success || !query.success) {
      return reply.code(400).send({ error: 'Invalid file content payload' });
    }

    const workspace = await prisma.workspace.findFirst({ where: { id: params.data.workspaceId, deletedAt: null } });
    if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });

    const fullPath = resolveWorkspacePath(workspace.path, query.data.path);
    if (!fullPath) return reply.code(400).send({ error: 'Invalid path' });

    try {
      const content = await readFile(fullPath, 'utf8');
      return { path: query.data.path, content };
    } catch {
      return reply.code(404).send({ error: 'File not found or not readable as text' });
    }
  });

  app.post('/workspaces/:workspaceId/code-history', async (request, reply) => {
    const params = workspaceParamsSchema.safeParse(request.params);
    const body = historyBodySchema.safeParse(request.body);

    if (!params.success || !body.success) {
      return reply.code(400).send({ error: 'Invalid code history payload' });
    }

    const workspace = await prisma.workspace.findFirst({ where: { id: params.data.workspaceId, deletedAt: null } });
    if (!workspace) return reply.code(404).send({ error: 'Workspace not found' });

    const normalizedPath = relative(resolve(workspace.path), resolveWorkspacePath(workspace.path, body.data.path) ?? resolve(workspace.path, body.data.path));
    const db = await ensureReviewdock(workspace.path);
    const files = await db.modifiedFile.findMany({
      where: { path: normalizedPath },
      orderBy: { createdAt: 'desc' },
      include: {
        turn: {
          include: {
            session: true
          }
        }
      }
    });

    const startLine = body.data.startLine ?? 1;
    const endLine = body.data.endLine ?? startLine;

    const entries = files
      .map((file) => {
        const changedAfterLines = buildLineDiffOps(file.beforeContent, file.afterContent)
          .filter((op) => op.kind !== 'same' && op.afterLine !== null)
          .map((op) => op.afterLine as number);
        const overlapsSelection = changedAfterLines.some((line) => line >= startLine && line <= endLine);

        if (!overlapsSelection) return null;

        const firstLine = changedAfterLines.find((line) => line >= startLine && line <= endLine) ?? startLine;
        return {
          turnId: file.turn.id,
          taskTitle: file.turn.taskTitle,
          prompt: file.turn.prompt,
          createdAt: file.turn.createdAt,
          completedAt: file.turn.completedAt,
          sessionId: file.turn.session.id,
          sessionName: file.turn.session.name,
          provider: providerFromDb(file.turn.session.provider),
          filePath: file.path,
          changeKind: file.kind,
          changedLines: changedAfterLines,
          beforeExcerpt: excerptAround(file.beforeContent, firstLine),
          afterExcerpt: excerptAround(file.afterContent ?? file.content, firstLine),
          beforeContent: file.beforeContent,
          afterContent: file.afterContent ?? file.content
        };
      })
      .filter(Boolean);

    return { entries };
  });
}
