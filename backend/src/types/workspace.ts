import type { AgentProvider } from './agent.js';

export interface WorkspaceDto {
  id: string;
  name: string;
  path: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionDto {
  id: string;
  name: string;
  provider: AgentProvider;
  workspaceId: string;
  createdAt: string;
  updatedAt: string;
}
