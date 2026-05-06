/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import ReactMarkdown from 'react-markdown';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import remarkGfm from 'remark-gfm';
import { 
  Terminal, 
  Search, 
  Cloud, 
  Share2, 
  Settings, 
  Plus, 
  MessageSquare, 
  AlertCircle, 
  Brush, 
  History, 
  ChevronDown,
  FolderOpen,
  X,
  Trash2,
  LayoutDashboard,
  Database,
  Link,
  Info,
  ShieldCheck,
  Zap,
  Download,
  Eye,
  GitBranch,
  Image as ImageIcon,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';
const API_WS_BASE_URL = API_BASE_URL.replace(/^http/, 'ws');
console.log('[ReviewDock jump] diagnostics enabled');

const splitLines = (text: string | null | undefined) => (text || '').replace(/\r\n/g, '\n').split('\n');
const reviewPaneText = (text: string | null | undefined, emptyLabel: string) => text && text.length > 0 ? text : emptyLabel;
const hasReviewSnapshot = (text: string | null | undefined) => text !== null && text !== undefined && text.length > 0;

type DiffOp = { kind: 'same' | 'add' | 'delete'; text: string };
type TerminalHistoryLine = {
  id?: string;
  turnId?: string;
  type: string;
  text: string;
  prompt?: boolean;
  color?: string;
  collapsible?: boolean;
  summary?: string;
};

type JumpTarget = {
  anchorId: string;
  turnId: string;
  text: string;
  nonce: number;
};

const normalizeJumpText = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim();

const buildTerminalHistoryLine = (text: string, color?: string, type = 'info'): TerminalHistoryLine => {
  const normalized = text.replace(/\r\n/g, '\n').trimEnd();
  if (!normalized.startsWith('$ ')) return { type, text, color };

  const lines = normalized.split('\n');
  if (lines.length <= 1) return { type, text: normalized, color };

  return {
    type,
    text: normalized,
    color,
    collapsible: true,
    summary: lines[0]
  };
};

const buildTerminalHistoryLines = (text: string, color?: string, type = 'info'): TerminalHistoryLine[] => {
  const normalized = text.replace(/\r\n/g, '\n').trimEnd();
  if (!normalized.includes('\n$ ')) return [buildTerminalHistoryLine(normalized, color, type)];

  const blocks: string[] = [];
  const lines = normalized.split('\n');
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith('$ ') && current.length > 0) {
      blocks.push(current.join('\n'));
      current = [line];
      continue;
    }
    current.push(line);
  }

  if (current.length > 0) blocks.push(current.join('\n'));
  const parsed = blocks.filter(Boolean).map((block) => buildTerminalHistoryLine(block, color, type));
  return parsed.filter((line, index) => {
    const next = parsed[index + 1];
    return !(line.text.startsWith('$ ') && !line.collapsible && next?.collapsible && next.summary === line.text);
  });
};

const MarkdownText = ({ text }: { text: string }) => (
  <div className="min-w-0 flex-1 overflow-hidden [&_a]:text-blue-300 [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-slate-700 [&_blockquote]:pl-3 [&_blockquote]:text-slate-400 [&_code]:rounded [&_code]:bg-slate-900 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.95em] [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_pre]:overflow-x-auto [&_pre]:rounded [&_pre]:border [&_pre]:border-slate-800 [&_pre]:bg-slate-950 [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_tbody_tr]:border-t [&_tbody_tr]:border-slate-800 [&_td]:border [&_td]:border-slate-800 [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-slate-700 [&_th]:bg-slate-900 [&_th]:px-2 [&_th]:py-1 [&_ul]:list-disc [&_ul]:pl-5">
    <ReactMarkdown remarkPlugins={[remarkGfm]}>
      {text}
    </ReactMarkdown>
  </div>
);

const buildCharDiffOps = (beforeText: string, afterText: string) => {
  const beforeChars = Array.from(beforeText);
  const afterChars = Array.from(afterText);
  const table = Array.from({ length: beforeChars.length + 1 }, () => Array(afterChars.length + 1).fill(0));

  for (let i = beforeChars.length - 1; i >= 0; i -= 1) {
    for (let j = afterChars.length - 1; j >= 0; j -= 1) {
      table[i][j] = beforeChars[i] === afterChars[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  const push = (kind: DiffOp['kind'], text: string) => {
    const previous = ops[ops.length - 1];
    if (previous?.kind === kind) {
      previous.text += text;
      return;
    }
    ops.push({ kind, text });
  };

  let i = 0;
  let j = 0;

  while (i < beforeChars.length && j < afterChars.length) {
    if (beforeChars[i] === afterChars[j]) {
      push('same', beforeChars[i]);
      i += 1;
      j += 1;
      continue;
    }

    if (table[i + 1][j] >= table[i][j + 1]) {
      push('delete', beforeChars[i]);
      i += 1;
    } else {
      push('add', afterChars[j]);
      j += 1;
    }
  }

  while (i < beforeChars.length) {
    push('delete', beforeChars[i]);
    i += 1;
  }

  while (j < afterChars.length) {
    push('add', afterChars[j]);
    j += 1;
  }

  return ops;
};

const renderInlineCharDiff = (beforeText: string, afterText: string, side: 'before' | 'after') => {
  const beforeChars = Array.from(beforeText);
  const afterChars = Array.from(afterText);
  let prefixLength = 0;

  while (
    prefixLength < beforeChars.length &&
    prefixLength < afterChars.length &&
    beforeChars[prefixLength] === afterChars[prefixLength]
  ) {
    prefixLength += 1;
  }

  let suffixLength = 0;
  while (
    suffixLength < beforeChars.length - prefixLength &&
    suffixLength < afterChars.length - prefixLength &&
    beforeChars[beforeChars.length - 1 - suffixLength] === afterChars[afterChars.length - 1 - suffixLength]
  ) {
    suffixLength += 1;
  }

  const chars = side === 'before' ? beforeChars : afterChars;
  const middleStart = prefixLength;
  const middleEnd = chars.length - suffixLength;
  const segments = [
    { text: chars.slice(0, middleStart).join(''), changed: false },
    { text: chars.slice(middleStart, middleEnd).join(''), changed: middleEnd > middleStart },
    { text: chars.slice(middleEnd).join(''), changed: false }
  ].filter(segment => segment.text.length > 0);

  return segments
    .map((segment, index) => {
      return (
        <span
          key={`${side}-${index}`}
          className={segment.changed
            ? side === 'before'
              ? 'rounded-sm bg-red-500/45 px-0.5 text-red-50 line-through decoration-red-100/80'
              : 'rounded-sm bg-green-400/35 px-0.5 text-green-50'
            : 'text-slate-100/85'
          }
        >
          {segment.text}
        </span>
      );
    });
};

const buildLineDiffOps = (beforeText: string | null | undefined, afterText: string | null | undefined) => {
  const beforeLines = splitLines(beforeText);
  const afterLines = splitLines(afterText);
  const table = Array.from({ length: beforeLines.length + 1 }, () => Array(afterLines.length + 1).fill(0));

  for (let i = beforeLines.length - 1; i >= 0; i -= 1) {
    for (let j = afterLines.length - 1; j >= 0; j -= 1) {
      table[i][j] = beforeLines[i] === afterLines[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;

  while (i < beforeLines.length && j < afterLines.length) {
    if (beforeLines[i] === afterLines[j]) {
      ops.push({ kind: 'same', text: beforeLines[i] });
      i += 1;
      j += 1;
      continue;
    }

    if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ kind: 'delete', text: beforeLines[i] });
      i += 1;
    } else {
      ops.push({ kind: 'add', text: afterLines[j] });
      j += 1;
    }
  }

  while (i < beforeLines.length) {
    ops.push({ kind: 'delete', text: beforeLines[i] });
    i += 1;
  }

  while (j < afterLines.length) {
    ops.push({ kind: 'add', text: afterLines[j] });
    j += 1;
  }

  return ops;
};

const renderCompareRows = (beforeText: string | null | undefined, afterText: string | null | undefined) => {
  const rows: Array<{
    before: string;
    after: string;
    kind: 'add' | 'delete' | 'update' | 'same';
    beforeLineNumber: number | null;
    afterLineNumber: number | null;
  }> = [];
  const pendingDeletes: Array<{ text: string; lineNumber: number }> = [];
  const pendingAdds: Array<{ text: string; lineNumber: number }> = [];
  let beforeLineNumber = 1;
  let afterLineNumber = 1;

  const flushChanges = () => {
    const pairedLength = Math.min(pendingDeletes.length, pendingAdds.length);
    for (let i = 0; i < pairedLength; i += 1) {
      rows.push({
        before: pendingDeletes[i].text,
        after: pendingAdds[i].text,
        kind: 'update',
        beforeLineNumber: pendingDeletes[i].lineNumber,
        afterLineNumber: pendingAdds[i].lineNumber
      });
    }
    for (let i = pairedLength; i < pendingDeletes.length; i += 1) {
      rows.push({
        before: pendingDeletes[i].text,
        after: '',
        kind: 'delete',
        beforeLineNumber: pendingDeletes[i].lineNumber,
        afterLineNumber: null
      });
    }
    for (let i = pairedLength; i < pendingAdds.length; i += 1) {
      rows.push({
        before: '',
        after: pendingAdds[i].text,
        kind: 'add',
        beforeLineNumber: null,
        afterLineNumber: pendingAdds[i].lineNumber
      });
    }
    pendingDeletes.length = 0;
    pendingAdds.length = 0;
  };

  buildLineDiffOps(beforeText, afterText).forEach((op) => {
    if (op.kind === 'same') {
      flushChanges();
      rows.push({
        before: op.text,
        after: op.text,
        kind: 'same',
        beforeLineNumber,
        afterLineNumber
      });
      beforeLineNumber += 1;
      afterLineNumber += 1;
      return;
    }
    if (op.kind === 'delete') {
      pendingDeletes.push({ text: op.text, lineNumber: beforeLineNumber });
      beforeLineNumber += 1;
    }
    if (op.kind === 'add') {
      pendingAdds.push({ text: op.text, lineNumber: afterLineNumber });
      afterLineNumber += 1;
    }
  });

  flushChanges();
  return rows;
};

const renderAnnotatedCurrentLines = (beforeText: string | null | undefined, afterText: string | null | undefined) => {
  const rows: Array<{ id: string; kind: 'same' | 'add' | 'delete' | 'update'; text: string; beforeText?: string; lineNumber: number | null }> = [];
  const pendingDeletes: string[] = [];
  const pendingAdds: string[] = [];
  let lineNumber = 1;
  let rowIndex = 0;

  const nextId = () => {
    rowIndex += 1;
    return `review-change-${rowIndex}`;
  };

  const flushChanges = () => {
    const pairedLength = Math.min(pendingDeletes.length, pendingAdds.length);
    for (let i = 0; i < pairedLength; i += 1) {
      rows.push({ id: nextId(), kind: 'update', text: pendingAdds[i], beforeText: pendingDeletes[i], lineNumber });
      lineNumber += 1;
    }
    for (let i = pairedLength; i < pendingDeletes.length; i += 1) {
      rows.push({ id: nextId(), kind: 'delete', text: pendingDeletes[i], lineNumber: null });
    }
    for (let i = pairedLength; i < pendingAdds.length; i += 1) {
      rows.push({ id: nextId(), kind: 'add', text: pendingAdds[i], lineNumber });
      lineNumber += 1;
    }
    pendingDeletes.length = 0;
    pendingAdds.length = 0;
  };

  buildLineDiffOps(beforeText, afterText).forEach((op) => {
    if (op.kind === 'same') {
      flushChanges();
      rows.push({ id: nextId(), kind: 'same', text: op.text, lineNumber });
      lineNumber += 1;
      return;
    }
    if (op.kind === 'delete') pendingDeletes.push(op.text);
    if (op.kind === 'add') pendingAdds.push(op.text);
  });

  flushChanges();
  return rows;
};

type AnnotatedRow = ReturnType<typeof renderAnnotatedCurrentLines>[number];

const groupAdjacentChanges = (rows: AnnotatedRow[]) => {
  const groupByRowId = new Map<string, string>();
  const groups: Array<{ id: string; rows: AnnotatedRow[]; kind: 'add' | 'delete' | 'update' }> = [];
  let currentGroup: { id: string; rows: AnnotatedRow[]; kind: 'add' | 'delete' | 'update' } | null = null;

  rows.forEach((row) => {
    if (row.kind === 'same') {
      currentGroup = null;
      return;
    }

    if (!currentGroup) {
      currentGroup = {
        id: `change-group-${groups.length + 1}`,
        rows: [],
        kind: row.kind
      };
      groups.push(currentGroup);
    }

    if (currentGroup.kind !== row.kind) {
      currentGroup.kind = 'update';
    }
    currentGroup.rows.push(row);
    groupByRowId.set(row.id, currentGroup.id);
  });

  return { groups, groupByRowId };
};

const reviewDiffUnavailableText = (file: ModifiedFile | undefined) => {
  if (!file) return 'No file selected.';
  if (!hasReviewSnapshot(file.beforeContent) && !hasReviewSnapshot(file.afterContent)) {
    return 'Before and after snapshots are unavailable for this file.';
  }
  if (!hasReviewSnapshot(file.beforeContent)) {
    return 'Before snapshot is unavailable, so a line-by-line review cannot be calculated.';
  }
  if (!hasReviewSnapshot(file.afterContent)) {
    return 'After snapshot is unavailable, so a line-by-line review cannot be calculated.';
  }
  return null;
};

const TopNavBar = () => {
  return (
    <header className="fixed top-0 left-0 w-full h-12 bg-slate-950 border-b border-slate-800 flex items-center justify-between px-4 z-50">
      <div className="flex items-center gap-4">
        <span className="text-xl font-black tracking-tighter text-blue-500 font-display">CODEX COMMAND</span>
        <div className="h-4 w-px bg-slate-800"></div>
        <div className="flex items-center gap-2 text-slate-400 font-display text-sm tracking-tight uppercase">
          <Terminal size={14} className="text-blue-500" />
          <span>Nexus Gateway / Auth Implementation</span>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center bg-slate-900 border border-slate-800 px-3 py-1 rounded-lg">
          <Search size={14} className="text-slate-500 mr-2" />
          <input 
            type="text" 
            placeholder="SEARCH COMMANDS..." 
            className="bg-transparent border-none focus:ring-0 text-xs font-display text-slate-300 w-48 placeholder:text-slate-600 outline-none" 
          />
        </div>
        <div className="flex items-center gap-1">
          <button className="text-slate-400 hover:bg-slate-900 hover:text-blue-400 transition-colors p-1.5 rounded">
            <Terminal size={18} />
          </button>
          <button className="text-slate-400 hover:bg-slate-900 hover:text-blue-400 transition-colors p-1.5 rounded">
            <Cloud size={18} />
          </button>
          <button className="text-slate-400 hover:bg-slate-900 hover:text-blue-400 transition-colors p-1.5 rounded">
            <Share2 size={18} />
          </button>
        </div>
      </div>
    </header>
  );
};

const ActivityBar = () => {
  return (
    <aside className="fixed left-0 top-12 w-16 h-[calc(100vh-48px)] bg-slate-950 border-r border-slate-800 flex flex-col items-center py-4 z-40">
      <div className="space-y-4 w-full flex flex-col items-center">
        <div className="relative group cursor-pointer">
          <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-blue-500 rounded-r-full"></div>
          <div className="w-10 h-10 bg-blue-500/20 text-blue-400 flex items-center justify-center rounded-lg">
            <LayoutDashboard size={20} fill="currentColor" />
          </div>
        </div>
        <div className="w-10 h-10 text-slate-500 hover:bg-slate-900 hover:text-slate-200 flex items-center justify-center rounded-lg transition-all">
          <Database size={20} />
        </div>
        <div className="w-10 h-10 text-slate-500 hover:bg-slate-900 hover:text-slate-200 flex items-center justify-center rounded-lg transition-all">
          <Link size={20} />
        </div>
      </div>
      <div className="mt-auto space-y-4 w-full flex flex-col items-center">
        <button className="w-10 h-10 text-slate-500 hover:text-blue-400 transition-colors">
          <Settings size={20} />
        </button>
        <div className="w-8 h-8 rounded-full overflow-hidden border border-slate-700">
          <img 
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuDE5Uuta_Y-vAnGfQ6-vxbqSCD5xz22lpss3cCdcOCvJkBX4fVj7wfydcC2IcDYYwK6AOmn0kfiHKBMgR2OHq25t8aPl1heEI3AtCjumGQCLNIdZ7hJDwt1t3VH39HzltcXcR1hTKb9WNKVsFqwDVjkKgk6Rkj273SzL39rgvppXeL76Ph9b2eo3zjxy-BzjQ-M8eG3bT6u_1WU3MU-Z3Rpho5yqNky6WCZru_Qncf0lJ2GVXWvijBqNhGHz33KmmbN5jbbdj9w-Gc" 
            alt="User" 
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        </div>
      </div>
    </aside>
  );
};

interface ModifiedFile {
  name: string;
  status: 'M' | 'A' | 'D';
  statusColor: string;
  scopeStatus?: 'planned' | 'extra' | null;
  reason?: string;
  remarks?: string;
  diffSnippet?: string;
  content?: string | null;
  beforeContent?: string | null;
  afterContent?: string | null;
}

interface Turn {
  id: string;
  anchorId?: string;
  userMessage: string;
  taskTitle?: string;
  timestamp: string;
  workspaceId?: string;
  modifiedFiles: ModifiedFile[];
  reasoning: { issue: string; solution: string };
  summary: string;
}

type AgentProvider = 'codex' | 'codex-cli' | 'cursor';
type CodexReasoningEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
type AgentRunStatus = 'idle' | 'busy';

interface SelectOption<T extends string = string> {
  id: T;
  label: string;
}

interface CodexOptionsResponse {
  models: SelectOption[];
  reasoningEfforts: Array<SelectOption<CodexReasoningEffort>>;
  defaults: {
    model: string;
    reasoningEffort: CodexReasoningEffort;
  };
}

const fallbackCodexOptions: CodexOptionsResponse = {
  models: [
    { id: 'gpt-5.5', label: 'GPT-5.5' },
    { id: 'gpt-5.4', label: 'GPT-5.4' }
  ],
  reasoningEfforts: [
    { id: 'minimal', label: 'Minimal' },
    { id: 'low', label: 'Low' },
    { id: 'medium', label: 'Medium' },
    { id: 'high', label: 'High' },
    { id: 'xhigh', label: 'XHigh' }
  ],
  defaults: {
    model: 'gpt-5.5',
    reasoningEffort: 'medium'
  }
};

interface WorkspaceItem {
  id: string;
  name: string;
  icon: React.ReactNode;
  provider?: AgentProvider;
}

interface WorkspaceProject {
  id: string;
  name: string;
  icon: React.ReactNode;
  folderPath?: string;
  items: WorkspaceItem[];
}

interface ApiSession {
  id: string;
  name: string;
  provider: AgentProvider;
  workspaceId: string;
}

interface ApiWorkspace {
  id: string;
  name: string;
  path: string;
  sessions: ApiSession[];
}

interface ApiMessage {
  id: string;
  role: string;
  content: string;
  taskTitle?: string | null;
  createdAt: string;
}

interface ApiModifiedFile {
  id: string;
  path: string;
  kind: 'add' | 'delete' | 'update';
  content?: string | null;
  beforeContent?: string | null;
  afterContent?: string | null;
  scopeStatus?: 'planned' | 'extra' | null;
}

interface ResearchPlannedFile {
  path: string;
  action: 'add' | 'delete' | 'update';
  reason: string;
}

interface ResearchPlanResponse {
  researchPlan: {
    id: string;
    prompt: string;
    summary: string;
    confidence: 'low' | 'medium' | 'high';
    files: ResearchPlannedFile[];
    risks: string[];
    message: ApiMessage;
  };
}

interface ApiReviewChangeNote {
  id: string;
  filePath: string;
  groupId: string;
  note: string;
  reviewed: boolean;
}

interface ApiTurn {
  id: string;
  prompt: string;
  taskTitle?: string | null;
  assistantContent?: string | null;
  createdAt: string;
  modifiedFiles: ApiModifiedFile[];
  reviewNotes?: ApiReviewChangeNote[];
}

interface CodeFileEntry {
  name: string;
  path: string;
  type: 'directory' | 'file';
}

interface CodeHistoryEntry {
  turnId: string;
  taskTitle?: string | null;
  prompt: string;
  createdAt: string;
  completedAt?: string | null;
  sessionId: string;
  sessionName: string;
  provider: AgentProvider;
  filePath: string;
  changeKind: 'add' | 'delete' | 'update';
  changedLines: number[];
  beforeExcerpt: string;
  afterExcerpt: string;
  beforeContent?: string | null;
  afterContent?: string | null;
}

interface PendingAttachment {
  id: string;
  file: File;
  previewUrl: string;
}

interface DirectoryHandle {
  name: string;
  kind: 'directory';
}

declare global {
  interface ImportMeta {
    env: {
      VITE_API_BASE_URL?: string;
    };
  }

  interface Window {
  showDirectoryPicker?: () => Promise<DirectoryHandle>;
  }
}

const AddProjectModal = ({ onClose, onAddProject }: { onClose: () => void, onAddProject: (name: string, folderPath: string) => void }) => {
  const [name, setName] = useState('');
  const [folderPath, setFolderPath] = useState('');
  const [error, setError] = useState('');

  const handleFolderSelect = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/system/select-directory`, {
        method: 'POST'
      });

      if (response.status === 204) return;

      if (response.ok) {
        const data = await response.json() as { path: string };
        setFolderPath(data.path);
        setError('');
        return;
      }
    } catch {
      // Fall through to browser directory picker when the local backend is unavailable.
    }

    if (!window.showDirectoryPicker) {
      setError('Directory picker is unavailable. Start the backend to choose a real workspace path.');
      return;
    }

    try {
      const directory = await window.showDirectoryPicker();
      setFolderPath(directory.name);
      setError('');
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setError('Unable to choose workspace folder.');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      setError('Project name is required.');
      return;
    }

    if (!folderPath) {
      setError('Choose a project folder.');
      return;
    }

    onAddProject(name.trim(), folderPath);
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
    >
      <motion.form
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        onSubmit={handleSubmit}
        className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-950 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-800 p-4">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-blue-400">Add Project</h2>
            <p className="mt-1 text-[11px] text-slate-500">Create a new workspace from a local folder</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-900 hover:text-slate-200"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4 p-4">
          <label className="block">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">Project Name</span>
            <input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError('');
              }}
              className="w-full rounded border border-slate-800 bg-slate-900 px-3 py-2 text-sm text-slate-200 outline-none transition-colors placeholder:text-slate-600 focus:border-blue-500"
              placeholder="My Workspace"
              autoFocus
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-500">Project Folder</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleFolderSelect}
                className="flex h-10 shrink-0 items-center gap-2 rounded border border-slate-700 bg-slate-900 px-3 text-xs font-bold uppercase text-slate-300 transition-colors hover:border-blue-500 hover:text-blue-400"
              >
                <FolderOpen size={14} />
                Choose
              </button>
              <div className="flex h-10 min-w-0 flex-1 items-center rounded border border-slate-800 bg-slate-900 px-3">
                <span className={`truncate text-xs ${folderPath ? 'text-slate-300' : 'text-slate-600'}`}>
                  {folderPath || 'No folder selected'}
                </span>
              </div>
            </div>
          </label>

          {error && (
            <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-800 p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-800 bg-slate-900 px-4 py-2 text-xs font-bold uppercase text-slate-400 transition-colors hover:text-slate-200"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded bg-blue-500 px-4 py-2 text-xs font-bold uppercase text-white transition-colors hover:bg-blue-600"
          >
            Add Project
          </button>
        </div>
      </motion.form>
    </motion.div>
  );
};

const providerMeta: Record<AgentProvider, { label: string; description: string; accent: string }> = {
  codex: {
    label: 'Codex SDK',
    description: 'OpenAI Codex SDK session with structured event tracking.',
    accent: 'text-blue-400 border-blue-500/40 bg-blue-500/10'
  },
  'codex-cli': {
    label: 'Codex CLI',
    description: 'Codex CLI session with resume support and snapshot-based change review.',
    accent: 'text-cyan-300 border-cyan-500/40 bg-cyan-500/10'
  },
  cursor: {
    label: 'Cursor',
    description: 'Cursor Agent session for Cursor-style coding workflows.',
    accent: 'text-secondary border-secondary/40 bg-secondary/10'
  }
};

const SelectAgentModal = ({ projectName, onClose, onSelect }: { projectName: string, onClose: () => void, onSelect: (provider: AgentProvider) => void }) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-950 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-800 p-4">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-blue-400">New Session</h2>
            <p className="mt-1 text-[11px] text-slate-500">Choose agent provider for {projectName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-900 hover:text-slate-200"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="grid gap-3 p-4">
          {(Object.keys(providerMeta) as AgentProvider[]).map((provider) => (
            <button
              key={provider}
              onClick={() => onSelect(provider)}
              className={`rounded-lg border p-4 text-left transition-colors hover:border-blue-500/70 ${providerMeta[provider].accent}`}
            >
              <div className="mb-2 flex items-center gap-3">
                <MessageSquare size={18} />
                <span className="text-sm font-bold uppercase tracking-widest">{providerMeta[provider].label}</span>
              </div>
              <p className="text-xs leading-relaxed text-slate-400">{providerMeta[provider].description}</p>
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
};

const TerminalHistoryItem = ({ line, index, active = false }: { line: TerminalHistoryLine; index: number; active?: boolean }) => {
  const [expanded, setExpanded] = useState(false);
  const displayText = line.collapsible && !expanded ? (line.summary || line.text) : line.text;

  if (line.collapsible) {
    return (
      <button
        id={line.id}
        data-history-index={index}
        type="button"
        onClick={() => setExpanded((current) => !current)}
        className={`flex w-full items-start gap-2 rounded px-1 py-0.5 text-left transition-colors hover:bg-slate-900/70 ${active ? 'bg-emerald-500/10 ring-1 ring-emerald-400/50' : ''} ${line.color || ''}`}
        title={expanded ? '点击收起命令输出' : '点击查看命令输出'}
      >
        {line.prompt && <span className="shrink-0 font-bold text-blue-400">➜</span>}
        <span className="shrink-0 text-slate-600">{expanded ? '▾' : '▸'}</span>
        {expanded ? (
          <MarkdownText text={displayText} />
        ) : (
          <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">{displayText}</span>
        )}
      </button>
    );
  }

  return (
    <div id={line.id} data-history-index={index} className={`flex items-start gap-2 rounded px-1 py-0.5 transition-colors ${active ? 'bg-emerald-500/10 ring-1 ring-emerald-400/50' : ''} ${line.color || ''}`}>
      {line.prompt && <span className="shrink-0 font-bold text-blue-400">➜</span>}
      <MarkdownText text={displayText} />
    </div>
  );
};

const CodexCliTerminal = ({ sessionId, title, providerLabel, onMessagesLoaded, onRunStatusChange }: { sessionId: string, title: string, providerLabel: string, onMessagesLoaded: (sessionId: string, messages: ApiMessage[], turns: ApiTurn[]) => void, onRunStatusChange: (sessionId: string, status: AgentRunStatus) => void }) => {
  const terminalRef = useRef<HTMLDivElement | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const onMessagesLoadedRef = useRef(onMessagesLoaded);
  const onRunStatusChangeRef = useRef(onRunStatusChange);

  useEffect(() => {
    onMessagesLoadedRef.current = onMessagesLoaded;
  }, [onMessagesLoaded]);

  useEffect(() => {
    onRunStatusChangeRef.current = onRunStatusChange;
  }, [onRunStatusChange]);

  useEffect(() => {
    if (!terminalRef.current) return undefined;

    const terminal = new XTerm({
      convertEol: true,
      cursorBlink: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
      fontSize: 14,
      theme: {
        background: '#020617',
        foreground: '#cbd5e1',
        cursor: '#60a5fa',
        selectionBackground: '#1e40af66'
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalRef.current);
    fitAddon.fit();
    terminal.focus();
    terminal.writeln(`${providerLabel} TUI attached`);
    terminal.writeln(`Session context: ${title}`);
    terminal.writeln('');

    const socket = new WebSocket(`${API_WS_BASE_URL}/sessions/${sessionId}/terminal`);
    socketRef.current = socket;
    onRunStatusChangeRef.current(sessionId, 'busy');

    const sendResize = () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }));
    };

    socket.addEventListener('open', () => {
      sendResize();
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { type: string; data?: string; exitCode?: number };
      if (message.type === 'output' && typeof message.data === 'string') {
        terminal.write(message.data);
      }
      if (message.type === 'exit') {
        terminal.writeln(`\r\n[process exited: ${message.exitCode ?? 0}]`);
        onRunStatusChangeRef.current(sessionId, 'idle');
      }
      if (message.type === 'turn_completed') {
        fetch(`${API_BASE_URL}/sessions/${sessionId}/messages`)
          .then((response) => response.ok ? response.json() : Promise.reject(new Error('Failed to reload turn details')))
          .then((payload: { messages: ApiMessage[], turns: ApiTurn[] }) => onMessagesLoadedRef.current(sessionId, payload.messages, payload.turns || []))
          .catch(() => undefined);
      }
    });
    socket.addEventListener('close', () => {
      onRunStatusChangeRef.current(sessionId, 'idle');
    });
    socket.addEventListener('error', () => {
      terminal.writeln('\r\n[terminal websocket error]');
      onRunStatusChangeRef.current(sessionId, 'idle');
    });

    const inputDisposable = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'input', data }));
      }
    });
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      sendResize();
    });
    resizeObserver.observe(terminalRef.current);

    return () => {
      inputDisposable.dispose();
      resizeObserver.disconnect();
      socket.close();
      terminal.dispose();
      onRunStatusChangeRef.current(sessionId, 'idle');
    };
  }, [sessionId, title, providerLabel]);

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-6 p-6">
      <div className="shrink-0 flex justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold font-display text-on-surface">{providerLabel}</h1>
          <span className="px-2 py-1 bg-secondary/10 text-secondary text-[10px] font-bold border border-secondary/20 rounded">REAL TUI</span>
        </div>
        <span className="truncate text-slate-500 text-xs font-medium uppercase tracking-tight font-display">{title}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-950 shadow-2xl">
        <div ref={terminalRef} className="h-full w-full p-2" />
      </div>
    </div>
  );
};

const ConfirmDeleteWorkspaceModal = ({ project, error, isDeleting, onClose, onConfirm }: { project: WorkspaceProject, error: string, isDeleting: boolean, onClose: () => void, onConfirm: () => void }) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="w-full max-w-md rounded-lg border border-slate-800 bg-slate-950 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-slate-800 p-4">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-widest text-red-300">Delete Workspace</h2>
            <p className="mt-1 text-[11px] text-slate-500">This removes it from the active workspace list.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-900 hover:text-slate-200"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <div className="rounded border border-slate-800 bg-slate-900 p-3">
            <div className="text-sm font-bold text-slate-200">{project.name}</div>
            <div className="mt-1 truncate text-xs text-slate-500">{project.folderPath}</div>
          </div>
          <p className="text-xs leading-relaxed text-slate-400">
            The workspace will be soft deleted in the database. Existing records are retained for recovery or audit.
          </p>
          {error && (
            <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-800 p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-800 bg-slate-900 px-4 py-2 text-xs font-bold uppercase text-slate-400 transition-colors hover:text-slate-200"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="rounded bg-red-500 px-4 py-2 text-xs font-bold uppercase text-white transition-colors hover:bg-red-600"
          >
            {isDeleting ? 'Deleting' : 'Delete'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

const ComparisonModal = ({ turns, workspace, onClose }: { turns: Turn[], workspace?: WorkspaceProject, onClose: () => void }) => {
  return <TurnDetailModal turn={turns[0]} turns={turns} workspace={workspace} onClose={onClose} />;
};

const WorkspacePane = ({ activeItem, setActiveItem, projects, sessionStatuses, onNewSession, onOpenAddProject, onDeleteProject, onDeleteSession }: { activeItem: string | null, setActiveItem: (id: string) => void, projects: WorkspaceProject[], sessionStatuses: Record<string, AgentRunStatus>, onNewSession: (projectId: string) => void, onOpenAddProject: () => void, onDeleteProject: (projectId: string) => void, onDeleteSession: (sessionId: string) => void }) => {
  const [expandedFolders, setExpandedFolders] = useState<string[]>(['nexus-gateway']);

  const toggleFolder = (folder: string) => {
    setExpandedFolders(prev => 
      prev.includes(folder) ? prev.filter(f => f !== folder) : [...prev, folder]
    );
  };

  const handleNewSession = (projectId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExpandedFolders(prev => prev.includes(projectId) ? prev : [...prev, projectId]);
    onNewSession(projectId);
  };

  return (
    <nav className="fixed left-0 top-12 w-64 h-[calc(100vh-48px)] bg-slate-950 border-r border-slate-800 flex flex-col z-30 font-display">
      <div className="px-4 py-3 border-b border-slate-900 flex justify-between items-center">
        <div>
          <span className="text-blue-500 font-bold text-xs uppercase tracking-widest">Workspace</span>
          <div className="text-slate-500 text-[10px] uppercase mt-0.5">v2.4.0-stable</div>
        </div>
        <div className="flex gap-2">
           <button
            onClick={onOpenAddProject}
            title="Add Project"
            aria-label="Add Project"
            className="rounded p-1 text-slate-500 transition-colors hover:bg-slate-900 hover:text-blue-400"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-4 space-y-1 hide-scrollbar">
        <div className="px-4 mb-2">
          <span className="text-slate-600 font-bold text-[10px] uppercase tracking-wider">Project Explorer</span>
        </div>
        
        {projects.map((project) => (
          <div key={project.id} className="space-y-0.5">
            <div className="group flex items-center px-2 hover:bg-slate-900/50 transition-all">
              <button 
                onClick={() => toggleFolder(project.id)}
                className="min-w-0 flex-1 flex items-center gap-2 px-2 py-2 text-slate-400 hover:text-slate-200 transition-all text-xs font-medium text-left"
              >
                <ChevronDown size={14} className={`shrink-0 transition-transform duration-200 ${expandedFolders.includes(project.id) ? '' : '-rotate-90'}`} />
                {project.icon}
                <span className="flex-1 truncate">{project.name}</span>
              </button>
              <button
                onClick={(e) => handleNewSession(project.id, e)}
                title={`New Session in ${project.name}`}
                aria-label={`New Session in ${project.name}`}
                className="w-7 h-7 shrink-0 rounded flex items-center justify-center text-slate-600 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
              >
                <Plus size={14} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteProject(project.id);
                }}
                title={`Delete ${project.name}`}
                aria-label={`Delete ${project.name}`}
                className="w-7 h-7 shrink-0 rounded flex items-center justify-center text-slate-700 hover:text-red-300 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 size={13} />
              </button>
            </div>
            
            <AnimatePresence>
              {expandedFolders.includes(project.id) && (
                <motion.div 
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden"
                >
                  {project.items.map((item) => (
                    (() => {
                      const runStatus = sessionStatuses[item.id] ?? 'idle';

                      return (
                        <div
                          key={item.id}
                          className={`group/session flex items-center gap-2 border-l-2 pl-10 pr-2 transition-all ${
                            activeItem === item.id 
                              ? 'bg-blue-500/10 text-blue-400 border-blue-500'
                              : 'text-slate-500 hover:bg-slate-900/30 hover:text-slate-300 border-transparent'
                          }`}
                        >
                          <button
                            onClick={() => setActiveItem(item.id)}
                            className="flex min-w-0 flex-1 items-center gap-3 py-1.5 text-left text-[11px] font-medium"
                          >
                            {item.icon}
                            <span className="min-w-0 flex-1 truncate">{item.name}</span>
                            <span className={`flex shrink-0 items-center gap-1 rounded border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest ${
                              runStatus === 'busy'
                                ? 'border-amber-400/30 bg-amber-400/10 text-amber-300'
                                : 'border-secondary/30 bg-secondary/10 text-secondary'
                            }`}>
                              <span className={`h-1.5 w-1.5 rounded-full ${runStatus === 'busy' ? 'animate-pulse bg-amber-300' : 'bg-secondary'}`} />
                              {runStatus === 'busy' ? 'busy' : 'idle'}
                            </span>
                            {item.provider && (
                              <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[8px] font-black uppercase tracking-widest ${
                                item.provider === 'cursor'
                                  ? 'border-secondary/30 text-secondary'
                                  : 'border-blue-500/30 text-blue-400'
                              }`}>
                                {item.provider}
                              </span>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onDeleteSession(item.id);
                            }}
                            title={`Delete ${item.name}`}
                            aria-label={`Delete ${item.name}`}
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-700 opacity-0 transition-colors hover:bg-red-500/10 hover:text-red-300 group-hover/session:opacity-100"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      );
                    })()
                  ))}
                  {project.folderPath && project.items.length === 0 && (
                    <div className="pl-10 pr-4 py-1.5 text-[10px] font-medium text-slate-600">
                      {project.folderPath}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </nav>
  );
};

const TerminalBlock = ({ sessionId, title, provider = 'codex', onRunCommand, onTaskTitle, onMessagesLoaded, onRunStatusChange, jumpTarget }: { sessionId: string, title: string, provider?: AgentProvider, onRunCommand: (msg: string) => void, onTaskTitle: (title: string, sessionId: string) => void, onMessagesLoaded: (sessionId: string, messages: ApiMessage[], turns: ApiTurn[]) => void, onRunStatusChange: (sessionId: string, status: AgentRunStatus) => void, jumpTarget?: JumpTarget | null }) => {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [codexOptions, setCodexOptions] = useState<CodexOptionsResponse>(fallbackCodexOptions);
  const [codexModel, setCodexModel] = useState(fallbackCodexOptions.defaults.model);
  const [codexReasoningEffort, setCodexReasoningEffort] = useState<CodexReasoningEffort>(fallbackCodexOptions.defaults.reasoningEffort);
  const [researchConfirmEnabled, setResearchConfirmEnabled] = useState(false);
  const [askModeEnabled, setAskModeEnabled] = useState(false);
  const [pendingResearch, setPendingResearch] = useState<ResearchPlanResponse['researchPlan'] | null>(null);
  const providerLabel = providerMeta[provider].label;
  const isCodexCli = provider === 'codex-cli';
  const [activeJumpTurnId, setActiveJumpTurnId] = useState<string | null>(null);
  const [activeJumpIndex, setActiveJumpIndex] = useState<number | null>(null);
  const consumedJumpNonceRef = React.useRef<number | null>(null);
  const [history, setHistory] = useState([
    { type: 'cmd', text: `${provider}-agent ready`, prompt: true },
    { type: 'info', text: `Initializing ${providerLabel} agent...`, color: 'text-slate-500' },
    { type: 'info', text: 'Session context: ' + title, color: 'text-blue-400/70' },
    { type: 'info', text: 'Status: Web terminal attached.', color: 'text-secondary' },
  ]);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (provider !== 'codex' && provider !== 'codex-cli') return;

    let cancelled = false;

    fetch(`${API_BASE_URL}/agent-options/codex`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Failed to load Codex options')))
      .then((data: CodexOptionsResponse) => {
        if (cancelled) return;
        setCodexOptions(data);
        setCodexModel(current => data.models.some(option => option.id === current) ? current : data.defaults.model);
        setCodexReasoningEffort(current => data.reasoningEfforts.some(option => option.id === current) ? current : data.defaults.reasoningEffort);
      })
      .catch(() => {
        if (cancelled) return;
        setCodexOptions(fallbackCodexOptions);
        setCodexModel(current => fallbackCodexOptions.models.some(option => option.id === current) ? current : fallbackCodexOptions.defaults.model);
        setCodexReasoningEffort(current => fallbackCodexOptions.reasoningEfforts.some(option => option.id === current) ? current : fallbackCodexOptions.defaults.reasoningEffort);
      });

    return () => {
      cancelled = true;
    };
  }, [provider]);

  React.useEffect(() => {
    let cancelled = false;

    setHistory([
      { type: 'cmd', text: `${provider}-agent ready`, prompt: true },
      { type: 'info', text: `Initializing ${providerLabel} agent...`, color: 'text-slate-500' },
      { type: 'info', text: 'Session context: ' + title, color: 'text-blue-400/70' },
      { type: 'info', text: 'Status: Web terminal attached.', color: 'text-secondary' },
    ]);

    fetch(`${API_BASE_URL}/sessions/${sessionId}/messages`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Failed to load messages')))
      .then((data: { messages: ApiMessage[], turns: ApiTurn[] }) => {
        if (cancelled) return;
        const latestTitle = [...data.messages].reverse().find((message) => message.taskTitle)?.taskTitle;
        if (latestTitle) onTaskTitle(latestTitle, sessionId);
        onMessagesLoaded(sessionId, data.messages, data.turns || []);
        let userTurnIndex = 0;
        setHistory(prev => [
          ...prev,
          ...data.messages.flatMap((message) => (
            message.role === 'assistant'
              ? buildTerminalHistoryLines(message.content, 'text-slate-300', 'info')
              : (() => {
                  const turnId = message.role === 'user'
                    ? (data.turns?.[userTurnIndex++]?.id || message.id)
                    : undefined;
                  return [{
                    id: turnId ? `terminal-turn-${turnId}` : undefined,
                    turnId,
                    type: message.role === 'user' ? 'cmd' : 'info',
                    text: message.content,
                    prompt: message.role === 'user',
                    color: undefined
                  }];
                })()
          ))
        ]);
      })
      .catch((error) => {
        if (cancelled) return;
        setHistory(prev => [...prev, { type: 'error', text: error.message, color: 'text-error' }]);
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId, provider, providerLabel, title]);

  React.useEffect(() => {
    if (jumpTarget && consumedJumpNonceRef.current !== jumpTarget.nonce) return;
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history, jumpTarget]);

  React.useEffect(() => {
    if (!jumpTarget) {
      console.log('[ReviewDock jump] skipped: no jumpTarget');
      return;
    }
    if (consumedJumpNonceRef.current === jumpTarget.nonce) {
      console.log('[ReviewDock jump] skipped: target already consumed', jumpTarget);
      return;
    }
    if (!scrollRef.current) {
      console.log('[ReviewDock jump] skipped: scroll container missing', jumpTarget);
      return;
    }
    const targetText = normalizeJumpText(jumpTarget.text);
    const targetIndex = history.findIndex((line) => (
      line.turnId === jumpTarget.turnId ||
      line.id === jumpTarget.anchorId ||
      (line.prompt && targetText.length > 0 && normalizeJumpText(line.text) === targetText)
    ));
    const target = targetIndex >= 0
      ? scrollRef.current.querySelector<HTMLElement>(`[data-history-index="${targetIndex}"]`)
      : document.getElementById(jumpTarget.anchorId);
    console.log('[ReviewDock jump] requested', {
      jumpTarget,
      historyCount: history.length,
      scrollTop: scrollRef.current.scrollTop,
      scrollHeight: scrollRef.current.scrollHeight,
      clientHeight: scrollRef.current.clientHeight,
      targetIndex,
      targetFound: !!target,
      availableAnchors: history
        .map((line, index) => ({ index, id: line.id, turnId: line.turnId, prompt: !!line.prompt, text: line.text.slice(0, 80) }))
        .filter((line) => line.id || line.prompt)
    });
    if (!target) {
      console.log('[ReviewDock jump] failed: target not found', {
        wantedTurnId: jumpTarget.turnId,
        wantedAnchorId: jumpTarget.anchorId,
        wantedText: targetText.slice(0, 160)
      });
      return;
    }
    const containerRect = scrollRef.current.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextTop = Math.max(0, scrollRef.current.scrollTop + targetRect.top - containerRect.top - scrollRef.current.clientHeight / 3);
    console.log('[ReviewDock jump] scrolling', {
      before: scrollRef.current.scrollTop,
      nextTop,
      containerRect,
      targetRect
    });
    scrollRef.current.scrollTo({
      top: nextTop,
      behavior: 'smooth'
    });
    consumedJumpNonceRef.current = jumpTarget.nonce;
    window.setTimeout(() => {
      console.log('[ReviewDock jump] after scroll', {
        after: scrollRef.current?.scrollTop,
        anchorId: jumpTarget.anchorId
      });
    }, 350);
    setActiveJumpTurnId(jumpTarget.turnId);
    setActiveJumpIndex(targetIndex >= 0 ? targetIndex : null);
    window.setTimeout(() => {
      setActiveJumpTurnId(null);
      setActiveJumpIndex(null);
    }, 1600);
  }, [jumpTarget, history]);

  React.useEffect(() => {
    return () => {
      setAttachments(current => {
        current.forEach((attachment) => URL.revokeObjectURL(attachment.previewUrl));
        return current;
      });
    };
  }, []);

  const removeAttachment = (id: string) => {
    setAttachments(prev => {
      const removed = prev.find(attachment => attachment.id === id);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return prev.filter(attachment => attachment.id !== id);
    });
  };

  const handlePaste = (event: React.ClipboardEvent) => {
    if (provider !== 'codex' && provider !== 'codex-cli') return;

    const images = Array.from(event.clipboardData.files as FileList).filter((file: File) => file.type.startsWith('image/'));
    if (images.length === 0) return;

    event.preventDefault();
    setAttachments(prev => [
      ...prev,
      ...images.slice(0, Math.max(0, 5 - prev.length)).map(file => ({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file)
      }))
    ]);
  };

  const handleCommand = async (e: React.FormEvent) => {
    e.preventDefault();
    const prompt = input.trim() || (attachments.length > 0 ? 'Please analyze the attached image.' : '');
    if (!prompt || isRunning) return;

    const attachmentCount = attachments.length;
    const localTurnId = `turn-${(history.filter((line) => line.prompt).length || 0) + 1}`;
    const newCmd = {
      id: `terminal-local-${localTurnId}`,
      turnId: localTurnId,
      type: 'cmd',
      text: attachmentCount > 0 ? `${prompt}\n[${attachmentCount} image attachment${attachmentCount === 1 ? '' : 's'}]` : prompt,
      prompt: true
    };
    setActiveJumpTurnId(null);
    setActiveJumpIndex(null);
    setHistory(prev => [...prev, newCmd]);
    const localCommand = prompt.toLowerCase();
    if (localCommand === 'clear') {
      setHistory([{ type: 'cmd', text: `${provider}-agent ready`, prompt: true }]);
      setInput('');
      return;
    }

    setInput('');
    const filesToSend = attachments.map(attachment => attachment.file);
    if (researchConfirmEnabled && provider === 'codex' && filesToSend.length > 0) {
      setHistory(prev => [...prev, { type: 'error', text: '调研确认暂不支持图片附件，请先关闭调研确认或移除图片。', color: 'text-error' }]);
      setIsRunning(false);
      onRunStatusChange(sessionId, 'idle');
      return;
    }
    attachments.forEach(attachment => URL.revokeObjectURL(attachment.previewUrl));
    setAttachments([]);
    setIsRunning(true);
    onRunStatusChange(sessionId, 'busy');
    onRunCommand(prompt);

    try {
      if (researchConfirmEnabled && provider === 'codex') {
        setHistory(prev => [...prev, {
          type: 'info',
          text: `Codex 正在调研本次任务预计涉及的文件...`,
          color: 'text-amber-300'
        }]);
        const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/research`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt,
            model: codexModel,
            reasoningEffort: codexReasoningEffort
          })
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || 'Codex 调研失败');
        }

        const payload = await response.json() as ResearchPlanResponse;
        setPendingResearch(payload.researchPlan);
        const files = payload.researchPlan.files.length > 0
          ? payload.researchPlan.files.map((file) => `${file.action} ${file.path}: ${file.reason}`).join('\n')
          : '未明确预计文件';
        const risks = payload.researchPlan.risks.length > 0 ? `\n风险/不确定性:\n${payload.researchPlan.risks.join('\n')}` : '';
        setHistory(prev => [...prev, {
          type: 'research',
          text: `Codex 调研完成\n${payload.researchPlan.summary}\n置信度: ${payload.researchPlan.confidence}\n\n预计文件:\n${files}${risks}`,
          color: 'text-amber-200'
        }]);
        fetch(`${API_BASE_URL}/sessions/${sessionId}/messages`)
          .then((response) => response.ok ? response.json() : Promise.reject(new Error('Failed to reload research message')))
          .then((payload: { messages: ApiMessage[], turns: ApiTurn[] }) => onMessagesLoaded(sessionId, payload.messages, payload.turns || []))
          .catch(() => undefined);
        return;
      }

      const isCodexProvider = provider === 'codex' || provider === 'codex-cli';
      const body = isCodexProvider && filesToSend.length > 0
        ? (() => {
            const formData = new FormData();
            formData.append('prompt', prompt);
            formData.append('model', codexModel);
            formData.append('reasoningEffort', codexReasoningEffort);
            formData.append('askMode', String(askModeEnabled));
            filesToSend.forEach(file => formData.append('attachments', file));
            return formData;
          })()
        : JSON.stringify({
            prompt,
            model: codexModel,
            reasoningEffort: codexReasoningEffort,
            askMode: askModeEnabled
          });

      const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/turns`, {
        method: 'POST',
        headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
        body
      });

      if (!response.ok || !response.body) {
        throw new Error(`Failed to run ${providerLabel} session`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const handleSseBlock = (block: string) => {
        const event = block.split('\n').find(line => line.startsWith('event: '))?.slice(7);
        const dataLine = block.split('\n').find(line => line.startsWith('data: '));
        if (!event || !dataLine) return;

        const data = JSON.parse(dataLine.slice(6));
        if (event === 'status') {
          const statusText = data.status === 'analyzing_images'
            ? `[analyzing_images] ${providerLabel} received ${data.attachmentCount} image${data.attachmentCount === 1 ? '' : 's'} for ${data.model}${data.timeoutSeconds ? `, timeout ${data.timeoutSeconds}s` : ', no timeout'}`
            : `[${data.status}] ${providerLabel}${data.askMode ? ' ASK' : ''}${data.status === 'started' && data.model ? ` (${data.model}, ${data.reasoningEffort})` : ''}`;
          setHistory(prev => [...prev, { type: 'info', text: statusText, color: data.status === 'completed' ? 'text-secondary' : 'text-blue-400' }]);
        }
        if (event === 'task_title') {
          onTaskTitle(data.title, sessionId);
          setHistory(prev => [...prev, { type: 'info', text: `Task: ${data.title}`, color: 'text-blue-400' }]);
        }
        if (event === 'chunk') {
          setHistory(prev => [...prev, buildTerminalHistoryLine(
            data.text,
            data.stream === 'stderr' ? 'text-error' : 'text-slate-300',
            data.stream === 'stderr' ? 'error' : 'info'
          )]);
        }
        if (event === 'file_change') {
          setHistory(prev => [...prev, { type: 'info', text: `Files changed: ${data.changes.map((change: { kind: string, path: string }) => `${change.kind} ${change.path}`).join(', ')}`, color: 'text-blue-400' }]);
        }
        if (event === 'error') {
          setHistory(prev => [...prev, { type: 'error', text: data.message, color: 'text-error' }]);
        }
        if (event === 'done') {
          fetch(`${API_BASE_URL}/sessions/${sessionId}/messages`)
            .then((response) => response.ok ? response.json() : Promise.reject(new Error('Failed to reload turn details')))
            .then((payload: { messages: ApiMessage[], turns: ApiTurn[] }) => onMessagesLoaded(sessionId, payload.messages, payload.turns || []))
            .catch(() => undefined);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';
        blocks.forEach(handleSseBlock);
      }
    } catch (error) {
      setHistory(prev => [...prev, {
        type: 'error',
        text: error instanceof Error ? error.message : 'Agent run failed',
        color: 'text-error'
      }]);
    } finally {
      setIsRunning(false);
      onRunStatusChange(sessionId, 'idle');
    }
  };

  const runConfirmedResearch = async () => {
    if (!pendingResearch || isRunning) return;
    const research = pendingResearch;
    setPendingResearch(null);
    setIsRunning(true);
    onRunStatusChange(sessionId, 'busy');
    onRunCommand(research.prompt);

    try {
      const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/turns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: research.prompt,
          model: codexModel,
          reasoningEffort: codexReasoningEffort,
          researchPlanId: research.id
        })
      });

      if (!response.ok || !response.body) {
        throw new Error(`Failed to run ${providerLabel} session`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const handleSseBlock = (block: string) => {
        const event = block.split('\n').find(line => line.startsWith('event: '))?.slice(7);
        const dataLine = block.split('\n').find(line => line.startsWith('data: '));
        if (!event || !dataLine) return;
        const data = JSON.parse(dataLine.slice(6));
        if (event === 'status') {
          setHistory(prev => [...prev, { type: 'info', text: `[${data.status}] ${providerLabel}${data.askMode ? ' ASK' : ''}${data.status === 'started' && data.model ? ` (${data.model}, ${data.reasoningEffort})` : ''}`, color: data.status === 'completed' ? 'text-secondary' : 'text-blue-400' }]);
        }
        if (event === 'task_title') {
          onTaskTitle(data.title, sessionId);
          setHistory(prev => [...prev, { type: 'info', text: `Task: ${data.title}`, color: 'text-blue-400' }]);
        }
        if (event === 'research_confirmed') {
          setHistory(prev => [...prev, { type: 'info', text: `Research confirmed: ${data.plannedFiles.length} planned files`, color: 'text-amber-300' }]);
        }
        if (event === 'chunk') {
          setHistory(prev => [...prev, buildTerminalHistoryLine(
            data.text,
            data.stream === 'stderr' ? 'text-error' : 'text-slate-300',
            data.stream === 'stderr' ? 'error' : 'info'
          )]);
        }
        if (event === 'file_change') {
          setHistory(prev => [...prev, { type: 'info', text: `Files changed: ${data.changes.map((change: { kind: string, path: string }) => `${change.kind} ${change.path}`).join(', ')}`, color: 'text-blue-400' }]);
        }
        if (event === 'error') {
          setHistory(prev => [...prev, { type: 'error', text: data.message, color: 'text-error' }]);
        }
        if (event === 'done') {
          fetch(`${API_BASE_URL}/sessions/${sessionId}/messages`)
            .then((response) => response.ok ? response.json() : Promise.reject(new Error('Failed to reload turn details')))
            .then((payload: { messages: ApiMessage[], turns: ApiTurn[] }) => onMessagesLoaded(sessionId, payload.messages, payload.turns || []))
            .catch(() => undefined);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop() || '';
        blocks.forEach(handleSseBlock);
      }
    } catch (error) {
      setHistory(prev => [...prev, { type: 'error', text: error instanceof Error ? error.message : 'Agent run failed', color: 'text-error' }]);
    } finally {
      setIsRunning(false);
      onRunStatusChange(sessionId, 'idle');
    }
  };

  if (isCodexCli) {
    return (
      <CodexCliTerminal
        sessionId={sessionId}
        title={title}
        providerLabel={providerLabel}
        onMessagesLoaded={onMessagesLoaded}
        onRunStatusChange={onRunStatusChange}
      />
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-6 p-6">
      <div className="shrink-0 flex justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold font-display text-on-surface">{providerLabel} CLI</h1>
          <div className="flex gap-2">
            <span className={`px-2 py-1 text-[10px] font-bold uppercase tracking-widest rounded border ${
              isRunning
                ? 'border-amber-400/30 bg-amber-400/10 text-amber-300'
                : 'border-secondary/20 bg-secondary/10 text-secondary'
            }`}>
              STATUS: {isRunning ? 'BUSY' : 'READY'}
            </span>
            <span className="px-2 py-1 bg-slate-800 text-slate-400 text-[10px] font-bold border border-slate-700 rounded">SESSION: {sessionId.slice(-6)}</span>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-3">
          {provider === 'codex' && (
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-2 rounded border border-slate-800 bg-slate-900 px-2 py-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Model</span>
                <select
                  value={codexModel}
                  disabled={isRunning}
                  onChange={(event) => setCodexModel(event.target.value)}
                  className="bg-transparent text-xs font-bold text-blue-300 outline-none disabled:cursor-not-allowed disabled:text-slate-600"
                >
                  {codexOptions.models.map((option) => (
                    <option key={option.id} value={option.id} className="bg-slate-950 text-slate-200">
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 rounded border border-slate-800 bg-slate-900 px-2 py-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Thinking</span>
                <select
                  value={codexReasoningEffort}
                  disabled={isRunning}
                  onChange={(event) => setCodexReasoningEffort(event.target.value as CodexReasoningEffort)}
                  className="bg-transparent text-xs font-bold text-blue-300 outline-none disabled:cursor-not-allowed disabled:text-slate-600"
                >
                  {codexOptions.reasoningEfforts.map((option) => (
                    <option key={option.id} value={option.id} className="bg-slate-950 text-slate-200">
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <span className="truncate text-slate-500 text-xs font-medium uppercase tracking-tight font-display">{title}</span>
        </div>
      </div>

      <div
        onPaste={handlePaste}
        className="flex-1 min-h-0 bg-slate-950 border border-slate-800 rounded-lg overflow-hidden flex flex-col shadow-2xl"
      >
        <div className="shrink-0 bg-slate-900 px-4 py-2 flex items-center justify-between border-b border-slate-800">
          <div className="flex gap-1.5">
            <div className="w-3 h-3 rounded-full bg-slate-700"></div>
            <div className="w-3 h-3 rounded-full bg-slate-700"></div>
            <div className="w-3 h-3 rounded-full bg-slate-700"></div>
          </div>
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-widest">zsh — {provider}-agent</span>
          <Download size={14} className="text-slate-500 cursor-pointer hover:text-slate-300" />
        </div>
        
        <div 
          ref={scrollRef}
          className="flex-1 min-h-0 p-4 font-mono text-sm text-slate-300 overflow-y-auto leading-relaxed hide-scrollbar bg-slate-950/50"
        >
          <div className="space-y-1">
            {history.map((line, i) => (
              <TerminalHistoryItem
                key={i}
                line={line}
                index={i}
                active={i === activeJumpIndex || (!!line.turnId && line.turnId === activeJumpTurnId)}
              />
            ))}
            {pendingResearch && (
              <div className="mt-3 rounded border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">
                <div className="mb-2 font-bold uppercase tracking-widest text-amber-200">等待确认执行</div>
                <div className="mb-2 text-slate-200">{pendingResearch.summary}</div>
                <div className="max-h-36 overflow-y-auto rounded border border-amber-400/20 bg-slate-950/60 p-2 font-mono text-[11px] hide-scrollbar">
                  {pendingResearch.files.length === 0 ? (
                    <div className="text-amber-300">未明确预计文件</div>
                  ) : (
                    pendingResearch.files.map((file) => (
                      <div key={`${pendingResearch.id}:${file.path}`} className="mb-1">
                        <span className="text-amber-300">{file.action}</span> <span className="text-slate-200">{file.path}</span>
                        <span className="text-slate-500"> - {file.reason}</span>
                      </div>
                    ))
                  )}
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={runConfirmedResearch}
                    className="rounded bg-amber-400 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-950 disabled:opacity-50"
                  >
                    确认执行
                  </button>
                  <button
                    type="button"
                    disabled={isRunning}
                    onClick={() => setPendingResearch(null)}
                    className="rounded border border-slate-700 px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-200 disabled:opacity-50"
                  >
                    取消
                  </button>
                </div>
              </div>
            )}
            {isCodexCli && (
              <form onSubmit={handleCommand} className="flex items-center gap-2 pt-1">
                <span className="text-blue-400 font-bold shrink-0">➜</span>
                <span className="text-slate-500 font-bold select-none whitespace-nowrap">{title}</span>
                <input
                  autoFocus
                  disabled={isRunning}
                  className="min-w-0 flex-1 bg-transparent border-none outline-none text-blue-300 placeholder:text-blue-900/40"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={isRunning ? `${providerLabel} is running...` : 'type a Codex CLI prompt...'}
                />
                <div className={`h-5 w-2 ${isRunning ? 'bg-secondary' : 'bg-blue-500'} animate-pulse`}></div>
              </form>
            )}
          </div>
        </div>

        <div className={`shrink-0 border-t border-slate-800 bg-slate-950 ${isCodexCli && attachments.length === 0 ? 'hidden' : ''}`}>
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 border-b border-slate-800 px-4 py-3">
              {attachments.map((attachment) => (
                <div key={attachment.id} className="group relative h-16 w-16 overflow-hidden rounded border border-slate-700 bg-slate-900">
                  <img
                    src={attachment.previewUrl}
                    alt={attachment.file.name || 'Pasted image'}
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeAttachment(attachment.id)}
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded bg-slate-950/80 text-slate-300 opacity-0 transition-opacity hover:text-red-300 group-hover:opacity-100"
                    aria-label="Remove image"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
              <div className="flex h-16 min-w-32 items-center gap-2 rounded border border-dashed border-blue-500/30 px-3 text-[10px] font-bold uppercase tracking-wider text-blue-300/80">
                <ImageIcon size={14} />
                {attachments.length}/5 images
              </div>
            </div>
          )}

          {!isCodexCli && (
            <form onSubmit={handleCommand} className="flex items-center gap-2 px-4 py-3 font-mono text-sm">
              <span className="text-blue-400 font-bold">➜</span>
              <span className="text-slate-500 font-bold select-none whitespace-nowrap">nexus-gateway</span>
              {provider === 'codex' && (
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => {
                    setAskModeEnabled((current) => {
                      const next = !current;
                      if (next) {
                        setResearchConfirmEnabled(false);
                        setPendingResearch(null);
                      }
                      return next;
                    });
                  }}
                  className={`shrink-0 rounded border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    askModeEnabled
                      ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-200'
                      : 'border-slate-800 bg-slate-900 text-slate-500 hover:border-blue-500 hover:text-blue-300'
                  }`}
                  title="开启后本次对话只允许读取和回复，不允许修改文件"
                >
                  Ask：{askModeEnabled ? '开' : '关'}
                </button>
              )}
              {provider === 'codex' && (
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => {
                    setResearchConfirmEnabled((current) => {
                      const next = !current;
                      if (next) setAskModeEnabled(false);
                      return next;
                    });
                  }}
                  className={`shrink-0 rounded border px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                    researchConfirmEnabled
                      ? 'border-amber-400/50 bg-amber-400/10 text-amber-200'
                      : 'border-slate-800 bg-slate-900 text-slate-500 hover:border-blue-500 hover:text-blue-300'
                  }`}
                  title="开启后先让 Codex 只做调研，确认后再执行"
                >
                  调研确认：{researchConfirmEnabled ? '开' : '关'}
                </button>
              )}
              <input
                autoFocus
                disabled={isRunning}
                className="min-w-0 flex-1 bg-transparent border-none outline-none text-blue-300 placeholder:text-blue-900/40"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                placeholder={isRunning ? `${providerLabel} is running...` : provider === 'codex' ? 'Ask the coding agent or paste images...' : 'Ask the coding agent...'}
              />
              <div className={`w-2 h-5 ${isRunning ? 'bg-secondary' : 'bg-blue-500'} animate-pulse`}></div>
            </form>
          )}
        </div>
      </div>

    </div>
  );
};

const StatCard = ({ label, value, color, progress, subtext, indicator }: any) => {
  const colorClasses: any = {
    blue: 'text-blue-400 bg-blue-500',
    green: 'text-secondary bg-secondary',
    tertiary: 'text-tertiary bg-tertiary',
  };

  return (
    <div className="bg-surface-container border border-slate-800 p-4 rounded-lg flex flex-col justify-between hover:border-slate-700 transition-colors cursor-default">
      <span className="text-slate-500 font-bold text-[10px] uppercase tracking-wider">{label}</span>
      <div className={`text-2xl font-bold font-display ${colorClasses[color].split(' ')[0]}`}>{value}</div>
      {progress !== undefined && (
        <div className="w-full h-1 bg-slate-800 rounded-full mt-2 overflow-hidden">
          <motion.div 
            initial={{ width: 0 }} 
            animate={{ width: `${progress}%` }} 
            className={`h-full ${colorClasses[color].split(' ')[1]}`}
          />
        </div>
      )}
      {subtext && <span className="text-[10px] text-slate-600">{subtext}</span>}
      {indicator && (
        <div className="flex gap-1">
          {[0.2, 0.4, 0.6, 1].map((op, i) => (
            <div key={i} className={`h-4 w-1 bg-tertiary`} style={{ opacity: op }}></div>
          ))}
        </div>
      )}
    </div>
  );
};

const findFirstTurnWithFilesIndex = (items: Turn[]) => {
  const index = items.findIndex((item) => item.modifiedFiles.length > 0);
  return index >= 0 ? index : 0;
};

const ReviewCommentDialog = ({
  note,
  reviewed,
  error,
  onChangeNote,
  onClose,
  onSave
}: {
  note: string;
  reviewed: boolean;
  error?: string;
  onChangeNote: (note: string) => void;
  onClose: () => void;
  onSave: () => void;
}) => {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div className="fixed right-10 top-36 z-[1000] w-[34rem] rounded border border-blue-500/50 bg-slate-950 p-4 shadow-[0_24px_90px_rgba(0,0,0,0.85),0_0_0_1px_rgba(59,130,246,0.28)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-blue-300">
          <MessageSquare size={14} />
          修改批注
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-slate-500 hover:bg-slate-900 hover:text-slate-200"
          aria-label="Close comment"
        >
          <X size={14} />
        </button>
      </div>
      <textarea
        value={note}
        onChange={(event) => onChangeNote(event.target.value)}
        onBlur={onSave}
        placeholder="备注"
        rows={7}
        className="max-h-64 min-h-36 w-full resize-y rounded border border-slate-800 bg-slate-900/90 px-3 py-2 text-[13px] leading-relaxed text-slate-100 outline-none placeholder:text-slate-600 focus:border-blue-500"
      />
      {error ? (
        <div className="mt-2 rounded border border-red-400/30 bg-red-500/10 px-2 py-1 text-[11px] text-red-200">
          {error}
        </div>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">
          {reviewed ? 'Reviewed' : 'Pending Review'}
        </span>
        <button
          type="button"
          onClick={onSave}
          className="rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-300 transition-colors hover:border-blue-500 hover:text-blue-300"
        >
          保存
        </button>
      </div>
    </div>,
    document.body
  );
};

const TurnDetailModal = ({ turn, turns, workspace, onClose }: { turn: Turn, turns?: Turn[], workspace?: WorkspaceProject, onClose: () => void }) => {
  const initialTurns = turns && turns.length > 0 ? turns : [turn];
  const [detailTurns, setDetailTurns] = useState<Turn[]>(initialTurns);
  const [selectedTurnIndex, setSelectedTurnIndex] = useState(() => findFirstTurnWithFilesIndex(initialTurns));
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [reviewMode, setReviewMode] = useState<'compare' | 'annotated'>('annotated');
  const [activeChangeRowId, setActiveChangeRowId] = useState<string | null>(null);
  const [changeNotes, setChangeNotes] = useState<Record<string, string>>({});
  const [reviewedChanges, setReviewedChanges] = useState<Record<string, boolean>>({});
  const [explainingChanges, setExplainingChanges] = useState<Record<string, boolean>>({});
  const [changeErrors, setChangeErrors] = useState<Record<string, string>>({});
  const [openCommentKey, setOpenCommentKey] = useState<string | null>(null);
  const [isUnreviewedOpen, setIsUnreviewedOpen] = useState(false);
  const [pendingReviewJump, setPendingReviewJump] = useState<{ fileIndex: number; groupId: string } | null>(null);
  const [storySelection, setStorySelection] = useState<{ text: string; startLine: number; endLine: number } | null>(null);
  const [storyEntries, setStoryEntries] = useState<CodeHistoryEntry[]>([]);
  const [isStoryLoading, setIsStoryLoading] = useState(false);
  const [storyError, setStoryError] = useState('');
  const [isStoryDialogOpen, setIsStoryDialogOpen] = useState(false);
  const annotatedScrollRef = useRef<HTMLDivElement | null>(null);
  const ignoreNextAnnotatedScrollRef = useRef(false);
  const detailTurn = detailTurns[selectedTurnIndex] || initialTurns[0] || turn;

  useEffect(() => {
    let cancelled = false;

    Promise.all(initialTurns.map((item) => (
      fetch(`${API_BASE_URL}/turns/${item.id}`)
        .then((response) => response.ok ? response.json() : Promise.reject(new Error('Failed to load turn details')))
        .then((data: ApiTurn) => ({ item, data }))
    )))
      .then((items) => {
        if (cancelled) return;
        const hydratedTurns: Turn[] = items.map(({ item, data }) => ({
          ...item,
          summary: data.assistantContent || item.summary,
          modifiedFiles: data.modifiedFiles.map((file) => ({
            name: file.path,
            status: file.kind === 'add' ? 'A' : file.kind === 'delete' ? 'D' : 'M',
            statusColor: file.kind === 'add' ? 'text-blue-400' : file.kind === 'delete' ? 'text-error' : 'text-secondary',
            scopeStatus: file.scopeStatus,
            content: file.content,
            beforeContent: file.beforeContent || null,
            afterContent: file.afterContent || file.content || null,
            diffSnippet: file.afterContent || file.content || ''
          }))
        }));
        setDetailTurns(hydratedTurns);
        setSelectedTurnIndex((current) => (
          hydratedTurns[current]?.modifiedFiles.length > 0 ? current : findFirstTurnWithFilesIndex(hydratedTurns)
        ));
        setSelectedFileIndex(0);
        setChangeNotes(Object.fromEntries(items.flatMap(({ item, data }) => (data.reviewNotes || []).map((note) => [
          `${item.id}:${note.filePath}:${note.groupId}`,
          note.note
        ]))));
        setReviewedChanges(Object.fromEntries(items.flatMap(({ item, data }) => (data.reviewNotes || []).map((note) => [
          `${item.id}:${note.filePath}:${note.groupId}`,
          note.reviewed
        ]))));
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [turn, turns]);

  useEffect(() => {
    setReviewMode('annotated');
    setActiveChangeRowId(null);
    setStorySelection(null);
    setStoryEntries([]);
    setStoryError('');
    setIsStoryDialogOpen(false);
    annotatedScrollRef.current?.scrollTo({ top: 0 });
  }, [selectedFileIndex, selectedTurnIndex]);

  useEffect(() => {
    setSelectedFileIndex(0);
    setActiveChangeRowId(null);
    setOpenCommentKey(null);
    setStorySelection(null);
    setStoryEntries([]);
    setStoryError('');
    setIsStoryDialogOpen(false);
  }, [selectedTurnIndex]);

  const selectedFile = detailTurn.modifiedFiles[selectedFileIndex];
  const hasAnyModifiedFiles = detailTurns.some((item) => item.modifiedFiles.length > 0);
  useEffect(() => {
    const fileCount = detailTurn.modifiedFiles.length;
    if (selectedFileIndex >= fileCount) {
      setSelectedFileIndex(0);
    }
    if (fileCount === 0 && hasAnyModifiedFiles) {
      setSelectedTurnIndex(findFirstTurnWithFilesIndex(detailTurns));
    }
  }, [detailTurn.modifiedFiles.length, detailTurns, hasAnyModifiedFiles, selectedFileIndex]);
  const reviewableFileSummaries = useMemo(() => detailTurn.modifiedFiles.map((file, fileIndex) => {
    if (file.status !== 'M' || reviewDiffUnavailableText(file)) {
      return { file, fileIndex, groups: [] as Array<{ id: string; kind: 'add' | 'delete' | 'update'; rows: AnnotatedRow[] }> };
    }

    const rows = renderAnnotatedCurrentLines(file.beforeContent, file.afterContent);
    return {
      file,
      fileIndex,
      groups: groupAdjacentChanges(rows).groups
    };
  }), [detailTurn.modifiedFiles]);
  const reviewStats = useMemo(() => {
    const groups = reviewableFileSummaries.flatMap(({ file, fileIndex, groups }) => groups.map((group) => {
      const stateKey = `${detailTurn.id}:${file.name}:${group.id}`;
      return {
        file,
        fileIndex,
        group,
        stateKey
      };
    }));
    const selectedFileGroups = groups.filter((item) => item.fileIndex === selectedFileIndex);
    const reviewed = selectedFileGroups.filter((item) => reviewedChanges[item.stateKey]).length;

    return {
      fileCount: detailTurn.modifiedFiles.length,
      blockCount: selectedFileGroups.length,
      reviewed,
      unreviewed: selectedFileGroups.length - reviewed,
      unreviewedItems: selectedFileGroups.filter((item) => !reviewedChanges[item.stateKey])
    };
  }, [detailTurn.id, detailTurn.modifiedFiles.length, reviewableFileSummaries, reviewedChanges, selectedFileIndex]);
  const annotatedRows = useMemo(() => {
    if (!selectedFile || selectedFile.status !== 'M' || reviewDiffUnavailableText(selectedFile)) return [];
    return renderAnnotatedCurrentLines(selectedFile.beforeContent, selectedFile.afterContent);
  }, [selectedFile]);
  const changeGroups = useMemo(() => groupAdjacentChanges(annotatedRows), [annotatedRows]);
  const changeStateKey = (groupId: string) => `${detailTurn.id}:${selectedFile?.name ?? 'unknown'}:${groupId}`;
  useEffect(() => {
    if (!pendingReviewJump || pendingReviewJump.fileIndex !== selectedFileIndex) return;
    jumpToAnnotatedGroup(pendingReviewJump.groupId);
    setPendingReviewJump(null);
  }, [pendingReviewJump, selectedFileIndex, changeGroups]);
  const noteSummary = (note: string | undefined) => {
    const normalized = (note || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '添加备注';
    return normalized.length > 34 ? `${normalized.slice(0, 34)}...` : normalized;
  };
  const jumpToAnnotatedGroup = (groupId: string) => {
    const group = changeGroups.groups.find((item) => item.id === groupId);
    const firstRow = group?.rows[0];
    const container = annotatedScrollRef.current;
    const target = firstRow ? document.getElementById(firstRow.id) : null;
    if (!container || !target) return;
    setActiveChangeRowId(groupId);
    ignoreNextAnnotatedScrollRef.current = true;
    container.scrollTo({
      top: target.offsetTop - container.offsetTop - 24,
      behavior: 'smooth'
    });
  };
  const handleAnnotatedScroll = () => {
    if (ignoreNextAnnotatedScrollRef.current) {
      ignoreNextAnnotatedScrollRef.current = false;
    }
  };
  const querySelectedCodeStory = async (selection: { text: string; startLine: number; endLine: number }) => {
    if (!workspace || !selectedFile || !selection.text.trim()) return;

    setIsStoryLoading(true);
    setStoryError('');
    try {
      const response = await fetch(`${API_BASE_URL}/workspaces/${workspace.id}/code-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: selectedFile.name,
          selectedText: selection.text,
          startLine: selection.startLine,
          endLine: selection.endLine
        })
      });

      if (!response.ok) throw new Error('加载故事线失败');
      const payload = await response.json() as { entries: CodeHistoryEntry[] };
      setStoryEntries(payload.entries);
    } catch (error) {
      setStoryError(error instanceof Error ? error.message : '加载故事线失败');
    } finally {
      setIsStoryLoading(false);
    }
  };
  const handleReviewCodeSelection = () => {
    if (!workspace || !selectedFile) return;
    const selectedText = window.getSelection()?.toString() ?? '';
    if (!selectedText.trim()) return;

    const browserSelection = window.getSelection();
    const anchorElement = browserSelection?.anchorNode?.parentElement?.closest('[data-review-line-number]') as HTMLElement | null;
    const focusElement = browserSelection?.focusNode?.parentElement?.closest('[data-review-line-number]') as HTMLElement | null;
    const anchorLine = Number(anchorElement?.dataset.reviewLineNumber);
    const focusLine = Number(focusElement?.dataset.reviewLineNumber);
    const domLines = [anchorLine, focusLine].filter((lineNumber) => Number.isFinite(lineNumber) && lineNumber > 0);
    const lineMatches = domLines.length > 0
      ? domLines
      : annotatedRows
        .filter((row) => row.text && selectedText.includes(row.text.trim()))
        .map((row) => row.lineNumber)
        .filter((lineNumber): lineNumber is number => typeof lineNumber === 'number');
    const fallbackLine = annotatedRows.find((row) => row.lineNumber !== null)?.lineNumber ?? 1;
    const selection = {
      text: selectedText,
      startLine: lineMatches.length > 0 ? Math.min(...lineMatches) : fallbackLine,
      endLine: lineMatches.length > 0 ? Math.max(...lineMatches) : fallbackLine
    };

    setStorySelection(selection);
    querySelectedCodeStory(selection).catch(() => undefined);
  };
  const jumpToReviewItem = (fileIndex: number, groupId: string) => {
    setIsUnreviewedOpen(false);
    setReviewMode('annotated');
    setOpenCommentKey(null);
    setPendingReviewJump({ fileIndex, groupId });
    if (fileIndex === selectedFileIndex) {
      jumpToAnnotatedGroup(groupId);
      setPendingReviewJump(null);
      return;
    }
    setSelectedFileIndex(fileIndex);
  };

  const persistChangeNote = async (groupId: string, note: string, reviewed: boolean) => {
    if (!selectedFile) return;

    const response = await fetch(`${API_BASE_URL}/turns/${detailTurn.id}/change-notes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filePath: selectedFile.name,
        groupId,
        note,
        reviewed
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(errorData?.error || `保存失败 (${response.status})`);
    }
  };

  const explainChangeGroup = async (groupId: string) => {
    if (!selectedFile) return;
    const group = changeGroups.groups.find((item) => item.id === groupId);
    if (!group) return;

    const stateKey = changeStateKey(groupId);
    const beforeText = group.rows
      .map((row) => row.kind === 'update' ? row.beforeText || '' : row.kind === 'delete' ? row.text : '')
      .filter(Boolean)
      .join('\n');
    const afterText = group.rows
      .map((row) => row.kind === 'delete' ? '' : row.text)
      .filter(Boolean)
      .join('\n');

    setExplainingChanges((current) => ({ ...current, [stateKey]: true }));
    setChangeErrors((current) => {
      const next = { ...current };
      delete next[stateKey];
      return next;
    });

    try {
      const response = await fetch(`${API_BASE_URL}/turns/${detailTurn.id}/changes/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: selectedFile.name,
          groupId,
          changeKind: group.kind,
          beforeText,
          afterText
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(errorData?.error || `解释失败 (${response.status})`);
      }

      const data = await response.json() as { explanation: string };
      setChangeNotes((current) => ({ ...current, [stateKey]: data.explanation }));
      await persistChangeNote(groupId, data.explanation, reviewedChanges[stateKey] ?? false);
    } catch (error) {
      setChangeErrors((current) => ({
        ...current,
        [stateKey]: error instanceof TypeError ? '连接后端失败' : error instanceof Error ? error.message : '解释失败'
      }));
    } finally {
      setExplainingChanges((current) => ({ ...current, [stateKey]: false }));
    }
  };

  const toggleReviewedChange = (groupId: string) => {
    const stateKey = changeStateKey(groupId);
    const nextReviewed = !reviewedChanges[stateKey];
    const nextGroup = nextReviewed
      ? changeGroups.groups.slice(changeGroups.groups.findIndex((group) => group.id === groupId) + 1).find((group) => !reviewedChanges[changeStateKey(group.id)])
      : null;
    setReviewedChanges((current) => ({
      ...current,
      [stateKey]: nextReviewed
    }));
    if (nextGroup) {
      setOpenCommentKey(null);
      window.setTimeout(() => jumpToAnnotatedGroup(nextGroup.id), 0);
    }
    persistChangeNote(groupId, changeNotes[stateKey] ?? '', nextReviewed).catch(() => {
      setChangeErrors((current) => ({ ...current, [stateKey]: '保存审核状态失败' }));
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/80 p-6 backdrop-blur-sm"
    >
      <motion.div
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="flex h-[92vh] w-[94vw] flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-950 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-6 border-b border-slate-800 p-4">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold uppercase tracking-widest text-blue-400">
              {detailTurns.length > 1 ? `批量代码审核 (${detailTurns.length})` : detailTurn.taskTitle || 'Untitled Task'}
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">
              {detailTurns.length > 1 ? `${detailTurn.taskTitle || 'Untitled Task'}: "${detailTurn.userMessage}"` : `"${detailTurn.userMessage}"`}
            </p>
          </div>
          <div className="flex shrink-0 items-start gap-4">
            <div className="flex items-center gap-2 rounded border border-slate-800 bg-slate-900/40 p-1">
              <div className="rounded px-3 py-2 text-center">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600">文件</div>
                <div className="mt-1 text-sm font-bold text-slate-200">{reviewStats.fileCount}</div>
              </div>
              <div className="rounded px-3 py-2 text-center">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600">当前修改块</div>
                <div className="mt-1 text-sm font-bold text-blue-300">{reviewStats.blockCount}</div>
              </div>
              <div className="rounded px-3 py-2 text-center">
                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600">当前已审</div>
                <div className="mt-1 text-sm font-bold text-secondary">{reviewStats.reviewed}</div>
              </div>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setIsUnreviewedOpen((current) => !current)}
                  className="rounded border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-center transition-colors hover:border-amber-300/60"
                >
                  <div className="text-[10px] font-bold uppercase tracking-widest text-amber-300/80">当前未审</div>
                  <div className="mt-1 text-sm font-bold text-amber-200">{reviewStats.unreviewed}</div>
                </button>
                {isUnreviewedOpen && (
                  <div className="absolute right-0 top-14 z-40 max-h-80 w-96 overflow-y-auto rounded border border-amber-400/30 bg-slate-950 p-2 shadow-[0_18px_60px_rgba(0,0,0,0.55)] hide-scrollbar">
                    {reviewStats.unreviewedItems.length === 0 ? (
                      <div className="px-3 py-6 text-center text-[11px] font-bold uppercase tracking-widest text-slate-600">全部已审核</div>
                    ) : (
                      <div className="space-y-1">
                        {reviewStats.unreviewedItems.map((item) => {
                          const firstRow = item.group.rows[0];
                          const preview = (firstRow?.text || firstRow?.beforeText || '').replace(/\s+/g, ' ').trim();

                          return (
                            <button
                              key={`pending-${item.stateKey}`}
                              type="button"
                              onClick={() => jumpToReviewItem(item.fileIndex, item.group.id)}
                              className="w-full rounded border border-slate-800 bg-slate-900/60 px-3 py-2 text-left transition-colors hover:border-blue-500/60 hover:bg-blue-500/10"
                            >
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] font-bold uppercase ${
                                  item.group.kind === 'add' ? 'text-green-300' : item.group.kind === 'delete' ? 'text-red-300' : 'text-yellow-300'
                                }`}>
                                  {item.group.kind}
                                </span>
                                <span className="truncate text-[11px] font-mono text-slate-300">{item.file.name}</span>
                              </div>
                              <div className="mt-1 truncate text-[11px] text-slate-500">{preview || `${item.group.rows.length} changed lines`}</div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <button onClick={onClose} className="rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-900 hover:text-slate-200" aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          {!hasAnyModifiedFiles ? (
            <div className="flex h-48 items-center justify-center text-xs font-bold uppercase tracking-widest text-slate-600">
              No file changes recorded for selected conversations
            </div>
          ) : (
            <div className="grid h-full min-h-0 grid-cols-12">
              <div className="col-span-3 border-r border-slate-800 overflow-y-auto p-3 hide-scrollbar">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-600">Files</div>
                <div className="space-y-3">
                  {detailTurns.map((item, turnIndex) => (
                    <div key={`review-turn-${item.id}`} className="space-y-1.5">
                      {detailTurns.length > 1 && (
                        <div className="px-1 pb-1">
                          <div className="truncate text-[10px] font-bold uppercase tracking-widest text-blue-400">{item.taskTitle || 'Untitled Task'}</div>
                          <div className="mt-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-600">{item.timestamp}</div>
                        </div>
                      )}
                      {item.modifiedFiles.length === 0 ? (
                        <div className="rounded border border-slate-800 bg-slate-900/30 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-600">
                          0 changed files
                        </div>
                      ) : (
                        item.modifiedFiles.map((file, index) => (
                          <button
                            key={`${item.id}:${file.name}-${index}`}
                            onClick={() => {
                              setSelectedTurnIndex(turnIndex);
                              setSelectedFileIndex(index);
                            }}
                            className={`w-full rounded border px-3 py-2 text-left transition-colors ${
                              selectedTurnIndex === turnIndex && selectedFileIndex === index
                                ? 'border-blue-500 bg-blue-500/10'
                                : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              <span className={`text-xs font-mono font-bold ${file.statusColor}`}>{file.status}</span>
                              <span className="truncate text-[11px] font-mono text-slate-300">{file.name}</span>
                              {file.scopeStatus && (
                                <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest ${
                                  file.scopeStatus === 'extra'
                                    ? 'border-amber-400/40 bg-amber-400/10 text-amber-200'
                                    : 'border-blue-400/30 bg-blue-400/10 text-blue-200'
                                }`}>
                                  {file.scopeStatus === 'extra' ? '额外修改' : '计划内'}
                                </span>
                              )}
                            </div>
                          </button>
                        ))
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="col-span-9 flex min-h-0 flex-col overflow-hidden">
                <div className="border-b border-slate-800 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`text-xs font-mono font-bold ${selectedFile?.statusColor}`}>{selectedFile?.status}</span>
                      <span className="truncate text-xs font-mono text-slate-300">{selectedFile?.name}</span>
                      {selectedFile?.scopeStatus && (
                        <span className={`rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-widest ${
                          selectedFile.scopeStatus === 'extra'
                            ? 'border-amber-400/40 bg-amber-400/10 text-amber-200'
                            : 'border-blue-400/30 bg-blue-400/10 text-blue-200'
                        }`}>
                          {selectedFile.scopeStatus === 'extra' ? '额外修改' : '计划内'}
                        </span>
                      )}
                    </div>
                    <div className="flex shrink-0 overflow-hidden rounded border border-slate-800 bg-slate-950 p-0.5">
                      <button
                        onClick={() => setReviewMode('compare')}
                        className={`px-3 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                          reviewMode === 'compare' ? 'bg-blue-500/20 text-blue-300' : 'text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        Compare
                      </button>
                      <button
                        onClick={() => setReviewMode('annotated')}
                        className={`px-3 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                          reviewMode === 'annotated' ? 'bg-blue-500/20 text-blue-300' : 'text-slate-500 hover:text-slate-300'
                        }`}
                      >
                        Current
                      </button>
                    </div>
                  </div>
                </div>
                {reviewMode === 'annotated' && selectedFile?.status === 'M' ? (
                  <div className="relative flex min-h-0 flex-1 bg-slate-950/40">
                    <div ref={annotatedScrollRef} onScroll={handleAnnotatedScroll} onMouseUp={handleReviewCodeSelection} className="min-w-0 flex-1 overflow-y-auto p-4 hide-scrollbar">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-[10px] font-bold uppercase tracking-widest text-blue-400">Current Code With Changes</div>
                        <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest">
                          <span className="text-green-300">Added</span>
                          <span className="text-yellow-300">Modified</span>
                          <span className="text-red-300">Deleted</span>
                        </div>
                      </div>
                      <div className="font-mono text-xs leading-relaxed">
                        {reviewDiffUnavailableText(selectedFile) ? (
                          <div className="py-10 text-center text-[11px] font-bold uppercase tracking-widest text-slate-600">
                            {reviewDiffUnavailableText(selectedFile)}
                          </div>
                        ) : (
                          annotatedRows.map((row) => {
                            const groupId = changeGroups.groupByRowId.get(row.id);
                            const group = groupId ? changeGroups.groups.find((item) => item.id === groupId) : null;
                            const isGroupFirstRow = group?.rows[0]?.id === row.id;
                            const isActiveGroup = activeChangeRowId === groupId;
                            const stateKey = groupId ? changeStateKey(groupId) : '';
                            const isCommentOpen = openCommentKey === stateKey;

                            return (
                              <div
                                id={row.id}
                                key={row.id}
                                data-review-line-number={row.lineNumber ?? undefined}
                                className={`group flex scroll-mt-6 items-start border-l-2 px-2 py-0.5 transition-all duration-300 ${
                                  openCommentKey
                                    ? 'relative z-[100]'
                                    : isActiveGroup
                                      ? 'relative scale-[1.015] shadow-[0_0_0_1px_rgba(96,165,250,0.65),0_0_28px_rgba(59,130,246,0.35)]'
                                      : ''
                                } ${
                                  row.kind === 'add'
                                    ? isActiveGroup ? 'border-green-200 bg-green-400/25 text-green-50' : 'border-green-400 bg-green-500/10 text-green-100'
                                    : row.kind === 'delete'
                                      ? isActiveGroup ? 'border-red-200 bg-red-400/25 text-red-50' : 'border-red-400 bg-red-500/10 text-red-100'
                                      : row.kind === 'update'
                                        ? isActiveGroup ? 'border-yellow-100 bg-yellow-300/25 text-yellow-50' : 'border-yellow-300 bg-yellow-400/10 text-yellow-100'
                                        : 'border-transparent text-slate-400'
                                }`}
                                title={row.kind === 'update' && row.beforeText ? `Before: ${row.beforeText}` : undefined}
                              >
                                <span className="mr-3 w-10 shrink-0 text-right text-slate-600">{row.lineNumber ?? '-'}</span>
                                <span className="mr-3 w-10 shrink-0 font-bold uppercase">
                                  {row.kind === 'add' ? 'ADD' : row.kind === 'delete' ? 'DEL' : row.kind === 'update' ? 'MOD' : ''}
                                </span>
                                {row.kind === 'update' && row.beforeText ? (
                                  <span className="flex min-w-0 flex-1 flex-col gap-1 whitespace-pre-wrap">
                                    <span className="flex min-w-0 items-start gap-2 rounded border border-red-400/20 bg-red-500/10 px-2 py-1 text-red-100">
                                      <span className="shrink-0 select-none text-red-300">-</span>
                                      <span className="min-w-0 flex-1 break-words">
                                        {renderInlineCharDiff(row.beforeText || ' ', row.text || ' ', 'before')}
                                      </span>
                                    </span>
                                    <span className="flex min-w-0 items-start gap-2 rounded border border-green-400/20 bg-green-500/10 px-2 py-1 text-green-100">
                                      <span className="shrink-0 select-none text-green-300">+</span>
                                      <span className="min-w-0 flex-1 break-words">
                                        {renderInlineCharDiff(row.beforeText || ' ', row.text || ' ', 'after')}
                                      </span>
                                    </span>
                                  </span>
                                ) : (
                                  <span className={`${row.kind === 'delete' ? 'line-through decoration-red-300/70' : ''} flex-1 whitespace-pre-wrap`}>
                                    {row.text || ' '}
                                  </span>
                                )}
                                {groupId ? (
                                  <span className={`relative ml-3 flex w-[24rem] shrink-0 items-center justify-end gap-2 transition-opacity ${
                                    isCommentOpen ? 'z-[110]' : ''
                                  } ${
                                    isGroupFirstRow ? 'opacity-90 group-hover:opacity-100' : 'pointer-events-none invisible'
                                  }`}>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setIsStoryDialogOpen(false);
                                        setActiveChangeRowId(null);
                                        setOpenCommentKey(openCommentKey === stateKey ? null : stateKey);
                                      }}
                                      className={`flex min-w-0 flex-1 items-center gap-2 rounded border px-2 py-1 text-left text-[11px] transition-colors ${
                                        reviewedChanges[stateKey]
                                          ? 'border-green-400/40 bg-green-500/10 text-green-100'
                                          : changeNotes[stateKey]
                                            ? 'border-blue-400/40 bg-blue-500/10 text-blue-100'
                                            : 'border-slate-700 bg-slate-900/80 text-slate-400 hover:border-blue-500 hover:text-blue-200'
                                      }`}
                                      title={changeNotes[stateKey] || '添加备注'}
                                    >
                                      <MessageSquare size={12} className="shrink-0" />
                                      <span className="truncate">{noteSummary(changeNotes[stateKey])}</span>
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => explainChangeGroup(groupId)}
                                      disabled={explainingChanges[stateKey]}
                                      className="shrink-0 rounded border border-blue-500/40 bg-blue-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-blue-200 transition-colors hover:border-blue-400 hover:bg-blue-500/20 disabled:cursor-wait disabled:border-slate-700 disabled:bg-slate-900 disabled:text-slate-500"
                                    >
                                      {explainingChanges[stateKey] ? '解释中' : '解释'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => toggleReviewedChange(groupId)}
                                      className={`shrink-0 rounded border px-2 py-1 text-[10px] font-bold uppercase tracking-widest transition-colors ${
                                        reviewedChanges[stateKey]
                                          ? 'border-green-400/50 bg-green-500/15 text-green-200'
                                          : 'border-slate-700 bg-slate-900 text-slate-400 hover:border-blue-500 hover:text-blue-300'
                                      }`}
                                    >
                                      {reviewedChanges[stateKey] ? '已审' : '审核'}
                                    </button>

                                    {isCommentOpen && (
                                      <ReviewCommentDialog
                                        note={changeNotes[stateKey] ?? ''}
                                        reviewed={reviewedChanges[stateKey] ?? false}
                                        error={changeErrors[stateKey]}
                                        onChangeNote={(note) => setChangeNotes((current) => ({
                                          ...current,
                                          [stateKey]: note
                                        }))}
                                        onClose={() => setOpenCommentKey(null)}
                                        onSave={() => persistChangeNote(groupId, changeNotes[stateKey] ?? '', reviewedChanges[stateKey] ?? false).catch(() => {
                                          setChangeErrors((current) => ({ ...current, [stateKey]: '保存备注失败' }));
                                        })}
                                      />
                                    )}
                                  </span>
                                ) : null}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>
                    {changeGroups.groups.length > 0 && (
                      <div className="flex w-5 shrink-0 flex-col items-center gap-1 border-l border-slate-800 bg-slate-950/70 py-3">
                        {changeGroups.groups.map((group) => (
                          <button
                            key={`nav-${group.id}`}
                            onClick={() => jumpToAnnotatedGroup(group.id)}
                            className={`h-3 w-2 rounded-sm transition-all hover:scale-x-150 ${
                              activeChangeRowId === group.id ? 'h-5 w-3 shadow-[0_0_10px_rgba(96,165,250,0.8)]' : ''
                            } ${
                              group.kind === 'add'
                                ? 'bg-green-400/80'
                                : group.kind === 'delete'
                                  ? 'bg-red-400/80'
                                  : 'bg-yellow-300/80'
                            }`}
                            title={`${group.kind.toUpperCase()} ${group.rows.length} lines`}
                            aria-label={`Jump to ${group.kind} change group`}
                          />
                        ))}
                      </div>
                    )}
                    {storySelection && !openCommentKey && (
                      <div className="absolute right-8 top-4 z-20 flex max-h-[calc(100%-2rem)] w-80 flex-col rounded border border-slate-800 bg-slate-950/95 shadow-[0_18px_60px_rgba(0,0,0,0.55)] backdrop-blur">
                        <div className="flex items-start justify-between gap-3 border-b border-slate-800 p-3">
                          <div className="min-w-0">
                            <div className="text-[10px] font-bold uppercase tracking-widest text-blue-400">修改故事线</div>
                            <div className="mt-1 text-[10px] text-slate-500">Lines {storySelection.startLine}-{storySelection.endLine}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setStorySelection(null);
                              setStoryEntries([]);
                              setStoryError('');
                              setIsStoryDialogOpen(false);
                            }}
                            className="rounded p-1 text-slate-500 hover:bg-slate-900 hover:text-slate-200"
                            aria-label="Close story summary"
                          >
                            <X size={13} />
                          </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-3 hide-scrollbar">
                          {storyError && <div className="mb-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{storyError}</div>}
                          {isStoryLoading ? (
                            <div className="py-8 text-center text-[10px] font-bold uppercase tracking-widest text-blue-400">Loading...</div>
                          ) : storyEntries.length === 0 ? (
                            <div className="py-8 text-center text-[10px] font-bold uppercase tracking-widest text-slate-600">No story for selection</div>
                          ) : (
                            <div className="space-y-2">
                              {storyEntries.slice(0, 6).map((entry) => (
                                <div key={`${entry.turnId}:${entry.filePath}`} className="rounded border border-slate-800 bg-slate-900/50 p-3">
                                  <div className="mb-1 truncate text-[11px] font-bold text-blue-300">{entry.taskTitle || 'Untitled task'}</div>
                                  <div className="mb-2 text-[9px] font-bold uppercase tracking-widest text-slate-500">{new Date(entry.createdAt).toLocaleString()}</div>
                                  <p className="line-clamp-2 text-[11px] text-slate-300">{entry.prompt}</p>
                                  <div className="mt-2 flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-slate-500">
                                    <span>{entry.sessionName}</span>
                                    <span>{entry.provider}</span>
                                  </div>
                                </div>
                              ))}
                              <button
                                type="button"
                                onClick={() => setIsStoryDialogOpen(true)}
                                className="w-full rounded border border-blue-500/40 bg-blue-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-blue-200 transition-colors hover:bg-blue-500/20"
                              >
                                查看代码故事线
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ) : selectedFile?.status === 'A' ? (
                  <div className="min-h-0 flex-1 overflow-y-auto bg-slate-950/40 p-4 hide-scrollbar">
                    <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-blue-400">Added Content</div>
                    <pre className="whitespace-pre-wrap text-xs leading-relaxed text-green-100">
                      {splitLines(reviewPaneText(selectedFile.afterContent || selectedFile.content, 'No added content snapshot available.')).map((line, index) => (
                        <div key={index} className="flex bg-green-500/5">
                          <span className="mr-3 w-10 shrink-0 text-right text-slate-600">{index + 1}</span>
                          <span className="mr-2 text-green-400">+</span>
                          <span className="flex-1">{line || ' '}</span>
                        </div>
                      ))}
                    </pre>
                  </div>
                ) : selectedFile?.status === 'D' ? (
                  <div className="min-h-0 flex-1 overflow-y-auto bg-slate-950/40 p-4 hide-scrollbar">
                    <div className="mb-3 text-[10px] font-bold uppercase tracking-widest text-red-300">Deleted Content</div>
                    <pre className="whitespace-pre-wrap text-xs leading-relaxed text-red-100">
                      {splitLines(reviewPaneText(selectedFile.beforeContent || selectedFile.content, 'No deleted content snapshot available.')).map((line, index) => (
                        <div key={index} className="flex bg-red-500/5">
                          <span className="mr-3 w-10 shrink-0 text-right text-slate-600">{index + 1}</span>
                          <span className="mr-2 text-red-300">-</span>
                          <span className="flex-1">{line || ' '}</span>
                        </div>
                      ))}
                    </pre>
                  </div>
                ) : (
                  <>
                    <div className="grid min-h-0 flex-1 grid-cols-2 overflow-hidden">
                      <div className="border-r border-slate-800 overflow-y-auto bg-slate-950/40 p-3 hide-scrollbar">
                        <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-600">Before</div>
                        <pre className="whitespace-pre-wrap text-xs leading-relaxed text-slate-400">
                          {reviewDiffUnavailableText(selectedFile) ? (
                            splitLines(reviewPaneText(selectedFile?.beforeContent, 'No before snapshot available.')).map((line, index) => (
                              <div key={index} className="flex">
                                <span className="mr-3 w-8 shrink-0 text-right text-slate-600">{index + 1}</span>
                                <span className="flex-1 bg-transparent">{line || ' '}</span>
                              </div>
                            ))
                          ) : renderCompareRows(selectedFile?.beforeContent, selectedFile?.afterContent)
                            .filter((row) => row.kind !== 'same')
                            .map((row, index) => (
                            <div key={index} className={`flex ${row.kind === 'delete' || row.kind === 'update' ? 'bg-red-500/10 text-red-200' : 'text-slate-700'}`}>
                              <span className="mr-3 w-8 shrink-0 text-right text-slate-600">{row.beforeLineNumber ?? '-'}</span>
                              <span className="mr-2 w-3 shrink-0 text-red-300">{row.before ? '-' : ''}</span>
                              <span className="flex-1">{row.before || ' '}</span>
                            </div>
                          ))}
                        </pre>
                      </div>
                      <div className="overflow-y-auto bg-slate-950/40 p-3 hide-scrollbar">
                        <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-600">After</div>
                        <pre className="whitespace-pre-wrap text-xs leading-relaxed text-slate-300">
                          {reviewDiffUnavailableText(selectedFile) ? (
                            splitLines(reviewPaneText(selectedFile?.afterContent, 'No after snapshot available.')).map((line, index) => (
                              <div key={index} className="flex">
                                <span className="mr-3 w-8 shrink-0 text-right text-slate-600">{index + 1}</span>
                                <span className="flex-1 bg-transparent">{line || ' '}</span>
                              </div>
                            ))
                          ) : renderCompareRows(selectedFile?.beforeContent, selectedFile?.afterContent)
                            .filter((row) => row.kind !== 'same')
                            .map((row, index) => (
                            <div key={index} className={`flex ${row.kind === 'add' || row.kind === 'update' ? 'bg-green-500/10 text-green-200' : 'text-slate-700'}`}>
                              <span className="mr-3 w-8 shrink-0 text-right text-slate-600">{row.afterLineNumber ?? '-'}</span>
                              <span className="mr-2 w-3 shrink-0 text-green-300">{row.after ? '+' : ''}</span>
                              <span className="flex-1">{row.after || ' '}</span>
                            </div>
                          ))}
                        </pre>
                      </div>
                    </div>

                  </>
                )}
              </div>
            </div>
          )}
        </div>
        <AnimatePresence>
          {storySelection && isStoryDialogOpen && (
            <CodeStoryDialog
              selection={storySelection}
              entries={storyEntries}
              isLoading={isStoryLoading}
              error={storyError}
              onClose={() => setIsStoryDialogOpen(false)}
            />
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
};

const RightPanel = ({ turns, workspace, onOpenCodeStory, onJumpToTurn }: { turns: Turn[], workspace?: WorkspaceProject, onOpenCodeStory: () => void, onJumpToTurn: (turn: Turn) => void }) => {
  const [selectedTurn, setSelectedTurn] = useState<Turn | null>(null);
  const [selectedTurnIds, setSelectedTurnIds] = useState<string[]>([]);
  const [isBatchReviewOpen, setIsBatchReviewOpen] = useState(false);
  const [showChangedOnly, setShowChangedOnly] = useState(false);
  const visibleTurns = showChangedOnly ? turns.filter((turn) => turn.modifiedFiles.length > 0) : turns;
  const sortedTurns = [...visibleTurns].reverse();
  const selectedTurns = visibleTurns.filter((turn) => selectedTurnIds.includes(turn.id));

  useEffect(() => {
    setSelectedTurnIds((current) => current.filter((id) => visibleTurns.some((turn) => turn.id === id)));
  }, [visibleTurns]);

  const toggleSelectTurn = (turnId: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setSelectedTurnIds((current) => (
      current.includes(turnId) ? current.filter((id) => id !== turnId) : [...current, turnId]
    ));
  };

  return (
    <aside className="fixed right-0 top-12 w-80 h-[calc(100vh-48px)] bg-slate-950 border-l border-slate-800 flex flex-col z-30">
      <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex justify-between items-center">
        <div>
          <h2 className="font-display text-blue-400 text-sm font-bold uppercase tracking-tight flex items-center gap-2">
            <Zap size={14} /> Analysis & Mods
          </h2>
          <p className="text-[10px] text-slate-500 uppercase mt-1">Conversation Tasks</p>
        </div>
        <div className="flex items-center gap-2">
          {workspace && (
            <button
              type="button"
              onClick={onOpenCodeStory}
              className="rounded border border-slate-700 bg-slate-900 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-slate-300 transition-colors hover:border-blue-500 hover:text-blue-300"
            >
              代码
            </button>
          )}
          {selectedTurnIds.length > 0 && (
          <button
            type="button"
            onClick={() => setIsBatchReviewOpen(true)}
            className="rounded border border-blue-500/50 bg-blue-500/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest text-blue-200 transition-colors hover:bg-blue-500/25"
          >
            审核 {selectedTurnIds.length}
          </button>
          )}
        </div>
      </div>

      <div className="border-b border-slate-900 px-4 py-2">
        <label className="flex cursor-pointer items-center justify-between gap-3 rounded border border-slate-800 bg-slate-900/40 px-3 py-2 transition-colors hover:border-slate-700">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">只显示有文件修改</span>
          <input
            type="checkbox"
            checked={showChangedOnly}
            onChange={(event) => setShowChangedOnly(event.target.checked)}
            className="h-4 w-4 accent-blue-500"
          />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 hide-scrollbar">
        {turns.length === 0 ? (
          <div className="h-40 flex flex-col items-center justify-center opacity-20 text-center px-4">
            <MessageSquare size={32} className="mb-2" />
            <p className="text-[10px] uppercase font-bold tracking-widest">No conversation tracking active</p>
          </div>
        ) : visibleTurns.length === 0 ? (
          <div className="h-40 flex flex-col items-center justify-center opacity-20 text-center px-4">
            <GitBranch size={32} className="mb-2" />
            <p className="text-[10px] uppercase font-bold tracking-widest">No conversations with file changes</p>
          </div>
        ) : (
          sortedTurns.map((turn) => (
            <div 
              key={turn.id}
              onClick={() => {
                console.log('[ReviewDock jump] card click', {
                  id: turn.id,
                  anchorId: turn.anchorId,
                  title: turn.taskTitle,
                  text: turn.userMessage.slice(0, 120)
                });
                onJumpToTurn(turn);
                setSelectedTurn(turn);
              }}
              className={`group cursor-pointer border rounded-lg p-3 transition-all relative overflow-hidden ${
                selectedTurnIds.includes(turn.id)
                  ? 'border-blue-500 bg-blue-500/10 shadow-[inset_0_0_0_1px_rgba(59,130,246,0.2)]'
                  : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
              }`}
            >
              <div className="flex justify-between items-start mb-2 relative z-10">
                <span className="text-[9px] text-slate-600 font-bold uppercase tracking-tighter">{turn.timestamp}</span>
                <button
                  type="button"
                  onClick={(event) => toggleSelectTurn(turn.id, event)}
                  className={`flex h-7 w-7 items-center justify-center rounded border-2 transition-colors ${
                    selectedTurnIds.includes(turn.id)
                      ? 'border-blue-400 bg-blue-500 text-white'
                      : 'border-slate-600 bg-slate-950 text-transparent hover:border-blue-400 hover:bg-blue-500/10'
                  }`}
                  aria-label={selectedTurnIds.includes(turn.id) ? 'Unselect turn' : 'Select turn'}
                >
                  {selectedTurnIds.includes(turn.id) ? <Check size={15} /> : <span className="h-3 w-3 rounded-sm border border-slate-500" />}
                </button>
              </div>
              <h3 className="mb-2 truncate text-xs font-bold text-blue-300">{turn.taskTitle || 'Untitled Task'}</h3>
              <p className="text-xs text-on-surface line-clamp-2 relative z-10">"{turn.userMessage}"</p>
              <div className="mt-3 flex items-center justify-between border-t border-slate-800 pt-2 text-[9px] font-bold uppercase tracking-widest">
                <span className="text-slate-600">{turn.modifiedFiles.length} changed file{turn.modifiedFiles.length === 1 ? '' : 's'}</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      console.log('[ReviewDock jump] locate button click', {
                        id: turn.id,
                        anchorId: turn.anchorId,
                        title: turn.taskTitle,
                        text: turn.userMessage.slice(0, 120)
                      });
                      onJumpToTurn(turn);
                    }}
                    className="rounded border border-slate-700 px-2 py-1 text-slate-500 transition-colors hover:border-emerald-500 hover:text-emerald-300"
                  >
                    定位
                  </button>
                  <button
                    type="button"
                    onClick={(event) => toggleSelectTurn(turn.id, event)}
                    className={`rounded border px-2 py-1 transition-colors ${
                      selectedTurnIds.includes(turn.id)
                        ? 'border-blue-400/60 bg-blue-500/15 text-blue-200'
                        : 'border-slate-700 text-slate-500 hover:border-blue-500 hover:text-blue-300'
                    }`}
                  >
                    {selectedTurnIds.includes(turn.id) ? '已选择' : '选择此对话'}
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      <AnimatePresence>
        {isBatchReviewOpen && selectedTurns.length > 0 && (
          <ComparisonModal
            turns={selectedTurns}
            workspace={workspace}
            onClose={() => setIsBatchReviewOpen(false)}
          />
        )}
        {selectedTurn && (
          <TurnDetailModal turn={selectedTurn} workspace={workspace} onClose={() => setSelectedTurn(null)} />
        )}
      </AnimatePresence>
    </aside>
  );
};

const FileItem = ({ status, name, statusColor }: any) => {
  return (
    <div className="bg-slate-900 border border-slate-800 p-2 rounded flex items-center justify-between group hover:border-blue-500/50 transition-colors cursor-pointer">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-mono font-bold ${statusColor}`}>{status}</span>
        <span className="text-xs font-mono text-slate-300">{name}</span>
      </div>
      <Eye size={12} className="text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity" />
    </div>
  );
};

const CodeStoryDialog = ({ selection, entries, isLoading, error, onClose }: { selection: { text: string; startLine: number; endLine: number }, entries: CodeHistoryEntry[], isLoading: boolean, error: string, onClose: () => void }) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedEntry = entries[selectedIndex] || entries[0];
  const fileScrollRef = useRef<HTMLDivElement | null>(null);
  const selectedRows = useMemo(() => {
    if (!selectedEntry) return [];
    return renderCompareRows(selectedEntry.beforeContent, selectedEntry.afterContent);
  }, [selectedEntry]);
  const targetRowIndex = useMemo(() => {
    const selectedLineIndex = selectedRows.findIndex((row) => (
      row.afterLineNumber !== null &&
      row.afterLineNumber >= selection.startLine &&
      row.afterLineNumber <= selection.endLine
    ));
    if (selectedLineIndex >= 0) return selectedLineIndex;

    const firstChangedIndex = selectedRows.findIndex((row) => row.kind !== 'same');
    return firstChangedIndex >= 0 ? firstChangedIndex : 0;
  }, [selectedRows, selection.endLine, selection.startLine]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [entries]);

  useEffect(() => {
    window.setTimeout(() => {
      const target = document.getElementById(`story-file-row-${targetRowIndex}`);
      if (!target || !fileScrollRef.current) return;
      fileScrollRef.current.scrollTo({
        top: Math.max(0, target.offsetTop - fileScrollRef.current.offsetTop - 120),
        behavior: 'smooth'
      });
    }, 0);
  }, [targetRowIndex, selectedEntry?.turnId]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/70 p-6 backdrop-blur-sm"
    >
      <motion.div
        initial={{ y: 16, opacity: 0, scale: 0.98 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 8, opacity: 0, scale: 0.98 }}
        className="flex h-[82vh] w-[86vw] max-w-7xl flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-950 shadow-[0_24px_80px_rgba(0,0,0,0.65)]"
      >
        <div className="flex items-start justify-between gap-6 border-b border-slate-800 p-4">
          <div className="min-w-0">
            <h2 className="text-sm font-bold uppercase tracking-widest text-blue-400">修改故事线</h2>
            <div className="mt-2 flex items-center gap-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              <span>Lines {selection.startLine}-{selection.endLine}</span>
              <span>{entries.length} records</span>
            </div>
            <p className="mt-2 line-clamp-2 max-w-4xl text-xs text-slate-300">{selection.text.trim()}</p>
          </div>
          <button onClick={onClose} className="rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-900 hover:text-slate-200" aria-label="Close story dialog">
            <X size={16} />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-12">
          <div className="col-span-4 border-r border-slate-800 p-4">
            {error && <div className="mb-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
            {isLoading ? (
              <div className="flex h-full items-center justify-center text-xs font-bold uppercase tracking-widest text-blue-400">Loading...</div>
            ) : entries.length === 0 ? (
              <div className="flex h-full items-center justify-center text-center text-[11px] font-bold uppercase tracking-widest text-slate-600">No story for selection</div>
            ) : (
              <div className="h-full space-y-2 overflow-y-auto pr-1 hide-scrollbar">
                {entries.map((entry, index) => (
                  <button
                    key={`${entry.turnId}:${entry.filePath}:${index}`}
                    type="button"
                    onClick={() => setSelectedIndex(index)}
                    className={`w-full rounded border p-3 text-left transition-colors ${
                      selectedIndex === index
                        ? 'border-blue-500 bg-blue-500/10'
                        : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                    }`}
                  >
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="truncate text-xs font-bold text-blue-300">{entry.taskTitle || 'Untitled task'}</span>
                      <span className="shrink-0 rounded border border-slate-700 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-400">{entry.changeKind}</span>
                    </div>
                    <p className="mb-2 line-clamp-2 text-xs text-slate-300">{entry.prompt}</p>
                    <div className="flex items-center justify-between gap-3 text-[9px] font-bold uppercase tracking-widest text-slate-500">
                      <span className="truncate">{entry.sessionName}</span>
                      <span>{new Date(entry.createdAt).toLocaleString()}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="col-span-8 flex min-h-0 flex-col">
            {selectedEntry ? (
              <>
                <div className="border-b border-slate-800 p-4">
                  <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    <span>{selectedEntry.provider}</span>
                    <span>{selectedEntry.sessionName}</span>
                    <span>{selectedEntry.filePath}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 text-sm font-bold text-blue-200">{selectedEntry.taskTitle || 'Untitled task'}</div>
                    <div className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                      Jumped to changed block
                    </div>
                  </div>
                </div>
                <div ref={fileScrollRef} className="min-h-0 flex-1 overflow-auto bg-slate-950/40 p-4 hide-scrollbar">
                  <div className="mb-3 grid grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)] gap-3 text-[10px] font-bold uppercase tracking-widest text-slate-500">
                    <span>Line</span>
                    <span className="text-red-300">Before</span>
                    <span className="text-green-300">After</span>
                  </div>
                  <div className="font-mono text-xs leading-relaxed">
                    {selectedRows.map((row, index) => (
                      <div
                        id={`story-file-row-${index}`}
                        key={index}
                        className={`grid grid-cols-[5rem_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-l-2 px-2 py-1 ${
                          row.kind === 'same'
                            ? 'border-transparent text-slate-500'
                            : row.kind === 'add'
                              ? 'border-green-400 bg-green-500/10 text-green-100'
                              : row.kind === 'delete'
                                ? 'border-red-400 bg-red-500/10 text-red-100'
                                : 'border-yellow-300 bg-yellow-400/10 text-slate-100'
                        }`}
                      >
                        <div className="select-none text-right text-slate-600">
                          {row.beforeLineNumber ?? row.afterLineNumber ?? '-'}
                        </div>
                        <pre className={`min-w-0 whitespace-pre-wrap rounded px-2 py-1 ${
                          row.kind === 'delete' || row.kind === 'update' ? 'bg-red-500/10 text-red-100' : 'text-slate-600'
                        }`}>
                          {row.before || ' '}
                        </pre>
                        <pre className={`min-w-0 whitespace-pre-wrap rounded px-2 py-1 ${
                          row.kind === 'add' || row.kind === 'update' ? 'bg-green-500/10 text-green-100' : 'text-slate-600'
                        }`}>
                          {row.after || ' '}
                        </pre>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex h-full items-center justify-center text-[11px] font-bold uppercase tracking-widest text-slate-600">Select a story record</div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

const CodeStoryModal = ({ workspace, onClose }: { workspace: WorkspaceProject, onClose: () => void }) => {
  const [currentDir, setCurrentDir] = useState('');
  const [entries, setEntries] = useState<CodeFileEntry[]>([]);
  const [selectedFile, setSelectedFile] = useState('');
  const [content, setContent] = useState('');
  const [history, setHistory] = useState<CodeHistoryEntry[]>([]);
  const [selection, setSelection] = useState<{ text: string; startLine: number; endLine: number } | null>(null);
  const [error, setError] = useState('');
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);

  const contentLines = useMemo(() => splitLines(content), [content]);

  useEffect(() => {
    let cancelled = false;
    const url = new URL(`${API_BASE_URL}/workspaces/${workspace.id}/files`);
    if (currentDir) url.searchParams.set('path', currentDir);

    fetch(url)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Failed to load files')))
      .then((payload: { entries: CodeFileEntry[] }) => {
        if (cancelled) return;
        setEntries(payload.entries);
        setError('');
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load files');
      });

    return () => {
      cancelled = true;
    };
  }, [workspace.id, currentDir]);

  const openFile = async (path: string) => {
    const url = new URL(`${API_BASE_URL}/workspaces/${workspace.id}/files/content`);
    url.searchParams.set('path', path);
    const response = await fetch(url);
    if (!response.ok) throw new Error('Failed to load file content');
    const payload = await response.json() as { content: string };
    setSelectedFile(path);
    setContent(payload.content);
    setHistory([]);
    setSelection(null);
  };

  const queryHistory = async (nextSelection: { text: string; startLine: number; endLine: number }) => {
    if (!selectedFile || !nextSelection.text.trim()) return;
    setIsLoadingHistory(true);
    try {
      const response = await fetch(`${API_BASE_URL}/workspaces/${workspace.id}/code-history`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: selectedFile,
          selectedText: nextSelection.text,
          startLine: nextSelection.startLine,
          endLine: nextSelection.endLine
        })
      });
      if (!response.ok) throw new Error('Failed to load code history');
      const payload = await response.json() as { entries: CodeHistoryEntry[] };
      setHistory(payload.entries);
      setError('');
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : 'Failed to load code history');
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleCodeMouseUp = () => {
    const browserSelection = window.getSelection();
    const text = browserSelection?.toString() ?? '';
    if (!text.trim()) return;

    const anchorElement = browserSelection?.anchorNode?.parentElement?.closest('[data-line-number]') as HTMLElement | null;
    const focusElement = browserSelection?.focusNode?.parentElement?.closest('[data-line-number]') as HTMLElement | null;
    const anchorLine = Number(anchorElement?.dataset.lineNumber ?? 1);
    const focusLine = Number(focusElement?.dataset.lineNumber ?? anchorLine);
    const nextSelection = {
      text,
      startLine: Math.min(anchorLine, focusLine),
      endLine: Math.max(anchorLine, focusLine)
    };
    setSelection(nextSelection);
    queryHistory(nextSelection).catch(() => undefined);
  };

  const parentDir = currentDir.split('/').slice(0, -1).join('/');

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-slate-950/85 p-6 backdrop-blur-sm"
    >
      <motion.div
        initial={{ y: 16, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="flex h-full overflow-hidden rounded-lg border border-slate-800 bg-slate-950 shadow-2xl"
      >
        <div className="flex w-72 shrink-0 flex-col border-r border-slate-800">
          <div className="border-b border-slate-800 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-bold uppercase tracking-widest text-blue-400">代码故事线</h2>
                <p className="mt-1 truncate text-[11px] text-slate-500">{workspace.name}</p>
              </div>
              <button onClick={onClose} className="rounded p-1.5 text-slate-500 hover:bg-slate-900 hover:text-slate-200" aria-label="Close">
                <X size={16} />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {currentDir && (
              <button
                type="button"
                onClick={() => setCurrentDir(parentDir)}
                className="mb-2 w-full rounded border border-slate-800 bg-slate-900/50 px-3 py-2 text-left text-xs text-slate-400 hover:border-blue-500 hover:text-blue-300"
              >
                ../
              </button>
            )}
            <div className="space-y-1">
              {entries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => {
                    if (entry.type === 'directory') setCurrentDir(entry.path);
                    else openFile(entry.path).catch((openError) => setError(openError instanceof Error ? openError.message : 'Failed to open file'));
                  }}
                  className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors ${
                    selectedFile === entry.path ? 'bg-blue-500/15 text-blue-200' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                  }`}
                >
                  {entry.type === 'directory' ? <FolderOpen size={13} /> : <FileTextIcon />}
                  <span className="truncate">{entry.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col border-r border-slate-800">
          <div className="border-b border-slate-800 px-4 py-3">
            <div className="truncate text-xs font-bold text-slate-300">{selectedFile || '选择一个文件后，拖选代码段查看故事线'}</div>
            {selection && (
              <div className="mt-1 text-[10px] font-bold uppercase tracking-widest text-blue-400">
                Lines {selection.startLine}-{selection.endLine}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-auto p-4" onMouseUp={handleCodeMouseUp}>
            {selectedFile ? (
              <pre className="select-text font-mono text-xs leading-relaxed text-slate-300">
                {contentLines.map((line, index) => (
                  <div key={index} data-line-number={index + 1} className="flex min-w-max hover:bg-slate-900/60">
                    <span className="mr-4 w-10 shrink-0 select-none text-right text-slate-600">{index + 1}</span>
                    <code className="whitespace-pre">{line || ' '}</code>
                  </div>
                ))}
              </pre>
            ) : (
              <div className="flex h-full items-center justify-center text-xs font-bold uppercase tracking-widest text-slate-700">
                Select file
              </div>
            )}
          </div>
        </div>

        <div className="flex w-96 shrink-0 flex-col">
          <div className="border-b border-slate-800 p-4">
            <div className="text-sm font-bold uppercase tracking-widest text-blue-400">修改故事线</div>
            <p className="mt-1 text-[11px] text-slate-500">选择代码后显示涉及它的对话与时间</p>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {error && <div className="mb-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
            {isLoadingHistory ? (
              <div className="py-10 text-center text-xs font-bold uppercase tracking-widest text-blue-400">Loading...</div>
            ) : history.length === 0 ? (
              <div className="py-10 text-center text-[11px] font-bold uppercase tracking-widest text-slate-600">
                No story for current selection
              </div>
            ) : (
              <div className="space-y-3">
                {history.map((entry) => (
                  <div key={`${entry.turnId}-${entry.filePath}`} className="rounded border border-slate-800 bg-slate-900/40 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="truncate text-xs font-bold text-blue-300">{entry.taskTitle || 'Untitled task'}</span>
                      <span className="shrink-0 text-[9px] font-bold uppercase tracking-widest text-slate-500">
                        {new Date(entry.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <p className="mb-2 line-clamp-2 text-xs text-slate-300">{entry.prompt}</p>
                    <div className="mb-3 flex items-center gap-2 text-[9px] font-bold uppercase tracking-widest text-slate-500">
                      <span>{entry.sessionName}</span>
                      <span>{entry.provider}</span>
                      <span>{entry.changeKind}</span>
                    </div>
                    <pre className="max-h-32 overflow-auto rounded border border-red-500/20 bg-red-500/10 p-2 text-[10px] text-red-100">{entry.beforeExcerpt || '(empty before)'}</pre>
                    <pre className="mt-2 max-h-32 overflow-auto rounded border border-green-500/20 bg-green-500/10 p-2 text-[10px] text-green-100">{entry.afterExcerpt || '(empty after)'}</pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

const FileTextIcon = () => <span className="h-3 w-3 shrink-0 rounded-sm border border-slate-600" />;

export default function App() {
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const [selectedTurns, setSelectedTurns] = useState<string[]>([]);
  const [jumpTarget, setJumpTarget] = useState<JumpTarget | null>(null);
  const [isAddProjectOpen, setIsAddProjectOpen] = useState(false);
  const [pendingSessionProjectId, setPendingSessionProjectId] = useState<string | null>(null);
  const [pendingDeleteProjectId, setPendingDeleteProjectId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false);
  const [isCodeStoryOpen, setIsCodeStoryOpen] = useState(false);
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [sessionTurns, setSessionTurns] = useState<Record<string, Turn[]>>({});
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, AgentRunStatus>>({});
  const [mountedSessionIds, setMountedSessionIds] = useState<string[]>([]);

  const mapWorkspace = (workspace: ApiWorkspace): WorkspaceProject => ({
    id: workspace.id,
    name: workspace.name,
    folderPath: workspace.path,
    icon: <FolderOpen size={14} />,
    items: workspace.sessions.map((session) => ({
      id: session.id,
      name: session.name,
      icon: <MessageSquare size={14} />,
      provider: session.provider
    }))
  });

  const loadWorkspaces = async () => {
    const response = await fetch(`${API_BASE_URL}/workspaces`);
    if (!response.ok) {
      throw new Error('Failed to load workspaces');
    }

    const workspaces = await response.json() as ApiWorkspace[];
    setProjects(workspaces.map(mapWorkspace));
    setSessionStatuses(prev => {
      const next = { ...prev };
      for (const workspace of workspaces) {
        for (const session of workspace.sessions) {
          next[session.id] = next[session.id] ?? 'idle';
        }
      }
      return next;
    });
  };

  useEffect(() => {
    loadWorkspaces().catch((error) => {
      console.error(error);
    });
  }, []);

  useEffect(() => {
    if (!activeItem) return;
    setMountedSessionIds(prev => prev.includes(activeItem) ? prev : [...prev, activeItem]);
  }, [activeItem]);

  const handleAddProject = async (name: string, folderPath: string) => {
    const response = await fetch(`${API_BASE_URL}/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, path: folderPath })
    });

    if (!response.ok) {
      throw new Error('Failed to add workspace');
    }

    const workspace = await response.json() as Omit<ApiWorkspace, 'sessions'>;
    const newProject = mapWorkspace({ ...workspace, sessions: [] });
    setProjects(prev => [newProject, ...prev]);
    setActiveItem(null);
    setSelectedTurns([]);
    setJumpTarget(null);
  };

  const handleDeleteProject = async (projectId: string) => {
    const project = projects.find(item => item.id === projectId);
    if (!project) return;

    const response = await fetch(`${API_BASE_URL}/workspaces/${projectId}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      throw new Error('Failed to delete workspace');
    }

    const deletedSessionIds = new Set(project.items.map(item => item.id));
    setSessionTurns(prev => Object.fromEntries(Object.entries(prev).filter(([sessionId]) => !deletedSessionIds.has(sessionId))));
    setSessionStatuses(prev => Object.fromEntries(Object.entries(prev).filter(([sessionId]) => !deletedSessionIds.has(sessionId))));
    setMountedSessionIds(prev => prev.filter(sessionId => !deletedSessionIds.has(sessionId)));
    if (activeItem && deletedSessionIds.has(activeItem)) {
      setActiveItem(null);
      setSelectedTurns([]);
      setJumpTarget(null);
    }
    await loadWorkspaces();
  };

  const handleDeleteSession = async (sessionId: string) => {
    const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}`, {
      method: 'DELETE'
    });

    if (!response.ok) {
      throw new Error('Failed to delete session');
    }

    setProjects(prev => prev.map(project => ({
      ...project,
      items: project.items.filter(item => item.id !== sessionId)
    })));
    setSessionTurns(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => id !== sessionId)));
    setSessionStatuses(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => id !== sessionId)));
    setMountedSessionIds(prev => prev.filter(id => id !== sessionId));
    if (activeItem === sessionId) {
      setActiveItem(null);
      setSelectedTurns([]);
      setJumpTarget(null);
    }
  };

  const handleNewSession = async (projectId: string, provider: AgentProvider) => {
    const response = await fetch(`${API_BASE_URL}/workspaces/${projectId}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider })
    });

    if (!response.ok) {
      throw new Error('Failed to create session');
    }

    const session = await response.json() as ApiSession;
    setProjects(prev => prev.map(project => {
      if (project.id !== projectId) return project;

      return {
        ...project,
        items: [
          ...project.items,
          { id: session.id, name: session.name, icon: <MessageSquare size={14} />, provider: session.provider }
        ]
      };
    }));
    setSessionTurns(prev => ({
      ...prev,
      [session.id]: []
    }));
    setMountedSessionIds(prev => prev.includes(session.id) ? prev : [...prev, session.id]);
    setSessionStatuses(prev => ({
      ...prev,
      [session.id]: 'idle'
    }));
    setActiveItem(session.id);
    setSelectedTurns([]);
    setJumpTarget(null);
  };

  const activeSession = projects.flatMap(project => project.items).find(item => item.id === activeItem);
  const activeProject = projects.find(project => project.items.some(item => item.id === activeItem));
  const mountedSessions = mountedSessionIds
    .map(sessionId => projects.flatMap(project => project.items).find(item => item.id === sessionId))
    .filter((session): session is WorkspaceItem => !!session);
  const pendingSessionProject = projects.find(project => project.id === pendingSessionProjectId);
  const pendingDeleteProject = projects.find(project => project.id === pendingDeleteProjectId);

  const handleNewTurn = (message: string) => {
    if (!activeItem) return;
    const fallbackTitle = message.length > 24 ? message.slice(0, 24) : message;
    
    const newTurn: Turn = {
      id: `turn-${(sessionTurns[activeItem]?.length || 0) + 1}`,
      anchorId: `terminal-local-turn-${(sessionTurns[activeItem]?.length || 0) + 1}`,
      userMessage: message,
      taskTitle: fallbackTitle,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      summary: `Automated architecture refinement triggered by command: '${message}'. The system analyzed the local dependency graph and optimized module throughput.`,
      reasoning: {
        issue: `Detected optimization potential for '${message}'`,
        solution: `Refactored relevant modules to improve throughput and security.`
      },
      modifiedFiles: [
        { 
          name: 'src/core.ts', 
          status: 'M', 
          statusColor: 'text-secondary',
          reason: 'Improving internal signaling and event propagation.',
          remarks: 'Reduced memory footprint by 14% through lazy initialization.',
          diffSnippet: `+ // Optimization applied based on: ${message}\n+ function optimizedHandler() { \n+   return this.lazyModule.process();\n+ }`
        },
        { 
          name: 'config/rules.json', 
          status: 'A', 
          statusColor: 'text-blue-400',
          reason: 'Added specific security constraints for the new processing logic.',
          remarks: 'Rules are compiled and verified before injection.',
          diffSnippet: `{\n  "rule_id": "auto_gen_${Math.random().toString(36).substr(2, 5)}",\n  "policy": "allow"\n}`
        }
      ]
    };

    setSessionTurns(prev => ({
      ...prev,
      [activeItem]: [...(prev[activeItem] || []), newTurn]
    }));
  };

  const handleTaskTitle = (title: string, sessionId: string) => {
    setSessionTurns(prev => {
      const turns = prev[sessionId] || [];
      if (turns.length === 0) return prev;

      return {
        ...prev,
        [sessionId]: turns.map((turn, index) => (
          index === turns.length - 1 ? { ...turn, taskTitle: title } : turn
        ))
      };
    });
  };

  const handleMessagesLoaded = (sessionId: string, messages: ApiMessage[], turns: ApiTurn[]) => {
    const userTurns = turns.length > 0
      ? turns.map((turn): Turn => ({
          id: turn.id,
          anchorId: `terminal-turn-${turn.id}`,
          userMessage: turn.prompt,
          taskTitle: turn.taskTitle || (turn.prompt.length > 24 ? turn.prompt.slice(0, 24) : turn.prompt),
          timestamp: new Date(turn.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          summary: turn.assistantContent || '',
          reasoning: { issue: '', solution: '' },
            modifiedFiles: turn.modifiedFiles.map((file) => ({
              name: file.path,
              status: file.kind === 'add' ? 'A' : file.kind === 'delete' ? 'D' : 'M',
              statusColor: file.kind === 'add' ? 'text-blue-400' : file.kind === 'delete' ? 'text-error' : 'text-secondary',
              scopeStatus: file.scopeStatus,
              content: file.content,
              beforeContent: file.beforeContent || null,
              afterContent: file.afterContent || file.content || null,
              diffSnippet: file.afterContent || file.content || ''
            }))
        }))
      : messages
        .filter((message) => message.role === 'user')
        .map((message, index): Turn => ({
          id: message.id || `turn-${index + 1}`,
          anchorId: `terminal-turn-${message.id || `turn-${index + 1}`}`,
          userMessage: message.content,
          taskTitle: message.taskTitle || (message.content.length > 24 ? message.content.slice(0, 24) : message.content),
          timestamp: new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          summary: '',
          reasoning: {
            issue: '',
            solution: ''
          },
          modifiedFiles: []
        }));

    setSessionTurns(prev => ({
      ...prev,
        [sessionId]: userTurns
      }));
  };

  const handleRunStatusChange = (sessionId: string, status: AgentRunStatus) => {
    setSessionStatuses(prev => ({
      ...prev,
      [sessionId]: status
    }));
  };

  return (
    <div className="h-screen bg-background text-on-surface overflow-hidden flex flex-col pt-12">
      <TopNavBar />
      <div className="flex-1 flex overflow-hidden">
        <WorkspacePane
          activeItem={activeItem}
          setActiveItem={(id) => { setActiveItem(id); setSelectedTurns([]); setJumpTarget(null); }}
          projects={projects}
          sessionStatuses={sessionStatuses}
          onNewSession={(projectId) => {
            setJumpTarget(null);
            setPendingSessionProjectId(projectId);
          }}
          onOpenAddProject={() => setIsAddProjectOpen(true)}
          onDeleteProject={(projectId) => {
            setDeleteError('');
            setPendingDeleteProjectId(projectId);
          }}
          onDeleteSession={(sessionId) => {
            handleDeleteSession(sessionId).catch((error) => console.error(error));
          }}
        />
        <main className="flex-1 min-h-0 ml-64 mr-80 overflow-hidden flex flex-col relative bg-slate-950/20">
          {activeItem ? (
            mountedSessions.map((session) => {
              const isActive = session.id === activeItem;
              return (
                <div
                  key={session.id}
                  className={`absolute inset-0 min-h-0 flex-col ${isActive ? 'flex' : 'hidden'}`}
                  aria-hidden={!isActive}
                >
                  <TerminalBlock
                    sessionId={session.id}
                    title={session.name || session.id.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                    provider={session.provider || 'codex'}
                    onRunCommand={handleNewTurn}
                    onTaskTitle={handleTaskTitle}
                    onMessagesLoaded={handleMessagesLoaded}
                    onRunStatusChange={handleRunStatusChange}
                    jumpTarget={isActive ? jumpTarget : null}
                  />
                </div>
              );
            })
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center opacity-30 select-none">
              <Terminal size={64} className="mb-4" />
              <p className="text-sm font-display uppercase tracking-widest">Select a terminal session from the explorer</p>
            </div>
          )}
        </main>
        <RightPanel
          turns={sessionTurns[activeItem || ''] || []}
          workspace={activeProject}
          onOpenCodeStory={() => setIsCodeStoryOpen(true)}
          onJumpToTurn={(turn) => {
            const nextTarget = {
              anchorId: turn.anchorId || `terminal-turn-${turn.id}`,
              turnId: turn.id,
              text: turn.userMessage,
              nonce: Date.now()
            };
            console.log('[ReviewDock jump] set jump target', {
              nextTarget,
              activeItem,
              activeSession: activeSession?.name,
              turnsCount: sessionTurns[activeItem || '']?.length || 0
            });
            setJumpTarget(nextTarget);
          }}
        />
      </div>
      <AnimatePresence>
        {isCodeStoryOpen && activeProject && (
          <CodeStoryModal
            workspace={activeProject}
            onClose={() => setIsCodeStoryOpen(false)}
          />
        )}
        {isAddProjectOpen && (
          <AddProjectModal
            onClose={() => setIsAddProjectOpen(false)}
            onAddProject={(name, folderPath) => {
              handleAddProject(name, folderPath).catch((error) => console.error(error));
            }}
          />
        )}
        {pendingSessionProject && (
          <SelectAgentModal
            projectName={pendingSessionProject.name}
            onClose={() => setPendingSessionProjectId(null)}
            onSelect={(provider) => {
              handleNewSession(pendingSessionProject.id, provider).catch((error) => console.error(error));
              setPendingSessionProjectId(null);
            }}
          />
        )}
        {pendingDeleteProject && (
          <ConfirmDeleteWorkspaceModal
            project={pendingDeleteProject}
            error={deleteError}
            isDeleting={isDeletingWorkspace}
            onClose={() => {
              if (isDeletingWorkspace) return;
              setPendingDeleteProjectId(null);
              setDeleteError('');
            }}
            onConfirm={async () => {
              setIsDeletingWorkspace(true);
              setDeleteError('');
              try {
                await handleDeleteProject(pendingDeleteProject.id);
                setPendingDeleteProjectId(null);
              } catch (error) {
                console.error(error);
                setDeleteError('Delete failed. Make sure the backend is running and try again.');
              } finally {
                setIsDeletingWorkspace(false);
              }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
