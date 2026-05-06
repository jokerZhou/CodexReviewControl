import os from 'node:os';
import type { FastifyInstance } from 'fastify';
import { spawn } from 'node-pty';
import { z } from 'zod';
import { AgentProvider } from '../../node_modules/.prisma/workspace-client/index.js';
import { findSessionContext } from '../db/workspace-prisma.js';
import { loadCodexOptions } from '../services/codex-options.js';
import { extractTaskTitle } from '../services/task-title.js';
import { diffWorkspaceSnapshots, snapshotWorkspace } from './sessions.js';

const terminalParamsSchema = z.object({
  sessionId: z.string().min(1)
});

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
const stripAnsi = (value: string) => value.replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g, '');
const hasWorkedForMarker = (value: string) => /(?:^|\n|\r)\s*(?:─|[-—])\s*Worked for\s+\S+/i.test(value);
const PTY_SCROLLBACK_LIMIT = 12000;

interface PendingTerminalTurn {
  turnId: string;
  beforeSnapshot: Map<string, string>;
  output: string;
  startedAt: number;
}

type SessionContext = NonNullable<Awaited<ReturnType<typeof findSessionContext>>>;

interface PtySessionState {
  pty: ReturnType<typeof spawn>;
  outputBuffer: string[];
  sockets: Set<{ send: (data: string) => void }>;
  disposeData: () => void;
  disposeExit: () => void;
  inputBuffer: string;
  cleanOutputBuffer: string;
  pendingTurn: PendingTerminalTurn | null;
  lastFinalizeAt: number;
  isFinalizing: boolean;
  provider: AgentProvider;
  workspacePath: string;
  sessionId: string;
  db: Awaited<ReturnType<typeof findSessionContext>> extends infer T ? T extends { db: infer D } ? D : never : never;
}

const ptySessions = new Map<string, PtySessionState>();

const resolveShell = () => {
  if (process.platform === 'win32') {
    const configured = process.env.REVIEWDOCK_WINDOWS_SHELL;
    if (configured && configured.trim().length > 0) {
      return { command: configured, args: [] as string[] };
    }
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    const powershell = `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    return { command: powershell, args: ['-NoLogo'] };
  }

  const shell = process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');
  return { command: shell, args: ['-l'] };
};

const pushOutput = (state: PtySessionState, data: string) => {
  if (!data) return;
  state.outputBuffer.push(data);
  if (state.outputBuffer.length > PTY_SCROLLBACK_LIMIT) {
    state.outputBuffer.splice(0, state.outputBuffer.length - PTY_SCROLLBACK_LIMIT);
  }
  const payload = JSON.stringify({ type: 'output', data });
  for (const socket of state.sockets) socket.send(payload);
};

const finalizePendingTurn = async (state: PtySessionState) => {
  if (!state.pendingTurn || state.isFinalizing || state.provider !== AgentProvider.CODEX_CLI) return;
  state.isFinalizing = true;
  const currentTurn = state.pendingTurn;
  state.pendingTurn = null;
  state.lastFinalizeAt = Date.now();

  try {
    const changes = await diffWorkspaceSnapshots(state.workspacePath, currentTurn.beforeSnapshot);
    await state.db.turn.update({
      where: { id: currentTurn.turnId },
      data: {
        assistantContent: stripAnsi(currentTurn.output).trim() || null,
        completedAt: new Date(),
        modifiedFiles: {
          create: changes.map((change) => ({
            path: change.path,
            kind: change.kind,
            content: change.content,
            beforeContent: change.beforeContent,
            afterContent: change.afterContent
          }))
        }
      }
    });
    const payload = JSON.stringify({ type: 'turn_completed', turnId: currentTurn.turnId });
    for (const socket of state.sockets) socket.send(payload);
  } finally {
    state.isFinalizing = false;
  }
};

const beginCodexCliTurn = async (state: PtySessionState, prompt: string) => {
  const trimmedPrompt = prompt.trim();
  if (!trimmedPrompt || trimmedPrompt.startsWith('/')) return;

  await finalizePendingTurn(state);
  const taskTitle = await extractTaskTitle(trimmedPrompt);
  const beforeSnapshot = await snapshotWorkspace(state.workspacePath);
  const userMessage = await state.db.message.create({
    data: {
      sessionId: state.sessionId,
      role: 'user',
      content: trimmedPrompt,
      taskTitle
    }
  });
  const turn = await state.db.turn.create({
    data: {
      sessionId: state.sessionId,
      userMessageId: userMessage.id,
      prompt: trimmedPrompt,
      taskTitle
    }
  });
  state.pendingTurn = {
    turnId: turn.id,
    beforeSnapshot,
    output: '',
    startedAt: Date.now()
  };
  const payload = JSON.stringify({
    type: 'turn_started',
    turnId: turn.id,
    taskTitle,
    prompt: trimmedPrompt,
    startedAt: state.pendingTurn.startedAt
  });
  for (const socket of state.sockets) socket.send(payload);
  state.cleanOutputBuffer = '';
};

const createTerminalCommand = async (context: SessionContext) => {
  const session = context.session!;
  if (session.provider === AgentProvider.CODEX_CLI) {
    const codexOptions = await loadCodexOptions();
    const args = [
      '--cd', context.workspace.path,
      '--sandbox', 'workspace-write',
      '--ask-for-approval', 'on-request',
      '--model', codexOptions.defaults.model
    ];
    return {
      command: '/bin/zsh',
      args: ['-lc', `exec /usr/local/bin/codex ${args.map(shellQuote).join(' ')}`],
      env: {
        ...process.env,
        TERM: 'xterm-256color'
      } as Record<string, string>
    };
  }

  const shell = resolveShell();
  return {
    command: shell.command,
    args: shell.args,
    env: {
      ...process.env,
      TERM: process.platform === 'win32' ? process.env.TERM || 'xterm-256color' : 'xterm-256color'
    } as Record<string, string>
  };
};

const createPtySession = async (context: SessionContext) => {
  const session = context.session!;
  const terminalCommand = await createTerminalCommand(context);
  const pty = spawn(terminalCommand.command, terminalCommand.args, {
    name: 'xterm-256color',
    cols: 120,
    rows: 32,
    cwd: context.workspace.path,
    env: terminalCommand.env
  });

  const state: PtySessionState = {
    pty,
    outputBuffer: [],
    sockets: new Set(),
    disposeData: () => undefined,
    disposeExit: () => undefined,
    inputBuffer: '',
    cleanOutputBuffer: '',
    pendingTurn: null,
    lastFinalizeAt: 0,
    isFinalizing: false,
    provider: session.provider,
    workspacePath: context.workspace.path,
    sessionId: session.id,
    db: context.db
  };

  const dataDisposable = pty.onData((data) => {
    if (state.provider === AgentProvider.CODEX_CLI && state.pendingTurn) {
      state.pendingTurn.output += data;
      state.cleanOutputBuffer = `${state.cleanOutputBuffer}${stripAnsi(data)}`.slice(-2000);
      if (hasWorkedForMarker(state.cleanOutputBuffer)) {
        state.cleanOutputBuffer = '';
        finalizePendingTurn(state).catch(() => undefined);
      }
    }
    pushOutput(state, data);
  });

  const exitDisposable = pty.onExit(async ({ exitCode }) => {
    await finalizePendingTurn(state);
    const payload = JSON.stringify({ type: 'exit', exitCode });
    for (const socket of state.sockets) socket.send(payload);
    ptySessions.delete(session.id);
  });

  state.disposeData = () => dataDisposable.dispose();
  state.disposeExit = () => exitDisposable.dispose();
  ptySessions.set(session.id, state);
  return state;
};

export async function registerTerminalRoutes(app: FastifyInstance) {
  app.get('/sessions/:sessionId/terminal', { websocket: true }, async (socket, request) => {
    const params = terminalParamsSchema.safeParse(request.params);
    if (!params.success) {
      socket.close(1008, 'Invalid session id');
      return;
    }

    const rawContext = await findSessionContext(params.data.sessionId);
    if (!rawContext?.session) {
      socket.close(1008, 'Session not found');
      return;
    }
    const context = rawContext as SessionContext;
    const session = context.session!;

    if (session.provider !== AgentProvider.CODEX_CLI && session.provider !== AgentProvider.TERMINAL) {
      socket.close(1008, 'Interactive terminal is only available for Codex CLI and Terminal sessions');
      return;
    }

    let state = ptySessions.get(session.id);

    try {
      if (!state) state = await createPtySession(context);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start terminal';
      socket.send(JSON.stringify({
        type: 'output',
        data: `\r\n[terminal failed: ${message}]\r\nPlatform: ${os.platform()}\r\n`
      }));
      socket.close(1011, message);
      return;
    }

    state.sockets.add(socket);

    if (state.outputBuffer.length > 0) {
      socket.send(JSON.stringify({
        type: 'output',
        data: state.outputBuffer.join('')
      }));
    } else if (state.provider === AgentProvider.TERMINAL) {
      socket.send(JSON.stringify({
        type: 'output',
        data: `\r\n[attached to persistent terminal]\r\nWorking directory: ${state.workspacePath}\r\n`
      }));
    }

    socket.on('message', (raw: Buffer) => {
      try {
        const message = JSON.parse(String(raw)) as { type?: string; data?: string; cols?: number; rows?: number };
        if (message.type === 'input' && typeof message.data === 'string') {
          if (state.provider === AgentProvider.CODEX_CLI) {
            for (const char of message.data) {
              if (char === '\r' || char === '\n') {
                const prompt = state.inputBuffer;
                state.inputBuffer = '';
                beginCodexCliTurn(state, prompt).catch(() => undefined);
                continue;
              }
              if (char === '\u007f' || char === '\b') {
                state.inputBuffer = state.inputBuffer.slice(0, -1);
                continue;
              }
              if (char >= ' ') {
                state.inputBuffer += char;
              }
            }
          }
          state.pty.write(message.data);
        }
        if (message.type === 'resize' && typeof message.cols === 'number' && typeof message.rows === 'number') {
          state.pty.resize(message.cols, message.rows);
        }
      } catch {
        // Ignore malformed terminal frames.
      }
    });

    socket.on('close', () => {
      state.sockets.delete(socket);
      if (state.provider === AgentProvider.CODEX_CLI && state.sockets.size === 0) {
        state.disposeData();
        state.disposeExit();
        state.pty.kill();
        if (state.pendingTurn && Date.now() - state.lastFinalizeAt > 1000) {
          finalizePendingTurn(state).catch(() => undefined);
        }
        ptySessions.delete(state.sessionId);
      }
    });
  });
}
