/**
 * Debug agent logging — disabled for Chrome Web Store builds.
 * Kept as no-ops so call sites compile without a debug host permission.
 */

export interface AgentLogEntry {
  sessionId: string;
  location: string;
  message: string;
  data?: Record<string, unknown>;
  hypothesisId?: string;
  timestamp: number;
}

export function agentLog(
  _location: string,
  _message: string,
  _data?: Record<string, unknown>,
  _hypothesisId?: string,
): void {
  // no-op in production
}

export async function readAgentLogs(): Promise<AgentLogEntry[]> {
  return [];
}

export async function flushAgentLogs(): Promise<number> {
  return 0;
}
