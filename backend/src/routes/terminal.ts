import type { FastifyInstance } from 'fastify';
import { spawn } from 'node-pty';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { loadCodexOptions } from '../services/codex-options.js';

const terminalParamsSchema = z.object({
  sessionId: z.string().min(1)
});

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

export async function registerTerminalRoutes(app: FastifyInstance) {
  app.get('/sessions/:sessionId/terminal', { websocket: true }, async (socket, request) => {
    const params = terminalParamsSchema.safeParse(request.params);
    if (!params.success) {
      socket.close(1008, 'Invalid session id');
      return;
    }

    const session = await prisma.session.findFirst({
      where: {
        id: params.data.sessionId,
        provider: 'CODEX_CLI',
        workspace: { deletedAt: null }
      },
      include: { workspace: true }
    });

    if (!session) {
      socket.close(1008, 'Codex CLI session not found');
      return;
    }

    const codexOptions = await loadCodexOptions();
    const args = [
      '--cd', session.workspace.path,
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
        cwd: session.workspace.path,
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

    const dataDisposable = pty.onData((data) => {
      socket.send(JSON.stringify({ type: 'output', data }));
    });

    const exitDisposable = pty.onExit(({ exitCode }) => {
      socket.send(JSON.stringify({ type: 'exit', exitCode }));
      socket.close();
    });

    socket.on('message', (raw: Buffer) => {
      try {
        const message = JSON.parse(String(raw)) as { type?: string; data?: string; cols?: number; rows?: number };
        if (message.type === 'input' && typeof message.data === 'string') {
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
    });
  });
}
