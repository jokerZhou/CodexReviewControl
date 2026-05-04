export type AgentProvider = 'codex' | 'codex-cli' | 'cursor';

export interface AgentEvent {
  type: 'started' | 'output' | 'completed' | 'failed';
  sessionId: string;
  message?: string;
  data?: unknown;
}
