import { spawn } from 'node:child_process';
import { Codex, type ModelReasoningEffort, type ThreadEvent } from '@openai/codex-sdk';
import type { AgentProvider } from '@prisma/client';

export interface AgentChunk {
  type: 'output' | 'error' | 'done' | 'file_change';
  text?: string;
  exitCode?: number | null;
  changes?: Array<{ path: string; kind: 'add' | 'delete' | 'update' }>;
}

export interface AgentAttachment {
  type: 'local_image';
  path: string;
}

export interface CodexRunOptions {
  model: string;
  modelReasoningEffort: ModelReasoningEffort;
}

const codex = new Codex({
  env: process.env as Record<string, string>
});
const codexThreads = new Map<string, ReturnType<Codex['startThread']>>();
const imageTurnTimeoutMs = 90_000;

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
  const timeout = attachments.length > 0
    ? setTimeout(() => abortController.abort(new Error(`Timed out waiting for Codex image analysis after ${Math.floor(imageTurnTimeoutMs / 1000)} seconds.`)), imageTurnTimeoutMs)
    : undefined;
  const { events } = await thread.runStreamed(input, { signal: abortController.signal });

  try {
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
        text: `Codex image analysis timed out after ${Math.floor(imageTurnTimeoutMs / 1000)} seconds. The image upload succeeded, but the agent did not return a result in time.`
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

export async function* runAgentTurn(provider: AgentProvider, sessionId: string, workspacePath: string, prompt: string, attachments: AgentAttachment[] = [], options: CodexRunOptions): AsyncGenerator<AgentChunk> {
  if (provider === 'CODEX') {
    yield* runCodexSdkTurn(sessionId, workspacePath, prompt, attachments, options);
    return;
  }

  yield* runCursorCliTurn(workspacePath, prompt);
}
