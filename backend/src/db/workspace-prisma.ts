import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prisma } from './prisma.js';
import { PrismaClient as WorkspacePrismaClient } from '../../node_modules/.prisma/workspace-client/index.js';

export const reviewdockDir = (workspacePath: string) => join(workspacePath, '.reviewdock');
export const workspaceDbPath = (workspacePath: string) => join(reviewdockDir(workspacePath), 'reviewdock.sqlite');
export const workspaceUploadsDir = (workspacePath: string) => join(reviewdockDir(workspacePath), 'uploads');

interface WorkspaceContext {
  workspace: {
    id: string;
    name: string;
    path: string;
  };
  db: WorkspacePrismaClient;
}

const clients = new Map<string, WorkspacePrismaClient>();

const sqliteUrl = (path: string) => pathToFileURL(path).toString();

const createTables = async (db: WorkspacePrismaClient) => {
  await db.$executeRawUnsafe('PRAGMA foreign_keys = ON');
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Session" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "name" TEXT NOT NULL,
      "provider" TEXT NOT NULL,
      "externalSessionId" TEXT,
      "workspaceId" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      "deletedAt" DATETIME
    )
  `);
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Message" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "role" TEXT NOT NULL,
      "content" TEXT NOT NULL,
      "taskTitle" TEXT,
      "sessionId" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "Message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Turn" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "prompt" TEXT NOT NULL,
      "taskTitle" TEXT,
      "assistantContent" TEXT,
      "sessionId" TEXT NOT NULL,
      "userMessageId" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "completedAt" DATETIME,
      CONSTRAINT "Turn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ModifiedFile" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "path" TEXT NOT NULL,
      "kind" TEXT NOT NULL,
      "beforeContent" TEXT,
      "afterContent" TEXT,
      "content" TEXT,
      "turnId" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ModifiedFile_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ReviewChangeNote" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "turnId" TEXT NOT NULL,
      "filePath" TEXT NOT NULL,
      "groupId" TEXT NOT NULL,
      "note" TEXT NOT NULL,
      "reviewed" BOOLEAN NOT NULL DEFAULT false,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "ReviewChangeNote_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);

  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Session_workspaceId_idx" ON "Session"("workspaceId")');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Session_provider_idx" ON "Session"("provider")');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Session_createdAt_idx" ON "Session"("createdAt")');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Session_deletedAt_idx" ON "Session"("deletedAt")');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Message_sessionId_idx" ON "Message"("sessionId")');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Message_createdAt_idx" ON "Message"("createdAt")');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Turn_sessionId_idx" ON "Turn"("sessionId")');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Turn_createdAt_idx" ON "Turn"("createdAt")');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "ModifiedFile_turnId_idx" ON "ModifiedFile"("turnId")');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "ModifiedFile_path_idx" ON "ModifiedFile"("path")');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "ReviewChangeNote_turnId_idx" ON "ReviewChangeNote"("turnId")');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "ReviewChangeNote_filePath_idx" ON "ReviewChangeNote"("filePath")');
  await db.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "ReviewChangeNote_turnId_filePath_groupId_key" ON "ReviewChangeNote"("turnId", "filePath", "groupId")');
};

export const ensureReviewdock = async (workspacePath: string) => {
  const dir = reviewdockDir(workspacePath);
  await mkdir(dir, { recursive: true });
  await mkdir(workspaceUploadsDir(workspacePath), { recursive: true });
  await writeFile(join(dir, 'config.json'), `${JSON.stringify({ version: 1 }, null, 2)}\n`, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'EEXIST') throw error;
  });

  const db = await getWorkspacePrisma(workspacePath);
  await createTables(db);
  return db;
};

export const getWorkspacePrisma = async (workspacePath: string) => {
  const dbPath = workspaceDbPath(workspacePath);
  const cached = clients.get(dbPath);
  if (cached) return cached;

  await mkdir(reviewdockDir(workspacePath), { recursive: true });
  const db = new WorkspacePrismaClient({
    datasources: {
      db: {
        url: sqliteUrl(dbPath)
      }
    }
  });
  clients.set(dbPath, db);
  return db;
};

export const findSessionContext = async (sessionId: string): Promise<(WorkspaceContext & { session: Awaited<ReturnType<WorkspacePrismaClient['session']['findFirst']>> }) | null> => {
  const workspaces = await prisma.workspace.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } });
  for (const workspace of workspaces) {
    const db = await ensureReviewdock(workspace.path);
    const session = await db.session.findFirst({ where: { id: sessionId, deletedAt: null } });
    if (session) return { workspace, db, session };
  }
  return null;
};

export const findTurnContext = async (turnId: string) => {
  const workspaces = await prisma.workspace.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' } });
  for (const workspace of workspaces) {
    const db = await ensureReviewdock(workspace.path);
    const turn = await db.turn.findFirst({
      where: {
        id: turnId,
        session: { deletedAt: null }
      },
      include: {
        session: true
      }
    });
    if (turn) return { workspace, db, turn };
  }
  return null;
};

export const disconnectWorkspacePrisma = async () => {
  await Promise.all([...clients.values()].map((client) => client.$disconnect()));
  clients.clear();
};
