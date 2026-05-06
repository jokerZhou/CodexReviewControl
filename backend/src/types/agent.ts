export type AgentProvider = 'codex' | 'codex-cli' | 'cursor' | 'terminal';

export interface AgentEvent {
  type: 'started' | 'output' | 'completed' | 'failed';
  sessionId: string;
  message?: string;
  data?: unknown;
}
