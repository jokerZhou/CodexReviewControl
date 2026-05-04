import { spawn } from 'node:child_process';
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

export interface AgentExplanationResult {
  text: string;
  externalSessionId?: string;
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

async function* runCodexSdkTurn(sessionId: string, workspacePath: string, prompt: string, attachments: AgentAttachment[] = [], options: CodexRunOptions): AsyncGenerator<AgentChunk> {
  const threadKey = `${sessionId}:${options.model}:${options.modelReasoningEffort}`;
  let thread = codexThreads.get(threadKey);
  if (!thread) {
    thread = codex.startThread({
      model: options.model,
      modelReasoningEffort: options.modelReasoningEffort,
      workingDirectory: workspacePath,
      skipGitRepoCheck: true,
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request'
    });
    codexThreads.set(threadKey, thread);
  }

  const input = attachments.length > 0
    ? [{ type: 'text' as const, text: prompt }, ...attachments]
    : prompt;
  const abortController = new AbortController();
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
  }

  yield { type: 'done', exitCode: 0 };
}

async function* runCursorCliTurn(workspacePath: string, prompt: string): AsyncGenerator<AgentChunk> {
  const child = spawn('cursor-agent', ['-p', '--output-format', 'stream-json', prompt], {
    cwd: workspacePath,
    env: process.env,
    shell: false
  });

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

async function* runCodexCliTurn(sessionExternalId: string | null | undefined, workspacePath: string, prompt: string, attachments: AgentAttachment[] = [], options: CodexRunOptions): AsyncGenerator<AgentChunk> {
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
}

export async function* runAgentTurn(provider: AgentProvider, sessionId: string, sessionExternalId: string | null | undefined, workspacePath: string, prompt: string, attachments: AgentAttachment[] = [], options: CodexRunOptions): AsyncGenerator<AgentChunk> {
  if (provider === 'CODEX') {
    yield* runCodexSdkTurn(sessionId, workspacePath, prompt, attachments, options);
    return;
  }

  if (provider === 'CODEX_CLI') {
    yield* runCodexCliTurn(sessionExternalId, workspacePath, prompt, attachments, options);
    return;
  }

  yield* runCursorCliTurn(workspacePath, prompt);
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
