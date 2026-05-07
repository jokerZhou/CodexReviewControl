import { spawn, type ChildProcess } from 'node:child_process';
import { Codex, type ModelReasoningEffort, type ThreadEvent } from '@openai/codex-sdk';
import type { AgentProvider } from '@prisma/client';

export interface AgentChunk {
  type: 'output' | 'error' | 'done' | 'file_change';
  text?: string;
  exitCode?: number | null;
  changes?: Array<{ path: string; kind: 'add' | 'delete' | 'update' }>;
  externalSessionId?: string;
}

export interface AgentAttachment {
  type: 'local_image';
  path: string;
}

export interface CodexRunOptions {
  model: string;
  modelReasoningEffort: ModelReasoningEffort;
  imageTurnTimeoutMs: number;
}

export type AgentExecutionMode = 'default' | 'ask';

export interface AgentExplanationResult {
  text: string;
  externalSessionId?: string;
}

export interface ResearchPlannedFile {
  path: string;
  action: 'add' | 'delete' | 'update';
  reason: string;
}

export interface ResearchPlanResult {
  summary: string;
  files: ResearchPlannedFile[];
  confidence: 'low' | 'medium' | 'high';
  risks: string[];
}

export interface AgentRunController {
  signal?: AbortSignal;
  registerCancel?: (cancel: (reason?: string) => void) => void;
}

const codex = new Codex({
  env: process.env as Record<string, string>
});
const codexThreads = new Map<string, ReturnType<Codex['startThread']>>();

const formatCodexEvent = (event: ThreadEvent) => {
  switch (event.type) {
    case 'thread.started':
      return `thread ${event.thread_id} started`;
    case 'turn.started':
      return 'turn started';
    case 'turn.completed':
      return `turn completed: ${event.usage.input_tokens} input tokens, ${event.usage.output_tokens} output tokens`;
    case 'turn.failed':
      return `turn failed: ${event.error.message}`;
    case 'item.started':
    case 'item.updated':
    case 'item.completed':
      if (event.item.type === 'agent_message') return event.item.text;
      if (event.item.type === 'reasoning') return event.item.text;
      if (event.item.type === 'command_execution') {
        if (event.type !== 'item.completed' || !event.item.aggregated_output.trim()) return undefined;
        return `$ ${event.item.command}\n${event.item.aggregated_output}`;
      }
      if (event.item.type === 'file_change') {
        return `file changes: ${event.item.changes.map(change => `${change.kind} ${change.path}`).join(', ')}`;
      }
      if (event.item.type === 'error') return event.item.message;
      if (event.item.type === 'todo_list') {
        return event.item.items.map(item => `${item.completed ? '[x]' : '[ ]'} ${item.text}`).join('\n');
      }
      if (event.item.type === 'web_search') return `web search: ${event.item.query}`;
      if (event.item.type === 'mcp_tool_call') return `mcp ${event.item.server}.${event.item.tool}`;
      return undefined;
    case 'error':
      return event.message;
    default:
      return undefined;
  }
};

async function* runCodexSdkTurn(sessionId: string, workspacePath: string, prompt: string, attachments: AgentAttachment[] = [], options: CodexRunOptions, mode: AgentExecutionMode = 'default', controller?: AgentRunController): AsyncGenerator<AgentChunk> {
  const threadKey = `${sessionId}:${options.model}:${options.modelReasoningEffort}:${mode}`;
  let thread = codexThreads.get(threadKey);
  if (!thread) {
    thread = codex.startThread({
      model: options.model,
      modelReasoningEffort: options.modelReasoningEffort,
      workingDirectory: workspacePath,
      skipGitRepoCheck: true,
      sandboxMode: mode === 'ask' ? 'read-only' : 'workspace-write',
      approvalPolicy: mode === 'ask' ? 'never' : 'on-request'
    });
    codexThreads.set(threadKey, thread);
  }

  const input = attachments.length > 0
    ? [{ type: 'text' as const, text: prompt }, ...attachments]
    : prompt;
  const abortController = new AbortController();
  const handleExternalAbort = () => abortController.abort(controller?.signal?.reason ?? new Error('Agent task aborted by user.'));
  if (controller?.signal) {
    if (controller.signal.aborted) handleExternalAbort();
    else controller.signal.addEventListener('abort', handleExternalAbort, { once: true });
  }
  controller?.registerCancel?.((reason) => abortController.abort(new Error(reason || 'Agent task aborted by user.')));
  const timeout = attachments.length > 0 && options.imageTurnTimeoutMs > 0
    ? setTimeout(() => abortController.abort(new Error(`Timed out waiting for Codex image analysis after ${Math.floor(options.imageTurnTimeoutMs / 1000)} seconds.`)), options.imageTurnTimeoutMs)
    : undefined;

  try {
    const { events } = await thread.runStreamed(input, { signal: abortController.signal });
    for await (const event of events) {
      const text = formatCodexEvent(event);
      if (!text) continue;

      if (event.type === 'turn.failed' || event.type === 'error') {
        yield { type: 'error', text };
        continue;
      }

      if (event.type === 'item.completed' && event.item.type === 'file_change') {
        yield { type: 'file_change', text: `${text}\n`, changes: event.item.changes };
      }

      yield { type: 'output', text: `${text}\n` };
    }
  } catch (error) {
    const isAbort = error instanceof Error && (error.name === 'AbortError' || abortController.signal.aborted);
    if (isAbort && attachments.length > 0) {
      yield {
        type: 'error',
        text: `Codex image analysis timed out after ${Math.floor(options.imageTurnTimeoutMs / 1000)} seconds. The image upload succeeded, but the agent did not return a result in time.`
      };
      yield { type: 'done', exitCode: 1 };
      return;
    }

    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
    if (controller?.signal) controller.signal.removeEventListener('abort', handleExternalAbort);
  }

  yield { type: 'done', exitCode: 0 };
}

const researchPlanSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          action: { type: 'string', enum: ['add', 'delete', 'update'] },
          reason: { type: 'string' }
        },
        required: ['path', 'action', 'reason'],
        additionalProperties: false
      }
    },
    risks: {
      type: 'array',
      items: { type: 'string' }
    }
  },
  required: ['summary', 'confidence', 'files', 'risks'],
  additionalProperties: false
} as const;

const parseResearchPlan = (raw: string): ResearchPlanResult => {
  const parsed = JSON.parse(raw) as Partial<ResearchPlanResult>;
  const files = Array.isArray(parsed.files)
    ? parsed.files
      .filter((file): file is ResearchPlannedFile => (
        !!file &&
        typeof file.path === 'string' &&
        (file.action === 'add' || file.action === 'delete' || file.action === 'update') &&
        typeof file.reason === 'string'
      ))
      .map((file) => ({
        path: file.path.replace(/\\/g, '/').replace(/^\/+/, '').trim(),
        action: file.action,
        reason: file.reason.trim() || 'Codex 预计该文件与本次任务相关。'
      }))
      .filter((file) => file.path && !file.path.includes('..'))
    : [];

  return {
    summary: typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim() : 'Codex 已完成本次修改调研。',
    confidence: parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low' ? parsed.confidence : 'low',
    files: [...new Map(files.map((file) => [file.path, file])).values()],
    risks: Array.isArray(parsed.risks)
      ? parsed.risks.filter((risk): risk is string => typeof risk === 'string').map((risk) => risk.trim()).filter(Boolean)
      : []
  };
};

export const runCodexResearchPlan = async (workspacePath: string, prompt: string, knownFiles: string[], options: CodexRunOptions): Promise<ResearchPlanResult> => {
  const thread = codex.startThread({
    model: options.model,
    modelReasoningEffort: options.modelReasoningEffort === 'minimal' || options.modelReasoningEffort === 'low' || options.modelReasoningEffort === 'medium'
      ? 'high'
      : options.modelReasoningEffort,
    workingDirectory: workspacePath,
    skipGitRepoCheck: true,
    sandboxMode: 'read-only',
    approvalPolicy: 'never'
  });

  const researchPrompt = [
    '你是 Codex 的执行前代码调研器。你的目标是尽量准确预测：如果稍后真正执行用户需求，哪些文件会被新增、删除或修改。',
    '严格要求：',
    '- 只做调研，绝对不要修改文件。',
    '- 可以执行只读命令，例如 pwd、ls、find、rg、sed、cat、git status、git diff --name-only。',
    '- 不要执行任何会改变工作区、安装依赖、格式化、生成代码、写文件、删除文件的命令。',
    '- 在输出 JSON 前，必须先用只读命令实际检查代码结构，而不是只根据文件名列表猜测。',
    '- 必须定位和用户需求相关的入口文件、组件/模块定义、调用方、路由/状态/样式/类型/测试/配置等可能联动的文件。',
    '- 如果需求涉及 UI 交互，必须检查组件定义、使用处、状态流和样式文件。',
    '- 如果需求涉及后端/API/数据库，必须检查路由、服务、schema/model、调用方和类型定义。',
    '- 如果某文件只是被读取但不需要修改，不要列入 files。',
    '- 对需要新增的文件，给出预计相对路径；对不确定路径，在 risks 里说明，不要乱列。',
    '- 只返回 JSON，必须符合 schema。',
    '- files 只列预计会被新增、删除或修改的文件，路径必须相对 workspace 根目录。',
    '- 宁可少列不确定文件，也不要把明显无关的文件列进去；但必须覆盖完成任务通常必改的核心文件。',
    '- 如果无法判断具体文件，files 返回空数组，并在 risks 中说明还需要先读哪些代码。',
    '- reason 用中文说明为什么预计会改这个文件。',
    '- summary 用中文说明你基于哪些代码位置做出判断。',
    '',
    '当前 workspace 可见文件列表：',
    knownFiles.slice(0, 2000).join('\n') || '(没有可见文件)',
    '',
    '用户需求：',
    prompt
  ].join('\n');

  const turn = await thread.run(researchPrompt, { outputSchema: researchPlanSchema });
  return parseResearchPlan(turn.finalResponse);
};

const terminateChild = (child: ChildProcess) => {
  if (child.killed || child.exitCode !== null) return;
  child.kill('SIGINT');
  setTimeout(() => {
    if (!child.killed && child.exitCode === null) child.kill('SIGKILL');
  }, 1500).unref();
};

async function* runCursorCliTurn(workspacePath: string, prompt: string, controller?: AgentRunController): AsyncGenerator<AgentChunk> {
  const child = spawn('cursor-agent', ['-p', '--output-format', 'stream-json', prompt], {
    cwd: workspacePath,
    env: process.env,
    shell: false
  });
  const handleExternalAbort = () => terminateChild(child);
  if (controller?.signal) {
    if (controller.signal.aborted) handleExternalAbort();
    else controller.signal.addEventListener('abort', handleExternalAbort, { once: true });
  }
  controller?.registerCancel?.(() => terminateChild(child));

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  const queue: AgentChunk[] = [];
  let notify: (() => void) | undefined;
  let closed = false;

  const push = (chunk: AgentChunk) => {
    queue.push(chunk);
    notify?.();
    notify = undefined;
  };

  child.stdout.on('data', (data: string) => push({ type: 'output', text: data }));
  child.stderr.on('data', (data: string) => push({ type: 'error', text: data }));
  child.on('error', (error) => {
    push({ type: 'error', text: `cursor-agent failed to start: ${error.message}` });
    closed = true;
    push({ type: 'done', exitCode: 1 });
  });
  child.on('close', (exitCode) => {
    closed = true;
    push({ type: 'done', exitCode });
  });

  while (!closed || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
      continue;
    }

    const chunk = queue.shift();
    if (chunk) {
      yield chunk;
    }
  }
  if (controller?.signal) controller.signal.removeEventListener('abort', handleExternalAbort);
}

const extractStringField = (value: unknown, keys: string[]): string | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const field = record[key];
    if (typeof field === 'string' && field.trim()) return field;
  }
  for (const field of Object.values(record)) {
    const nested = extractStringField(field, keys);
    if (nested) return nested;
  }
  return undefined;
};

const formatCodexCliEvent = (event: unknown) => {
  if (!event || typeof event !== 'object') return undefined;
  const record = event as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type : undefined;
  const message = extractStringField(record, ['message', 'text', 'content', 'summary', 'command', 'aggregated_output']);
  if (!type && !message) return undefined;
  return message ? `[${type ?? 'event'}] ${message}` : `[${type}]`;
};

async function* runCodexCliTurn(sessionExternalId: string | null | undefined, workspacePath: string, prompt: string, attachments: AgentAttachment[] = [], options: CodexRunOptions, controller?: AgentRunController): AsyncGenerator<AgentChunk> {
  const args = sessionExternalId
    ? ['exec', 'resume', '--json', '--skip-git-repo-check', '-m', options.model]
    : ['exec', '--json', '--skip-git-repo-check', '-C', workspacePath, '-m', options.model, '-s', 'workspace-write'];

  for (const attachment of attachments) {
    args.push('-i', attachment.path);
  }
  if (sessionExternalId) {
    args.push(sessionExternalId);
  }
  args.push(prompt);

  const child = spawn('codex', args, {
    cwd: workspacePath,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false
  });
  const handleExternalAbort = () => terminateChild(child);
  if (controller?.signal) {
    if (controller.signal.aborted) handleExternalAbort();
    else controller.signal.addEventListener('abort', handleExternalAbort, { once: true });
  }
  controller?.registerCancel?.(() => terminateChild(child));

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  const queue: AgentChunk[] = [];
  let notify: (() => void) | undefined;
  let closed = false;
  let stdoutBuffer = '';
  let discoveredSessionId: string | undefined;

  const push = (chunk: AgentChunk) => {
    queue.push(chunk);
    notify?.();
    notify = undefined;
  };

  const handleJsonLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const event = JSON.parse(trimmed) as unknown;
      const eventSessionId = extractStringField(event, ['thread_id', 'session_id', 'conversation_id']);
      if (eventSessionId && eventSessionId !== discoveredSessionId) {
        discoveredSessionId = eventSessionId;
        push({ type: 'output', text: `[session] ${eventSessionId}\n`, externalSessionId: eventSessionId });
      }
      const text = formatCodexCliEvent(event);
      if (text) push({ type: 'output', text: `${text}\n` });
    } catch {
      push({ type: 'output', text: `${line}\n` });
    }
  };

  child.stdout.on('data', (data: string) => {
    stdoutBuffer += data;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? '';
    lines.forEach(handleJsonLine);
  });
  child.stderr.on('data', (data: string) => push({ type: 'error', text: data }));
  child.on('error', (error) => {
    push({ type: 'error', text: `codex CLI failed to start: ${error.message}` });
    closed = true;
    push({ type: 'done', exitCode: 1 });
  });
  child.on('close', (exitCode) => {
    if (stdoutBuffer.trim()) {
      handleJsonLine(stdoutBuffer);
      stdoutBuffer = '';
    }
    closed = true;
    push({ type: 'done', exitCode });
  });

  while (!closed || queue.length > 0) {
    if (queue.length === 0) {
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
      continue;
    }

    const chunk = queue.shift();
    if (chunk) {
      yield chunk;
    }
  }
  if (controller?.signal) controller.signal.removeEventListener('abort', handleExternalAbort);
}

export async function* runAgentTurn(provider: AgentProvider, sessionId: string, sessionExternalId: string | null | undefined, workspacePath: string, prompt: string, attachments: AgentAttachment[] = [], options: CodexRunOptions, mode: AgentExecutionMode = 'default', controller?: AgentRunController): AsyncGenerator<AgentChunk> {
  if (provider === 'CODEX') {
    yield* runCodexSdkTurn(sessionId, workspacePath, prompt, attachments, options, mode, controller);
    return;
  }

  if (provider === 'CODEX_CLI') {
    yield* runCodexCliTurn(sessionExternalId, workspacePath, prompt, attachments, options, controller);
    return;
  }

  yield* runCursorCliTurn(workspacePath, prompt, controller);
}

export const runAgentExplanation = async (provider: AgentProvider, sessionId: string, sessionExternalId: string | null | undefined, workspacePath: string, prompt: string, options: CodexRunOptions): Promise<AgentExplanationResult> => {
  if (provider !== 'CODEX' && provider !== 'CODEX_CLI') {
    throw new Error('Change explanation is only available for Codex sessions.');
  }

  let text = '';
  let externalSessionId: string | undefined;

  for await (const chunk of runAgentTurn(provider, sessionId, sessionExternalId, workspacePath, prompt, [], options)) {
    if (chunk.externalSessionId) {
      externalSessionId = chunk.externalSessionId;
    }
    if ((chunk.type === 'output' || chunk.type === 'error') && chunk.text) {
      text += chunk.text;
    }
  }

  return {
    text: text.trim(),
    externalSessionId
  };
};
