/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';
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
  Image as ImageIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4000';

const splitLines = (text: string | null | undefined) => (text || '').replace(/\r\n/g, '\n').split('\n');
const reviewPaneText = (text: string | null | undefined, emptyLabel: string) => text && text.length > 0 ? text : emptyLabel;
const hasReviewSnapshot = (text: string | null | undefined) => text !== null && text !== undefined && text.length > 0;

const renderDiffLines = (beforeText: string | null | undefined, afterText: string | null | undefined) => {
  const beforeLines = splitLines(beforeText);
  const afterLines = splitLines(afterText);
  const maxLines = Math.max(beforeLines.length, afterLines.length);
  const rows: Array<{ before: string; after: string; kind: 'add' | 'delete' | 'update' | 'same' }> = [];

  for (let i = 0; i < maxLines; i += 1) {
    const before = beforeLines[i] ?? '';
    const after = afterLines[i] ?? '';

    if (before === after) {
      rows.push({ before, after, kind: 'same' });
    } else if (before && after) {
      rows.push({ before, after, kind: 'update' });
    } else if (before && !after) {
      rows.push({ before, after: '', kind: 'delete' });
    } else if (!before && after) {
      rows.push({ before: '', after, kind: 'add' });
    }
  }

  return rows;
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
  reason?: string;
  remarks?: string;
  diffSnippet?: string;
  content?: string | null;
  beforeContent?: string | null;
  afterContent?: string | null;
}

interface Turn {
  id: string;
  userMessage: string;
  taskTitle?: string;
  timestamp: string;
  modifiedFiles: ModifiedFile[];
  reasoning: { issue: string; solution: string };
  summary: string;
}

type AgentProvider = 'codex' | 'cursor';
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
}

interface ApiTurn {
  id: string;
  prompt: string;
  taskTitle?: string | null;
  assistantContent?: string | null;
  createdAt: string;
  modifiedFiles: ApiModifiedFile[];
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
    label: 'Codex',
    description: 'OpenAI Codex session for local workspace automation.',
    accent: 'text-blue-400 border-blue-500/40 bg-blue-500/10'
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

const ComparisonModal = ({ turns, onClose }: { turns: Turn[], onClose: () => void }) => {
  const [selectedFileIndex, setSelectedFileIndex] = useState<Record<string, number>>({});

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/90 p-4 lg:p-12 backdrop-blur-md"
    >
      <motion.div 
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="bg-surface-container border border-slate-800 rounded-2xl w-full max-w-6xl h-full flex flex-col shadow-2xl overflow-hidden"
      >
        {/* Modal Header */}
        <div className="p-6 border-b border-slate-800 flex justify-between items-center bg-slate-900/80">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-500/10 rounded-xl">
              <GitBranch className="text-blue-500" size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-display font-bold text-white tracking-tight">Technical Audit Report</h2>
              <p className="text-slate-500 text-sm">Comparing {turns.length} sequence points across the session architecture</p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 hover:bg-slate-800 rounded-full transition-all text-slate-500 hover:text-white"
          >
            <Plus className="rotate-45" size={24} />
          </button>
        </div>
        
        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-4 lg:p-8 space-y-12 hide-scrollbar">
          {turns.map((turn, turnIdx) => (
            <div key={turn.id} className="relative group">
              {/* Turn Connector Line */}
              {turnIdx < turns.length - 1 && (
                <div className="absolute left-[19px] top-10 bottom-[-48px] w-px bg-slate-800 group-hover:bg-blue-500/30 transition-colors"></div>
              )}

              <div className="flex gap-6">
                {/* Turn Marker */}
                <div className="relative z-10">
                  <div className="w-10 h-10 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-blue-400 font-bold font-mono text-sm shadow-xl">
                    {turnIdx + 1}
                  </div>
                </div>

                <div className="flex-1 space-y-6">
                  {/* Turn Header Info */}
                  <div className="flex flex-col lg:flex-row lg:items-center gap-4 justify-between">
                    <div>
                      <div className="text-[10px] text-slate-500 uppercase font-black tracking-[0.2em] mb-1">{turn.timestamp} • CONTEXT_TURN_{turn.id.split('-')[1]}</div>
                      <h3 className="text-lg font-medium text-white italic">"{turn.userMessage}"</h3>
                    </div>
                    <div className="px-4 py-2 bg-slate-900 border border-slate-800 rounded-lg shrink-0">
                      <div className="text-[10px] text-slate-600 uppercase font-bold mb-1">Status</div>
                      <div className="text-secondary text-xs font-bold flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-secondary animate-pulse"></div>
                        Architecture Verified
                      </div>
                    </div>
                  </div>

                  {/* Summary Block */}
                  <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-5 leading-relaxed text-sm text-slate-300">
                    <p>{turn.summary}</p>
                  </div>

                  {/* File Specific Analysis */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                    {/* File List/Tabs */}
                    <div className="lg:col-span-4 space-y-2">
                      <div className="text-[10px] text-slate-600 uppercase font-bold px-1 mb-2">Affected Assets</div>
                      {turn.modifiedFiles.map((file, fIdx) => (
                        <button
                          key={fIdx}
                          onClick={() => setSelectedFileIndex(prev => ({ ...prev, [turn.id]: fIdx }))}
                          className={`w-full text-left p-3 rounded-lg border transition-all flex items-center gap-3 ${
                            (selectedFileIndex[turn.id] || 0) === fIdx 
                            ? 'bg-blue-500/10 border-blue-500/50 ring-1 ring-blue-500/20' 
                            : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <span className={`text-xs font-mono font-bold shrink-0 ${file.statusColor}`}>{file.status}</span>
                          <span className={`text-xs font-mono truncate flex-1 ${ (selectedFileIndex[turn.id] || 0) === fIdx ? 'text-blue-400' : 'text-slate-400'}`}>
                            {file.name}
                          </span>
                          <ChevronDown size={14} className={`text-slate-600 transition-transform ${ (selectedFileIndex[turn.id] || 0) === fIdx ? '-rotate-90 text-blue-500' : ''}`} />
                        </button>
                      ))}
                    </div>

                    {/* File Detailed Reasoning & Diff */}
                    <div className="lg:col-span-8 bg-slate-950/50 border border-slate-800 rounded-xl overflow-hidden flex flex-col h-[400px]">
                      {(() => {
                        const file = turn.modifiedFiles[selectedFileIndex[turn.id] || 0];
                        if (!file) return null;
                        return (
                          <>
                            <div className="p-4 border-b border-slate-800 bg-slate-900/30 flex justify-between items-center">
                              <div className="flex items-center gap-3">
                                <span className={`text-xs font-mono font-bold ${file.statusColor}`}>{file.status === 'M' ? 'Modified' : file.status === 'A' ? 'Added' : 'Deleted'}</span>
                                <span className="text-xs font-mono text-slate-300">{file.name}</span>
                              </div>
                              <button className="text-[10px] text-blue-500 hover:text-blue-400 font-bold uppercase tracking-widest">Open in Editor</button>
                            </div>
                            
                            <div className="flex-1 overflow-y-auto p-5 space-y-6 hide-scrollbar">
                              <div>
                                <div className="text-[10px] text-blue-400 uppercase font-black tracking-widest mb-2">Technical Rationale</div>
                                <p className="text-sm text-on-surface-variant leading-relaxed">
                                  {file.reason || "Automatic optimization based on turn context requirements."}
                                </p>
                              </div>

                              <div className="p-4 bg-slate-900 border border-slate-800 rounded-lg">
                                <div className="text-[10px] text-tertiary uppercase font-black tracking-widest mb-2">Peer Review Notes</div>
                                <p className="text-xs text-slate-500 leading-relaxed italic">
                                  "{file.remarks || "No supplementary notes for this asset modification."}"
                                </p>
                              </div>

                              {file.diffSnippet && (
                                <div>
                                  <div className="text-[10px] text-slate-600 uppercase font-extrabold tracking-widest mb-2">Content Delta (Unified Diff)</div>
                                  <div className="rounded-lg bg-slate-950 p-4 font-mono text-[11px] leading-relaxed border border-white/5 text-slate-400 overflow-x-auto whitespace-pre">
                                    {file.diffSnippet}
                                  </div>
                                </div>
                              )}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Modal Footer */}
        <div className="p-6 border-t border-slate-800 bg-slate-900/80 flex flex-col sm:flex-row gap-4 items-center justify-between">
           <div className="flex items-center gap-3 text-slate-500 text-xs italic">
             <ShieldCheck size={14} className="text-secondary" />
             AI Integrity scan complete. Metadata verified against session UID.
           </div>
           <div className="flex gap-3 w-full sm:w-auto">
             <button className="flex-1 sm:flex-none px-6 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-lg transition-colors border border-slate-700">
               SAVE REPORT
             </button>
             <button 
              onClick={onClose}
              className="flex-1 sm:flex-none px-10 py-2.5 bg-blue-500 hover:bg-blue-600 text-white text-xs font-bold rounded-lg transition-all shadow-[0_0_20px_rgba(59,130,246,0.3)]"
            >
              FINALIZE REVIEW
            </button>
           </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

const WorkspacePane = ({ activeItem, setActiveItem, projects, sessionStatuses, onNewSession, onOpenAddProject, onDeleteProject }: { activeItem: string | null, setActiveItem: (id: string) => void, projects: WorkspaceProject[], sessionStatuses: Record<string, AgentRunStatus>, onNewSession: (projectId: string) => void, onOpenAddProject: () => void, onDeleteProject: (projectId: string) => void }) => {
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
                        <button
                          key={item.id}
                          onClick={() => setActiveItem(item.id)}
                          className={`w-full flex items-center gap-3 pl-10 pr-4 py-1.5 transition-all text-[11px] font-medium border-l-2 ${
                            activeItem === item.id 
                            ? 'bg-blue-500/10 text-blue-400 border-blue-500' 
                            : 'text-slate-500 hover:bg-slate-900/30 hover:text-slate-300 border-transparent'
                          }`}
                        >
                          {item.icon}
                          <span className="min-w-0 flex-1 truncate text-left">{item.name}</span>
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

const TerminalBlock = ({ sessionId, title, provider = 'codex', onRunCommand, onTaskTitle, onMessagesLoaded, onRunStatusChange }: { sessionId: string, title: string, provider?: AgentProvider, onRunCommand: (msg: string) => void, onTaskTitle: (title: string, sessionId: string) => void, onMessagesLoaded: (sessionId: string, messages: ApiMessage[], turns: ApiTurn[]) => void, onRunStatusChange: (sessionId: string, status: AgentRunStatus) => void }) => {
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [codexOptions, setCodexOptions] = useState<CodexOptionsResponse>(fallbackCodexOptions);
  const [codexModel, setCodexModel] = useState(fallbackCodexOptions.defaults.model);
  const [codexReasoningEffort, setCodexReasoningEffort] = useState<CodexReasoningEffort>(fallbackCodexOptions.defaults.reasoningEffort);
  const providerLabel = providerMeta[provider].label;
  const [history, setHistory] = useState([
    { type: 'cmd', text: `${provider}-agent ready`, prompt: true },
    { type: 'info', text: `Initializing ${providerLabel} agent...`, color: 'text-slate-500' },
    { type: 'info', text: 'Session context: ' + title, color: 'text-blue-400/70' },
    { type: 'info', text: 'Status: Web terminal attached.', color: 'text-secondary' },
  ]);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (provider !== 'codex') return;

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
        setHistory(prev => [
          ...prev,
          ...data.messages.map((message) => ({
            type: message.role === 'user' ? 'cmd' : 'info',
            text: message.content,
            prompt: message.role === 'user',
            color: message.role === 'assistant' ? 'text-slate-300' : undefined
          }))
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
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [history]);

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
    if (provider !== 'codex') return;

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
    const newCmd = {
      type: 'cmd',
      text: attachmentCount > 0 ? `${prompt}\n[${attachmentCount} image attachment${attachmentCount === 1 ? '' : 's'}]` : prompt,
      prompt: true
    };
    setHistory(prev => [...prev, newCmd]);
    const localCommand = prompt.toLowerCase();
    if (localCommand === 'clear') {
      setHistory([{ type: 'cmd', text: `${provider}-agent ready`, prompt: true }]);
      setInput('');
      return;
    }

    setInput('');
    const filesToSend = attachments.map(attachment => attachment.file);
    attachments.forEach(attachment => URL.revokeObjectURL(attachment.previewUrl));
    setAttachments([]);
    setIsRunning(true);
    onRunStatusChange(sessionId, 'busy');
    onRunCommand(prompt);

    try {
      const body = provider === 'codex' && filesToSend.length > 0
        ? (() => {
            const formData = new FormData();
            formData.append('prompt', prompt);
            formData.append('model', codexModel);
            formData.append('reasoningEffort', codexReasoningEffort);
            filesToSend.forEach(file => formData.append('attachments', file));
            return formData;
          })()
        : JSON.stringify({
            prompt,
            model: codexModel,
            reasoningEffort: codexReasoningEffort
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
            ? `[analyzing_images] ${providerLabel} received ${data.attachmentCount} image${data.attachmentCount === 1 ? '' : 's'} for ${data.model}`
            : `[${data.status}] ${providerLabel}${data.status === 'started' && data.model ? ` (${data.model}, ${data.reasoningEffort})` : ''}`;
          setHistory(prev => [...prev, { type: 'info', text: statusText, color: data.status === 'completed' ? 'text-secondary' : 'text-blue-400' }]);
        }
        if (event === 'task_title') {
          onTaskTitle(data.title, sessionId);
          setHistory(prev => [...prev, { type: 'info', text: `Task: ${data.title}`, color: 'text-blue-400' }]);
        }
        if (event === 'chunk') {
          setHistory(prev => [...prev, { type: data.stream === 'stderr' ? 'error' : 'info', text: data.text, color: data.stream === 'stderr' ? 'text-error' : 'text-slate-300' }]);
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

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-6 p-6">
      <div className="shrink-0 flex justify-between items-center gap-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold font-display text-on-surface">{providerLabel} CLI</h1>
          <div className="flex gap-2">
            <span className="px-2 py-1 bg-secondary/10 text-secondary text-[10px] font-bold border border-secondary/20 rounded">STATUS: READY</span>
            <span className="px-2 py-1 bg-slate-800 text-slate-400 text-[10px] font-bold border border-slate-700 rounded">PID: 4892</span>
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
              <div key={i} className={`flex items-start gap-2 ${line.color || ''}`}>
                {line.prompt && <span className="text-blue-400 font-bold shrink-0">➜</span>}
                <span className="whitespace-pre-wrap">{line.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="shrink-0 border-t border-slate-800 bg-slate-950">
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

          <form onSubmit={handleCommand} className="flex items-center gap-2 px-4 py-3 font-mono text-sm">
            <span className="text-blue-400 font-bold">➜</span>
            <span className="text-slate-500 font-bold select-none whitespace-nowrap">nexus-gateway</span>
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

const TurnDetailModal = ({ turn, onClose }: { turn: Turn, onClose: () => void }) => {
  const [detailTurn, setDetailTurn] = useState(turn);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;

    fetch(`${API_BASE_URL}/turns/${turn.id}`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Failed to load turn details')))
      .then((data: ApiTurn) => {
        if (cancelled) return;
        setDetailTurn({
          ...turn,
          summary: data.assistantContent || turn.summary,
          modifiedFiles: data.modifiedFiles.map((file) => ({
            name: file.path,
            status: file.kind === 'add' ? 'A' : file.kind === 'delete' ? 'D' : 'M',
            statusColor: file.kind === 'add' ? 'text-blue-400' : file.kind === 'delete' ? 'text-error' : 'text-secondary',
            content: file.content,
            beforeContent: file.beforeContent || null,
            afterContent: file.afterContent || file.content || null,
            diffSnippet: file.afterContent || file.content || ''
          }))
        });
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [turn]);

  const selectedFile = detailTurn.modifiedFiles[selectedFileIndex];

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
        <div className="flex items-start justify-between border-b border-slate-800 p-4">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-bold uppercase tracking-widest text-blue-400">{detailTurn.taskTitle || 'Untitled Task'}</h2>
            <p className="mt-2 text-xs leading-relaxed text-slate-400">"{detailTurn.userMessage}"</p>
          </div>
          <button onClick={onClose} className="rounded p-1.5 text-slate-500 transition-colors hover:bg-slate-900 hover:text-slate-200" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-hidden">
          {detailTurn.modifiedFiles.length === 0 ? (
            <div className="flex h-48 items-center justify-center text-xs font-bold uppercase tracking-widest text-slate-600">
              No file changes recorded for this turn
            </div>
          ) : (
            <div className="grid h-full min-h-0 grid-cols-12">
              <div className="col-span-4 border-r border-slate-800 overflow-y-auto p-3 hide-scrollbar">
                <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-600">Files</div>
                <div className="space-y-2">
                  {detailTurn.modifiedFiles.map((file, index) => (
                    <button
                      key={`${file.name}-${index}`}
                      onClick={() => setSelectedFileIndex(index)}
                      className={`w-full rounded border px-3 py-2 text-left transition-colors ${
                        selectedFileIndex === index
                          ? 'border-blue-500 bg-blue-500/10'
                          : 'border-slate-800 bg-slate-900/40 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-mono font-bold ${file.statusColor}`}>{file.status}</span>
                        <span className="truncate text-[11px] font-mono text-slate-300">{file.name}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="col-span-8 flex min-h-0 flex-col overflow-hidden">
                <div className="border-b border-slate-800 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-mono font-bold ${selectedFile?.statusColor}`}>{selectedFile?.status}</span>
                    <span className="truncate text-xs font-mono text-slate-300">{selectedFile?.name}</span>
                  </div>
                </div>
                {selectedFile?.status === 'A' ? (
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
                          {splitLines(reviewPaneText(selectedFile?.beforeContent, 'No before snapshot available.')).map((line, index) => (
                            <div key={index} className="flex">
                              <span className="mr-3 w-8 shrink-0 text-right text-slate-600">{index + 1}</span>
                              <span className="flex-1 bg-transparent">{line || ' '}</span>
                            </div>
                          ))}
                        </pre>
                      </div>
                      <div className="overflow-y-auto bg-slate-950/40 p-3 hide-scrollbar">
                        <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-600">After</div>
                        <pre className="whitespace-pre-wrap text-xs leading-relaxed text-slate-300">
                          {splitLines(reviewPaneText(selectedFile?.afterContent, 'No after snapshot available.')).map((line, index) => (
                            <div key={index} className="flex">
                              <span className="mr-3 w-8 shrink-0 text-right text-slate-600">{index + 1}</span>
                              <span className="flex-1 bg-transparent">{line || ' '}</span>
                            </div>
                          ))}
                        </pre>
                      </div>
                    </div>

                    <div className="border-t border-slate-800 p-3">
                      <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-600">Line Diff</div>
                      <div className="max-h-72 overflow-y-auto rounded border border-slate-800 bg-slate-950/60 p-3 font-mono text-xs hide-scrollbar">
                        {reviewDiffUnavailableText(selectedFile) ? (
                          <div className="py-6 text-center text-[11px] font-bold uppercase tracking-widest text-slate-600">
                            {reviewDiffUnavailableText(selectedFile)}
                          </div>
                        ) : (
                          renderDiffLines(selectedFile?.beforeContent, selectedFile?.afterContent).map((row, index) => (
                            <div key={index} className="grid grid-cols-2 gap-4 border-b border-slate-800/50 py-1 last:border-b-0">
                              <div className={`${row.kind === 'delete' || row.kind === 'update' ? 'bg-red-500/10 text-red-200' : 'text-slate-600'}`}>
                                {row.before ? `- ${row.before}` : ' '}
                              </div>
                              <div className={`${row.kind === 'add' || row.kind === 'update' ? 'bg-green-500/10 text-green-200' : 'text-slate-600'}`}>
                                {row.after ? `+ ${row.after}` : ' '}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};

const RightPanel = ({ turns }: { turns: Turn[] }) => {
  const [selectedTurn, setSelectedTurn] = useState<Turn | null>(null);
  const sortedTurns = [...turns].reverse();

  return (
    <aside className="fixed right-0 top-12 w-80 h-[calc(100vh-48px)] bg-slate-950 border-l border-slate-800 flex flex-col z-30">
      <div className="p-4 border-b border-slate-800 bg-slate-900/50 flex justify-between items-center">
        <div>
          <h2 className="font-display text-blue-400 text-sm font-bold uppercase tracking-tight flex items-center gap-2">
            <Zap size={14} /> Analysis & Mods
          </h2>
          <p className="text-[10px] text-slate-500 uppercase mt-1">Conversation Tasks</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 hide-scrollbar">
        {turns.length === 0 ? (
          <div className="h-40 flex flex-col items-center justify-center opacity-20 text-center px-4">
            <MessageSquare size={32} className="mb-2" />
            <p className="text-[10px] uppercase font-bold tracking-widest">No conversation tracking active</p>
          </div>
        ) : (
          sortedTurns.map((turn) => (
            <div 
              key={turn.id}
              onClick={() => setSelectedTurn(turn)}
              className="group cursor-pointer border rounded-lg p-3 transition-all relative overflow-hidden bg-slate-900/40 border-slate-800 hover:border-slate-700"
            >
              <div className="flex justify-between items-start mb-2 relative z-10">
                <span className="text-[9px] text-slate-600 font-bold uppercase tracking-tighter">{turn.timestamp}</span>
                <MessageSquare size={12} className="text-blue-400/60" />
              </div>
              <h3 className="mb-2 truncate text-xs font-bold text-blue-300">{turn.taskTitle || 'Untitled Task'}</h3>
              <p className="text-xs text-on-surface line-clamp-2 relative z-10">"{turn.userMessage}"</p>
              <div className="mt-3 border-t border-slate-800 pt-2 text-[9px] font-bold uppercase tracking-widest text-slate-600">
                {turn.modifiedFiles.length} changed file{turn.modifiedFiles.length === 1 ? '' : 's'}
              </div>
            </div>
          ))
        )}
      </div>
      <AnimatePresence>
        {selectedTurn && (
          <TurnDetailModal turn={selectedTurn} onClose={() => setSelectedTurn(null)} />
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

export default function App() {
  const [activeItem, setActiveItem] = useState<string | null>(null);
  const [selectedTurns, setSelectedTurns] = useState<string[]>([]);
  const [isAddProjectOpen, setIsAddProjectOpen] = useState(false);
  const [pendingSessionProjectId, setPendingSessionProjectId] = useState<string | null>(null);
  const [pendingDeleteProjectId, setPendingDeleteProjectId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false);
  const [projects, setProjects] = useState<WorkspaceProject[]>([]);
  const [sessionTurns, setSessionTurns] = useState<Record<string, Turn[]>>({});
  const [sessionStatuses, setSessionStatuses] = useState<Record<string, AgentRunStatus>>({});

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
    if (activeItem && deletedSessionIds.has(activeItem)) {
      setActiveItem(null);
      setSelectedTurns([]);
    }
    await loadWorkspaces();
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
    setSessionStatuses(prev => ({
      ...prev,
      [session.id]: 'idle'
    }));
    setActiveItem(session.id);
    setSelectedTurns([]);
  };

  const activeSession = projects.flatMap(project => project.items).find(item => item.id === activeItem);
  const pendingSessionProject = projects.find(project => project.id === pendingSessionProjectId);
  const pendingDeleteProject = projects.find(project => project.id === pendingDeleteProjectId);

  const handleNewTurn = (message: string) => {
    if (!activeItem) return;
    const fallbackTitle = message.length > 24 ? message.slice(0, 24) : message;
    
    const newTurn: Turn = {
      id: `turn-${(sessionTurns[activeItem]?.length || 0) + 1}`,
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
          userMessage: turn.prompt,
          taskTitle: turn.taskTitle || (turn.prompt.length > 24 ? turn.prompt.slice(0, 24) : turn.prompt),
          timestamp: new Date(turn.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
          summary: turn.assistantContent || '',
          reasoning: { issue: '', solution: '' },
            modifiedFiles: turn.modifiedFiles.map((file) => ({
              name: file.path,
              status: file.kind === 'add' ? 'A' : file.kind === 'delete' ? 'D' : 'M',
              statusColor: file.kind === 'add' ? 'text-blue-400' : file.kind === 'delete' ? 'text-error' : 'text-secondary',
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
          setActiveItem={(id) => { setActiveItem(id); setSelectedTurns([]); }}
          projects={projects}
          sessionStatuses={sessionStatuses}
          onNewSession={setPendingSessionProjectId}
          onOpenAddProject={() => setIsAddProjectOpen(true)}
          onDeleteProject={(projectId) => {
            setDeleteError('');
            setPendingDeleteProjectId(projectId);
          }}
        />
        <main className="flex-1 min-h-0 ml-64 mr-80 overflow-hidden flex flex-col relative bg-slate-950/20">
          <AnimatePresence mode="wait">
            {activeItem ? (
              <motion.div 
                key={activeItem}
                initial={{ opacity: 0, scale: 0.99 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.99 }}
                transition={{ duration: 0.2 }}
                className="flex-1 min-h-0 flex flex-col"
              >
                <TerminalBlock 
                  sessionId={activeItem}
                  title={activeSession?.name || activeItem.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')}
                  provider={activeSession?.provider || 'codex'}
                  onRunCommand={handleNewTurn}
                  onTaskTitle={handleTaskTitle}
                  onMessagesLoaded={handleMessagesLoaded}
                  onRunStatusChange={handleRunStatusChange}
                />
              </motion.div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center opacity-30 select-none">
                <Terminal size={64} className="mb-4" />
                <p className="text-sm font-display uppercase tracking-widest">Select a terminal session from the explorer</p>
              </div>
            )}
          </AnimatePresence>
        </main>
        <RightPanel 
          turns={sessionTurns[activeItem || ''] || []} 
        />
      </div>
      <AnimatePresence>
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
