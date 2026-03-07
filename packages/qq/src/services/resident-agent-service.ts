import path from "node:path";
import {
  ENSURE_AGENT_VISIBLE_RETRY_MS,
  getEnsureAgentVisibleAttemptAt,
  hasEnsuredAgentVisible,
  markEnsuredAgentVisible,
  setEnsureAgentVisibleAttemptAt,
} from "../state/agent-visibility-registry.js";

export function resolveStateRootFromWorkspace(workspaceRoot: string): string {
  return path.resolve(path.dirname(workspaceRoot));
}

export function resolveWorkspaceForAgent(workspaceRoot: string, agentId: string): string {
  if (agentId === "main") return workspaceRoot;
  const stateRoot = resolveStateRootFromWorkspace(workspaceRoot);
  return path.join(stateRoot, `workspace-${agentId}`);
}

export function resolveAgentDirForAgent(workspaceRoot: string, agentId: string): string {
  const stateRoot = resolveStateRootFromWorkspace(workspaceRoot);
  return path.join(stateRoot, "agents", agentId, "agent");
}

export async function ensureResidentAgentVisible(
  runtime: { system: { runCommandWithTimeout: (args: string[], opts: { timeoutMs: number }) => Promise<any> } },
  workspaceRoot: string,
  agentIdRaw: string,
): Promise<void> {
  const agentId = String(agentIdRaw || "").trim().toLowerCase();
  if (!agentId || agentId === "main") return;
  if (hasEnsuredAgentVisible(agentId)) return;

  const now = Date.now();
  const lastAttempt = getEnsureAgentVisibleAttemptAt(agentId);
  if (now - lastAttempt < ENSURE_AGENT_VISIBLE_RETRY_MS) return;
  setEnsureAgentVisibleAttemptAt(agentId, now);

  try {
    const listRes = await runtime.system.runCommandWithTimeout(["openclaw", "agents", "list", "--json"], {
      timeoutMs: 20_000,
    });
    if (listRes.code === 0) {
      const rows = JSON.parse(String(listRes.stdout || "[]"));
      if (Array.isArray(rows) && rows.some((r) => String((r as any)?.id || "").toLowerCase() === agentId)) {
        markEnsuredAgentVisible(agentId);
        return;
      }
    }

    const workspace = resolveWorkspaceForAgent(workspaceRoot, agentId);
    const agentDir = resolveAgentDirForAgent(workspaceRoot, agentId);
    const addRes = await runtime.system.runCommandWithTimeout(
      [
        "openclaw",
        "agents",
        "add",
        agentId,
        "--workspace",
        workspace,
        "--agent-dir",
        agentDir,
        "--non-interactive",
        "--json",
      ],
      { timeoutMs: 45_000 },
    );
    if (addRes.code !== 0 && !/already exists/i.test(String(addRes.stderr || ""))) {
      throw new Error(String(addRes.stderr || addRes.stdout || `exit_code=${addRes.code}`));
    }
    markEnsuredAgentVisible(agentId);
    console.log(`[QQ][agent-visible] ensured agent_id=${agentId} workspace=${workspace}`);
  } catch (err: any) {
    console.warn(`[QQ][agent-visible] ensure failed agent_id=${agentId} error=${err?.message || err}`);
  }
}
