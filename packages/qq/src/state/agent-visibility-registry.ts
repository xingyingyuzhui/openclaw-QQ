const ensuredAgentVisible = new Set<string>();
const ensureAgentVisibleAttemptAt = new Map<string, number>();

export const ENSURE_AGENT_VISIBLE_RETRY_MS = 60_000;

export function hasEnsuredAgentVisible(agentId: string): boolean {
  return ensuredAgentVisible.has(String(agentId || "").trim().toLowerCase());
}

export function markEnsuredAgentVisible(agentId: string): void {
  const key = String(agentId || "").trim().toLowerCase();
  if (key) ensuredAgentVisible.add(key);
}

export function getEnsureAgentVisibleAttemptAt(agentId: string): number {
  return ensureAgentVisibleAttemptAt.get(String(agentId || "").trim().toLowerCase()) || 0;
}

export function setEnsureAgentVisibleAttemptAt(agentId: string, ts: number): void {
  const key = String(agentId || "").trim().toLowerCase();
  if (key) ensureAgentVisibleAttemptAt.set(key, ts);
}
