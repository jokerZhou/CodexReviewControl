import { AgentProvider } from '../../node_modules/.prisma/workspace-client/index.js';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { execFile as execFileCallback } from 'node:child_process';
import { createWriteStream, type Dirent } from 'node:fs';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { runAgentExplanation, runAgentTurn, type AgentAttachment, type CodexRunOptions } from '../agents/providers.js';
import { findSessionContext, findTurnContext, workspaceUploadsDir } from '../db/workspace-prisma.js';
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

const changeKindSchema = z.enum(['add', 'delete', 'update']);

const explainChangeSchema = z.object({
  filePath: z.string().min(1),
  groupId: z.string().min(1),
  changeKind: changeKindSchema,
  beforeText: z.string().optional().default(''),
  afterText: z.string().optional().default('')
});

const saveChangeNoteSchema = z.object({
  filePath: z.string().min(1),
  groupId: z.string().min(1),
  note: z.string().default(''),
  reviewed: z.boolean().default(false)
});

const allowedImageMimeTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const imageExtensions: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp'
};
const maxImageAttachments = 5;
const maxSnapshotFileBytes = 1024 * 1024;
const ignoredSnapshotDirs = new Set([
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

const providerFromDb = (provider: AgentProvider) => provider === AgentProvider.CODEX_CLI ? 'codex-cli' : provider.toLowerCase();

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

export const snapshotWorkspace = async (workspacePath: string) => {
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

export const diffWorkspaceSnapshots = async (workspacePath: string, beforeSnapshot: Map<string, string>) => {
  const afterSnapshot = await snapshotWorkspace(workspacePath);
  const paths = new Set([...beforeSnapshot.keys(), ...afterSnapshot.keys()]);
  const changes: Array<{ path: string; kind: 'add' | 'delete' | 'update'; beforeContent: string | null; afterContent: string | null; content: string | null }> = [];

  for (const path of [...paths].sort()) {
    const beforeContent = beforeSnapshot.get(path);
    const afterContent = afterSnapshot.get(path);
    if (beforeContent === afterContent) continue;

    changes.push({
      path,
      kind: beforeContent === undefined ? 'add' : afterContent === undefined ? 'delete' : 'update',
      beforeContent: beforeContent ?? null,
      afterContent: afterContent ?? null,
      content: afterContent ?? null
    });
  }

  return changes;
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

const parseTurnPayload = async (request: FastifyRequest, workspacePath: string, sessionId: string) => {
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

  const uploadDir = join(workspaceUploadsDir(workspacePath), 'sessions', sessionId);
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

const cleanExplanationText = (text: string) => {
  const lines = text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => !line.startsWith('['))
    .filter(line => !line.startsWith('thread '))
    .filter(line => !line.startsWith('turn '));

  return (lines.join('\n') || text).replace(/^["'“”]+|["'“”]+$/g, '').trim();
};

const buildChangeExplanationPrompt = (turn: { prompt: string; taskTitle: string | null }, body: z.infer<typeof explainChangeSchema>) => {
  return [
    '你是代码审核助手。请解释下面这个代码修改块为什么需要修改、修改目的是什么。',
    '严格要求：',
    '- 只解释这个修改块，不要修改任何文件，不要执行命令。',
    '- 输出中文，控制在 2 到 4 句话。',
    '- 直接输出备注内容，不要 Markdown，不要标题，不要代码块。',
    '',
    `任务标题：${turn.taskTitle || '未命名任务'}`,
    `用户原始需求：${turn.prompt}`,
    `文件：${body.filePath}`,
    `修改类型：${body.changeKind}`,
    '',
    '修改前：',
    body.beforeText || '(无)',
    '',
    '修改后：',
    body.afterText || '(无)'
  ].join('\n');
};

export async function registerSessionRoutes(app: FastifyInstance) {
  app.get('/turns/:turnId', async (request, reply) => {
    const params = turnParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid turn id', issues: params.error.issues });
    }

    const context = await findTurnContext(params.data.turnId);

    if (!context?.turn) {
      return reply.code(404).send({ error: 'Turn not found' });
    }

    const turn = await context.db.turn.findFirst({
      where: { id: params.data.turnId },
      include: {
        modifiedFiles: { orderBy: { createdAt: 'asc' } },
        reviewNotes: { orderBy: { updatedAt: 'asc' } },
        session: true
      }
    });

    if (!turn) {
      return reply.code(404).send({ error: 'Turn not found' });
    }

    const hydratedFiles = await Promise.all(turn.modifiedFiles.map(async (file) => {
      if (file.beforeContent !== null || file.afterContent !== null) return file;

      const beforeContent = file.kind === 'add' ? null : await readBeforeContent(context.workspace.path, file.path);
      const afterContent = file.kind === 'delete' ? null : await readAfterContent(context.workspace.path, file.path);
      if (beforeContent === null && afterContent === null) return file;

      return context.db.modifiedFile.update({
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
      reviewNotes: turn.reviewNotes,
      session: undefined
    };
  });

  app.post('/turns/:turnId/changes/explain', async (request, reply) => {
    const params = turnParamsSchema.safeParse(request.params);
    const body = explainChangeSchema.safeParse(request.body);

    if (!params.success || !body.success) {
      return reply.code(400).send({
        error: 'Invalid change explanation payload',
        issues: [...(params.success ? [] : params.error.issues), ...(body.success ? [] : body.error.issues)]
      });
    }

    const context = await findTurnContext(params.data.turnId);
    const turn = context?.turn;

    if (!turn) {
      return reply.code(404).send({ error: 'Turn not found' });
    }

    if (turn.session.provider !== AgentProvider.CODEX && turn.session.provider !== AgentProvider.CODEX_CLI) {
      return reply.code(400).send({ error: 'Change explanation is only available for Codex sessions.' });
    }

    if (!context.workspace.path || !resolveWorkspaceFilePath(context.workspace.path, body.data.filePath)) {
      return reply.code(400).send({ error: 'Invalid file path' });
    }

    try {
      const options = await resolveCodexRunOptions(undefined, undefined);
      const prompt = buildChangeExplanationPrompt(turn, body.data);
      const explanation = await runAgentExplanation(
        turn.session.provider,
        turn.session.id,
        turn.session.externalSessionId,
        context.workspace.path,
        prompt,
        options
      );

      if (explanation.externalSessionId && explanation.externalSessionId !== turn.session.externalSessionId) {
        await context.db.session.update({
          where: { id: turn.session.id },
          data: { externalSessionId: explanation.externalSessionId }
        });
      }

      const note = cleanExplanationText(explanation.text);

      await context.db.reviewChangeNote.upsert({
        where: {
          turnId_filePath_groupId: {
            turnId: turn.id,
            filePath: body.data.filePath,
            groupId: body.data.groupId
          }
        },
        update: { note },
        create: {
          turnId: turn.id,
          filePath: body.data.filePath,
          groupId: body.data.groupId,
          note
        }
      });

      return { explanation: note };
    } catch (error) {
      request.log.error({
        err: error,
        turnId: turn.id,
        sessionId: turn.session.id,
        provider: providerFromDb(turn.session.provider),
        filePath: body.data.filePath,
        groupId: body.data.groupId
      }, 'Change explanation failed');

      const message = error instanceof Error ? error.message : 'Change explanation failed';
      return reply.code(502).send({ error: message });
    }
  });

  app.patch('/turns/:turnId/change-notes', async (request, reply) => {
    const params = turnParamsSchema.safeParse(request.params);
    const body = saveChangeNoteSchema.safeParse(request.body);

    if (!params.success || !body.success) {
      return reply.code(400).send({
        error: 'Invalid change note payload',
        issues: [...(params.success ? [] : params.error.issues), ...(body.success ? [] : body.error.issues)]
      });
    }

    const context = await findTurnContext(params.data.turnId);
    const turn = context?.turn;

    if (!turn) {
      return reply.code(404).send({ error: 'Turn not found' });
    }

    const note = await context.db.reviewChangeNote.upsert({
      where: {
        turnId_filePath_groupId: {
          turnId: turn.id,
          filePath: body.data.filePath,
          groupId: body.data.groupId
        }
      },
      update: {
        note: body.data.note,
        reviewed: body.data.reviewed
      },
      create: {
        turnId: turn.id,
        filePath: body.data.filePath,
        groupId: body.data.groupId,
        note: body.data.note,
        reviewed: body.data.reviewed
      }
    });

    return { note };
  });

  app.get('/sessions/:sessionId/messages', async (request, reply) => {
    const params = sessionParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: 'Invalid session id', issues: params.error.issues });
    }

    const context = await findSessionContext(params.data.sessionId);
    if (!context?.session) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const session = await context.db.session.findFirst({
      where: { id: params.data.sessionId, deletedAt: null },
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

    const context = await findSessionContext(params.data.sessionId);
    const session = context?.session;
    if (!session) {
      return reply.code(404).send({ error: 'Session not found' });
    }

    const body = await parseTurnPayload(request, context.workspace.path, params.data.sessionId);

    if (!body.success) {
      return reply.code(400).send({
        error: 'Invalid turn payload',
        issues: body.issues
      });
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

    const userMessage = await context.db.message.create({
      data: {
        sessionId: session.id,
        role: 'user',
        content: body.prompt,
        taskTitle
      }
    });
    const turn = await context.db.turn.create({
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
      workspacePath: context.workspace.path
    });
    if (body.attachments.length > 0) {
      writeSse(reply.raw, 'status', {
        status: 'analyzing_images',
        attachmentCount: body.attachments.length,
        attachmentPaths: body.attachments.map((attachment) => attachment.path),
        model: body.options.model,
        timeoutSeconds: body.options.imageTurnTimeoutMs > 0 ? Math.floor(body.options.imageTurnTimeoutMs / 1000) : null
      });
    }

    const beforeSnapshot = await snapshotWorkspace(context.workspace.path);
    let assistantContent = '';
    const modifiedFiles = new Map<string, { path: string; kind: 'add' | 'delete' | 'update'; beforeContent: string | null; afterContent: string | null; content: string | null }>();

    try {
      for await (const chunk of runAgentTurn(session.provider, session.id, session.externalSessionId, context.workspace.path, body.prompt, body.attachments, body.options)) {
        if (chunk.externalSessionId && chunk.externalSessionId !== session.externalSessionId) {
          await context.db.session.update({
            where: { id: session.id },
            data: { externalSessionId: chunk.externalSessionId }
          });
          session.externalSessionId = chunk.externalSessionId;
        }

        if (chunk.type === 'file_change' && chunk.changes) {
          for (const change of chunk.changes) {
            const normalizedPath = normalizeWorkspaceFilePath(context.workspace.path, change.path);
            const beforeContent = change.kind === 'add'
              ? null
              : beforeSnapshot.get(normalizedPath) ?? await readBeforeContent(context.workspace.path, change.path);
            const afterContent = change.kind === 'delete' ? null : await readAfterContent(context.workspace.path, change.path);
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

      if (session.provider === AgentProvider.CODEX_CLI && modifiedFiles.size === 0) {
        const snapshotChanges = await diffWorkspaceSnapshots(context.workspace.path, beforeSnapshot);
        for (const change of snapshotChanges) {
          modifiedFiles.set(`${change.kind}:${change.path}`, change);
        }
        if (snapshotChanges.length > 0) {
          writeSse(reply.raw, 'file_change', {
            turnId: turn.id,
            changes: snapshotChanges.map(({ path, kind }) => ({ path, kind }))
          });
        }
      }

      if (assistantContent.trim()) {
        await context.db.message.create({
          data: {
            sessionId: session.id,
            role: 'assistant',
            content: assistantContent
          }
        });
      }
      await context.db.turn.update({
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
