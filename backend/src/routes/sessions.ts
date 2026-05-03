import { AgentProvider } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { execFile as execFileCallback } from 'node:child_process';
import { createWriteStream, type Dirent } from 'node:fs';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { runAgentTurn, type AgentAttachment, type CodexRunOptions } from '../agents/providers.js';
import { prisma } from '../db/prisma.js';
import { resolveCodexRunOptions } from '../services/codex-options.js';
import { extractTaskTitle } from '../services/task-title.js';

const sessionParamsSchema = z.object({
  sessionId: z.string().min(1)
});

const turnParamsSchema = z.object({
  turnId: z.string().min(1)
});

const sendMessageSchema = z.object({
  prompt: z.string().trim().min(1),
  model: z.string().optional(),
  reasoningEffort: z.string().optional()
});

const allowedImageMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const imageExtensions: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp'
};
const maxImageAttachments = 5;
const uploadRoot = join(process.cwd(), 'uploads', 'sessions');
const maxSnapshotFileBytes = 1024 * 1024;
const ignoredSnapshotDirs = new Set([
  '.git',
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

const providerFromDb = (provider: AgentProvider) => provider.toLowerCase();

const execFile = (command: string, args: string[], options: Record<string, unknown>) => new Promise<{ stdout: string }>((resolve, reject) => {
  execFileCallback(command, args, options as any, (error, stdout) => {
    if (error) {
      reject(error);
      return;
    }

    resolve({ stdout: String(stdout) });
  });
});

const readAfterContent = async (workspacePath: string, filePath: string) => {
  try {
    const resolvedPath = resolveWorkspaceFilePath(workspacePath, filePath);
    if (!resolvedPath) return null;
    return await readFile(resolvedPath, 'utf8');
  } catch {
    return null;
  }
};

const readBeforeContent = async (workspacePath: string, filePath: string) => {
  try {
    const relPath = isAbsolute(filePath) ? filePath.replace(`${workspacePath}/`, '') : filePath;
    const { stdout } = await execFile('git', ['-C', workspacePath, 'show', `HEAD:${relPath}`], { maxBuffer: 1024 * 1024 * 8 });
    return stdout;
  } catch {
    return null;
  }
};

const resolveWorkspaceFilePath = (workspacePath: string, filePath: string) => {
  const workspaceRoot = resolve(workspacePath);
  const resolvedPath = isAbsolute(filePath) ? resolve(filePath) : resolve(workspaceRoot, filePath);
  if (resolvedPath !== workspaceRoot && !resolvedPath.startsWith(`${workspaceRoot}${sep}`)) return null;
  return resolvedPath;
};

const normalizeWorkspaceFilePath = (workspacePath: string, filePath: string) => {
  const resolvedPath = resolveWorkspaceFilePath(workspacePath, filePath);
  if (!resolvedPath) return filePath;
  return relative(resolve(workspacePath), resolvedPath);
};

const shouldSnapshotFile = async (filePath: string) => {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size > maxSnapshotFileBytes) return false;
    const buffer = await readFile(filePath);
    return !buffer.includes(0);
  } catch {
    return false;
  }
};

const snapshotWorkspace = async (workspacePath: string) => {
  const root = resolve(workspacePath);
  const snapshot = new Map<string, string>();

  const walk = async (dir: string) => {
    let entries: Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    await Promise.all(entries.map(async (entry) => {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (ignoredSnapshotDirs.has(entry.name)) return;
        await walk(fullPath);
        return;
      }

      if (!entry.isFile() || !(await shouldSnapshotFile(fullPath))) return;
      const relativePath = relative(root, fullPath);
      try {
        snapshot.set(relativePath, await readFile(fullPath, 'utf8'));
      } catch {
        // Ignore files that change while the agent is starting.
      }
    }));
  };

  await walk(root);
  return snapshot;
};

const writeSse = (raw: NodeJS.WritableStream, event: string, data: unknown) => {
  raw.write(`event: ${event}\n`);
  raw.write(`data: ${JSON.stringify(data)}\n\n`);
};

const corsOriginForRequest = (origin: string | undefined) => {
  if (!origin) return undefined;
  if (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return origin;
  return undefined;
};

const parseTurnPayload = async (request: FastifyRequest, sessionId: string) => {
  if (!request.isMultipart()) {
    const body = sendMessageSchema.safeParse(request.body);
    if (!body.success) {
      return { success: false as const, issues: body.error.issues };
    }

    const options = await resolveCodexRunOptions(body.data.model, body.data.reasoningEffort);

    return {
      success: true as const,
      prompt: body.data.prompt,
      options,
      attachments: [] as AgentAttachment[]
    };
  }

  const uploadDir = join(uploadRoot, sessionId);
  await mkdir(uploadDir, { recursive: true });

  let prompt = '';
  let model: string | undefined;
  let reasoningEffort: string | undefined;
  const attachments: AgentAttachment[] = [];

  for await (const part of request.parts()) {
    if (part.type === 'field') {
      if (part.fieldname === 'prompt' && typeof part.value === 'string') {
        prompt = part.value;
      }
      if (part.fieldname === 'model' && typeof part.value === 'string') {
        model = part.value;
      }
      if (part.fieldname === 'reasoningEffort' && typeof part.value === 'string') {
        reasoningEffort = part.value;
      }
      continue;
    }

    if (part.fieldname !== 'attachments') {
      part.file.resume();
      continue;
    }

    if (attachments.length >= maxImageAttachments) {
      part.file.resume();
      continue;
    }

    if (!allowedImageMimeTypes.has(part.mimetype)) {
      part.file.resume();
      continue;
    }

    const fallbackExtension = imageExtensions[part.mimetype] ?? extname(part.filename);
    const filePath = join(uploadDir, `${crypto.randomUUID()}${fallbackExtension}`);
    await pipeline(part.file, createWriteStream(filePath));
    attachments.push({ type: 'local_image', path: filePath });
  }

  const body = sendMessageSchema.safeParse({ prompt, model, reasoningEffort });
  if (!body.success) {
    return { success: false as const, issues: body.error.issues };
  }

  const options = await resolveCodexRunOptions(body.data.model, body.data.reasoningEffort);

  return {
    success: true as const,
    prompt: body.data.prompt,
    options,
    attachments
  };
};

export async function registerSessionRoutes(app: FastifyInstance) {
  app.get('/turns/:turnId', async (request, reply) => {
    const params = turnParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid turn id', issues: params.error.issues });
    }

    const turn = await prisma.turn.findFirst({
      where: {
        id: params.data.turnId,
        session: { workspace: { deletedAt: null } }
      },
      include: {
        modifiedFiles: { orderBy: { createdAt: 'asc' } },
        session: { include: { workspace: true } }
      }
    });

    if (!turn) {
      return reply.code(404).send({ error: 'Turn not found' });
    }

    const hydratedFiles = await Promise.all(turn.modifiedFiles.map(async (file) => {
      if (file.beforeContent !== null || file.afterContent !== null) return file;

      const beforeContent = file.kind === 'add' ? null : await readBeforeContent(turn.session.workspace.path, file.path);
      const afterContent = file.kind === 'delete' ? null : await readAfterContent(turn.session.workspace.path, file.path);
      if (beforeContent === null && afterContent === null) return file;

      return prisma.modifiedFile.update({
        where: { id: file.id },
        data: {
          beforeContent,
          afterContent,
          content: afterContent
        }
      });
    }));

    return {
      ...turn,
      modifiedFiles: hydratedFiles,
      session: undefined
    };
  });

  app.get('/sessions/:sessionId/messages', async (request, reply) => {
    const params = sessionParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid session id', issues: params.error.issues });
    }

    const session = await prisma.session.findFirst({
      where: {
        id: params.data.sessionId,
        workspace: { deletedAt: null }
      },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        turns: {
          orderBy: { createdAt: 'asc' },
          include: {
            modifiedFiles: { orderBy: { createdAt: 'asc' } }
          }
        }
      }
    });

    if (!session) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    return {
      id: session.id,
      name: session.name,
      provider: providerFromDb(session.provider),
      messages: session.messages,
      turns: session.turns
    };
  });

  app.post('/sessions/:sessionId/turns', async (request, reply) => {
    const params = sessionParamsSchema.safeParse(request.params);

    if (!params.success) {
      return reply.code(400).send({
        error: 'Invalid turn payload',
        issues: params.error.issues
      });
    }

    const body = await parseTurnPayload(request, params.data.sessionId);

    if (!body.success) {
      return reply.code(400).send({
        error: 'Invalid turn payload',
        issues: body.issues
      });
    }

    const session = await prisma.session.findFirst({
      where: {
        id: params.data.sessionId,
        workspace: { deletedAt: null }
      },
      include: { workspace: true }
    });

    if (!session) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const corsOrigin = corsOriginForRequest(request.headers.origin);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      ...(corsOrigin ? {
        'Access-Control-Allow-Origin': corsOrigin,
        'Access-Control-Allow-Credentials': 'true',
        Vary: 'Origin'
      } : {})
    });
    reply.hijack();

    const taskTitle = await extractTaskTitle(body.prompt);

    const userMessage = await prisma.message.create({
      data: {
        sessionId: session.id,
        role: 'user',
        content: body.prompt,
        taskTitle
      }
    });
    const turn = await prisma.turn.create({
      data: {
        sessionId: session.id,
        userMessageId: userMessage.id,
        prompt: body.prompt,
        taskTitle
      }
    });

    writeSse(reply.raw, 'task_title', { title: taskTitle, turnId: turn.id });
    writeSse(reply.raw, 'message', {
      role: 'user',
      content: body.prompt,
      taskTitle,
      attachments: body.attachments.map(attachment => ({ type: attachment.type, path: attachment.path }))
    });
    writeSse(reply.raw, 'status', {
      status: 'started',
      provider: providerFromDb(session.provider),
      model: body.options.model,
      reasoningEffort: body.options.modelReasoningEffort,
      workspacePath: session.workspace.path
    });
    if (body.attachments.length > 0) {
      writeSse(reply.raw, 'status', {
        status: 'analyzing_images',
        attachmentCount: body.attachments.length,
        attachmentPaths: body.attachments.map((attachment) => attachment.path),
        model: body.options.model
      });
    }

    const beforeSnapshot = await snapshotWorkspace(session.workspace.path);
    let assistantContent = '';
    const modifiedFiles = new Map<string, { path: string; kind: 'add' | 'delete' | 'update'; beforeContent: string | null; afterContent: string | null; content: string | null }>();

    try {
      for await (const chunk of runAgentTurn(session.provider, session.id, session.workspace.path, body.prompt, body.attachments, body.options)) {
        if (chunk.type === 'file_change' && chunk.changes) {
          for (const change of chunk.changes) {
            const normalizedPath = normalizeWorkspaceFilePath(session.workspace.path, change.path);
            const beforeContent = change.kind === 'add'
              ? null
              : beforeSnapshot.get(normalizedPath) ?? await readBeforeContent(session.workspace.path, change.path);
            const afterContent = change.kind === 'delete' ? null : await readAfterContent(session.workspace.path, change.path);
            modifiedFiles.set(`${change.kind}:${normalizedPath}`, { ...change, path: normalizedPath, beforeContent, afterContent, content: afterContent });
          }
          writeSse(reply.raw, 'file_change', { turnId: turn.id, changes: chunk.changes });
        }

        if (chunk.type === 'output' && chunk.text) {
          assistantContent += chunk.text;
          writeSse(reply.raw, 'chunk', { stream: 'stdout', text: chunk.text });
        }

        if (chunk.type === 'error' && chunk.text) {
          assistantContent += chunk.text;
          writeSse(reply.raw, 'chunk', { stream: 'stderr', text: chunk.text });
        }

        if (chunk.type === 'done') {
          writeSse(reply.raw, 'status', { status: 'completed', exitCode: chunk.exitCode });
        }
      }

      if (assistantContent.trim()) {
        await prisma.message.create({
          data: {
            sessionId: session.id,
            role: 'assistant',
            content: assistantContent
          }
        });
      }
      await prisma.turn.update({
        where: { id: turn.id },
        data: {
          assistantContent: assistantContent.trim() || null,
          completedAt: new Date(),
          modifiedFiles: {
            create: [...modifiedFiles.values()].map((file) => ({
              path: file.path,
              kind: file.kind,
              content: file.content,
              beforeContent: file.beforeContent,
              afterContent: file.afterContent
            }))
          }
        }
      });

      writeSse(reply.raw, 'done', { ok: true, turnId: turn.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown agent error';
      request.log.error({
        err: error,
        sessionId: session.id,
        provider: providerFromDb(session.provider),
        attachmentCount: body.attachments.length,
        attachmentPaths: body.attachments.map((attachment) => attachment.path),
        model: body.options.model,
        reasoningEffort: body.options.modelReasoningEffort
      }, 'Agent turn failed');
      writeSse(reply.raw, 'error', { message });
    } finally {
      reply.raw.end();
    }
  });
}
