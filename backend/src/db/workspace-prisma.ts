import { mkdir, readFile, writeFile } from 'node:fs/promises';
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

const addColumnIfMissing = async (db: WorkspacePrismaClient, table: string, column: string, definition: string) => {
  const columns = await db.$queryRawUnsafe<Array<{ name: string }>>(`PRAGMA table_info("${table}")`);
  if (columns.some((item) => item.name === column)) return;
  await db.$executeRawUnsafe(`ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition}`);
};

const ensureGitignoreEntry = async (workspacePath: string) => {
  const gitignorePath = join(workspacePath, '.gitignore');
  let content = '';

  try {
    content = await readFile(gitignorePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const hasReviewdockEntry = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line === '.reviewdock' || line === '.reviewdock/' || line === '/.reviewdock' || line === '/.reviewdock/');

  if (hasReviewdockEntry) return;

  const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
  await writeFile(gitignorePath, `${content}${separator}.reviewdock/\n`);
};

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
      "researchPlanId" TEXT,
      "plannedFilesJson" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "completedAt" DATETIME,
      CONSTRAINT "Turn_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "Turn_researchPlanId_fkey" FOREIGN KEY ("researchPlanId") REFERENCES "ResearchPlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE
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
      "scopeStatus" TEXT,
      "turnId" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ModifiedFile_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "Turn" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await db.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "ResearchPlan" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "sessionId" TEXT NOT NULL,
      "messageId" TEXT NOT NULL,
      "prompt" TEXT NOT NULL,
      "summary" TEXT NOT NULL,
      "plannedFilesJson" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "ResearchPlan_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT "ResearchPlan_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Turn_researchPlanId_idx" ON "Turn"("researchPlanId")');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Turn_createdAt_idx" ON "Turn"("createdAt")');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "ModifiedFile_turnId_idx" ON "ModifiedFile"("turnId")');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "ModifiedFile_path_idx" ON "ModifiedFile"("path")');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "ResearchPlan_sessionId_idx" ON "ResearchPlan"("sessionId")');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "ResearchPlan_createdAt_idx" ON "ResearchPlan"("createdAt")');
  await db.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "ResearchPlan_messageId_key" ON "ResearchPlan"("messageId")');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "ReviewChangeNote_turnId_idx" ON "ReviewChangeNote"("turnId")');
  await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "ReviewChangeNote_filePath_idx" ON "ReviewChangeNote"("filePath")');
  await db.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "ReviewChangeNote_turnId_filePath_groupId_key" ON "ReviewChangeNote"("turnId", "filePath", "groupId")');

  await addColumnIfMissing(db, 'Turn', 'researchPlanId', 'TEXT');
  await addColumnIfMissing(db, 'Turn', 'plannedFilesJson', 'TEXT');
  await addColumnIfMissing(db, 'ModifiedFile', 'scopeStatus', 'TEXT');
};

export const ensureReviewdock = async (workspacePath: string) => {
  const dir = reviewdockDir(workspacePath);
  await mkdir(dir, { recursive: true });
  await mkdir(workspaceUploadsDir(workspacePath), { recursive: true });
  await ensureGitignoreEntry(workspacePath);
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
