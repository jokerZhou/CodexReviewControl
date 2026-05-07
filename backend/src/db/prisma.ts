import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 改动说明（v1.0.8）：
 * 用户未提供 backend/.env 时，Prisma 会抛 P1012「Environment variable not found: DATABASE_URL」。
 * 这里给一个安全的本地兜底，让 backend 在缺少 .env 的情况下也能启动。
 *
 * 关键点（坑点说明）：
 *   Prisma 对 SQLite `file:` URL 的相对路径，解析基准是 **schema.prisma 所在目录**，
 *   而不是 process.cwd()。因此：
 *     - 写 file:./dev.db  → backend/prisma/dev.db   ✅（与 CLI 行为一致）
 *     - 写 file:./prisma/dev.db → backend/prisma/prisma/dev.db ❌（CLI 会建嵌套目录）
 *   先前版本误把默认值写成 file:./prisma/dev.db，导致：
 *     • CLI（prisma db push / migrate）把表建到 backend/prisma/prisma/dev.db
 *     • 运行时却连到 backend/prisma/dev.db 这个 0 字节空文件
 *     • 调用 prisma.workspace.findMany() 直接 P2021「table main.Workspace does not exist」
 *
 * 这里改成用「以 schema.prisma 为基准、解析为绝对路径」的写法，确保 CLI 与运行时
 * 始终指向同一个文件 backend/prisma/dev.db。
 *
 * 若用户在 .env 里显式声明了 DATABASE_URL，则尊重用户配置，不覆盖。
 */
if (!process.env.DATABASE_URL) {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const backendRoot = resolve(currentDir, '../..');
  const sqliteDbFile = resolve(backendRoot, 'prisma/dev.db');
  process.env.DATABASE_URL = `file:${sqliteDbFile}`;
}

export const prisma = new PrismaClient();
