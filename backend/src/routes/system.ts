import type { FastifyInstance } from 'fastify';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function registerSystemRoutes(app: FastifyInstance) {
  app.post('/system/select-directory', async (request, reply) => {
    if (process.platform !== 'darwin') {
      return reply.code(501).send({ error: 'Directory picker is only implemented for macOS.' });
    }

    try {
      const { stdout } = await execFileAsync('osascript', [
        '-e',
        'POSIX path of (choose folder with prompt "Select workspace folder")'
      ]);
      const path = stdout.trim();

      if (!path) {
        return reply.code(204).send();
      }

      return { path };
    } catch {
      return reply.code(204).send();
    }
  });
}
