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

interface PendingTerminalTurn {
  turnId: string;
  beforeSnapshot: Map<string, string>;
  output: string;
  startedAt: number;
}

export async function registerTerminalRoutes(app: FastifyInstance) {
  app.get('/sessions/:sessionId/terminal', { websocket: true }, async (socket, request) => {
    const params = terminalParamsSchema.safeParse(request.params);
    if (!params.success) {
      socket.close(1008, 'Invalid session id');
      return;
    }

    const context = await findSessionContext(params.data.sessionId);
    const session = context?.session;

    if (!session || session.provider !== AgentProvider.CODEX_CLI) {
      socket.close(1008, 'Codex CLI session not found');
      return;
    }

    const codexOptions = await loadCodexOptions();
    const args = [
      '--cd', context.workspace.path,
      '--sandbox', 'workspace-write',
      '--ask-for-approval', 'on-request',
      '--model', codexOptions.defaults.model
    ];

    const command = `exec /usr/local/bin/codex ${args.map(shellQuote).join(' ')}`;
    let pty: ReturnType<typeof spawn>;

    try {
      pty = spawn('/bin/zsh', ['-lc', command], {
        name: 'xterm-256color',
        cols: 120,
        rows: 32,
        cwd: context.workspace.path,
        env: {
          ...process.env,
          TERM: 'xterm-256color'
        } as Record<string, string>
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to start terminal';
      socket.send(JSON.stringify({
        type: 'output',
        data: `\r\n[terminal failed: ${message}]\r\nRun in backend: npx node-gyp rebuild inside node_modules/.pnpm/node-pty@1.1.0/node_modules/node-pty\r\n`
      }));
      socket.close(1011, message);
      return;
    }

    let inputBuffer = '';
    let cleanOutputBuffer = '';
    let pendingTurn: PendingTerminalTurn | null = null;
    let lastFinalizeAt = 0;
    let isFinalizing = false;

    const finalizePendingTurn = async () => {
      if (!pendingTurn || isFinalizing) return;
      isFinalizing = true;
      const currentTurn = pendingTurn;
      pendingTurn = null;
      lastFinalizeAt = Date.now();

      try {
        const changes = await diffWorkspaceSnapshots(context.workspace.path, currentTurn.beforeSnapshot);
        await context.db.turn.update({
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
        socket.send(JSON.stringify({ type: 'turn_completed', turnId: currentTurn.turnId }));
      } finally {
        isFinalizing = false;
      }
    };

    const beginTerminalTurn = async (prompt: string) => {
      const trimmedPrompt = prompt.trim();
      if (!trimmedPrompt || trimmedPrompt.startsWith('/')) return;

      await finalizePendingTurn();
      const taskTitle = await extractTaskTitle(trimmedPrompt);
      const beforeSnapshot = await snapshotWorkspace(context.workspace.path);
      const userMessage = await context.db.message.create({
        data: {
          sessionId: session.id,
          role: 'user',
          content: trimmedPrompt,
          taskTitle
        }
      });
      const turn = await context.db.turn.create({
        data: {
          sessionId: session.id,
          userMessageId: userMessage.id,
          prompt: trimmedPrompt,
          taskTitle
        }
      });
      pendingTurn = {
        turnId: turn.id,
        beforeSnapshot,
        output: '',
        startedAt: Date.now()
      };
      cleanOutputBuffer = '';
    };

    const dataDisposable = pty.onData((data) => {
      if (pendingTurn) {
        pendingTurn.output += data;
        cleanOutputBuffer = `${cleanOutputBuffer}${stripAnsi(data)}`.slice(-2000);
        if (hasWorkedForMarker(cleanOutputBuffer)) {
          cleanOutputBuffer = '';
          finalizePendingTurn().catch((error) => request.log.error({ err: error }, 'Failed to finalize terminal turn'));
        }
      }
      socket.send(JSON.stringify({ type: 'output', data }));
    });

    const exitDisposable = pty.onExit(async ({ exitCode }) => {
      await finalizePendingTurn();
      socket.send(JSON.stringify({ type: 'exit', exitCode }));
      socket.close();
    });

    socket.on('message', (raw: Buffer) => {
      try {
        const message = JSON.parse(String(raw)) as { type?: string; data?: string; cols?: number; rows?: number };
        if (message.type === 'input' && typeof message.data === 'string') {
          for (const char of message.data) {
            if (char === '\r' || char === '\n') {
              const prompt = inputBuffer;
              inputBuffer = '';
              beginTerminalTurn(prompt).catch((error) => request.log.error({ err: error }, 'Failed to record terminal prompt'));
              continue;
            }
            if (char === '\u007f' || char === '\b') {
              inputBuffer = inputBuffer.slice(0, -1);
              continue;
            }
            if (char >= ' ') {
              inputBuffer += char;
            }
          }
          pty.write(message.data);
        }
        if (message.type === 'resize' && typeof message.cols === 'number' && typeof message.rows === 'number') {
          pty.resize(message.cols, message.rows);
        }
      } catch {
        // Ignore malformed terminal frames.
      }
    });

    socket.on('close', () => {
      dataDisposable.dispose();
      exitDisposable.dispose();
      pty.kill();
      if (pendingTurn && Date.now() - lastFinalizeAt > 1000) {
        finalizePendingTurn().catch((error) => request.log.error({ err: error }, 'Failed to finalize terminal turn'));
      }
    });
  });
}
