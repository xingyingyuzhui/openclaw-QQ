import path from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { OWNER_AGENT, getOwnerRoute, routeToSessionKey } from "./target-config.js";
import { readJson } from "./state-store.js";

type ListedAgent = { id?: string };

export async function runOpenclawJsonCommand(
  api: OpenClawPluginApi,
  args: string[],
  timeoutMs = 30_000,
): Promise<unknown> {
  const res = await api.runtime.system.runCommandWithTimeout(["openclaw", ...args], { timeoutMs });
  const stdout = String(res.stdout || "").trim();
  const stderr = String(res.stderr || "").trim();
  if (res.code !== 0) throw new Error(`openclaw ${args.join(" ")} failed code=${res.code}: ${stderr || stdout}`);
  if (!stdout) return {};
  try {
    return JSON.parse(stdout);
  } catch {
    return { text: stdout };
  }
}

export function fallbackAgentIdByRoute(route: string): string {
  if (route === getOwnerRoute()) return OWNER_AGENT;
  const user = route.match(/^user:(\d{5,})$/)?.[1];
  if (user) return `qq-user-${user}`;
  const group = route.match(/^group:(\d{5,})$/)?.[1];
  if (group) return `qq-group-${group}`;
  const guild = route.match(/^guild:([^:]+):([^:]+)$/);
  if (guild) return `qq-guild-${guild[1]}-${guild[2]}`;
  return "main";
}

export async function resolveAgentId(workspaceRoot: string, route: string): Promise<string> {
  const candidates = [
    path.join(workspaceRoot, "qq_sessions", route, "agent.json"),
    path.join(workspaceRoot, "qq_sessions", routeToSessionKey(route), "agent.json"),
  ];
  for (const file of candidates) {
    const data = await readJson<{ agentId?: string }>(file);
    const id = String(data?.agentId || "").trim();
    if (id) return id;
  }
  return fallbackAgentIdByRoute(route);
}

export async function listConfiguredAgentIds(api: OpenClawPluginApi): Promise<Set<string>> {
  const raw = await runOpenclawJsonCommand(api, ["agents", "list", "--json"], 20_000);
  const rows = Array.isArray(raw) ? (raw as ListedAgent[]) : [];
  const ids = new Set<string>();
  for (const row of rows) {
    const id = String(row?.id || "")
      .trim()
      .toLowerCase();
    if (id) ids.add(id);
  }
  return ids;
}

function resolveStateRootFromWorkspace(workspaceRoot: string): string {
  return path.resolve(path.dirname(workspaceRoot));
}

export function resolveWorkspaceForAgent(workspaceRoot: string, agentId: string): string {
  if (agentId === OWNER_AGENT) return workspaceRoot;
  const stateRoot = resolveStateRootFromWorkspace(workspaceRoot);
  return path.join(stateRoot, `workspace-${agentId}`);
}

function resolveAgentDirForAgent(workspaceRoot: string, agentId: string): string {
  const stateRoot = resolveStateRootFromWorkspace(workspaceRoot);
  return path.join(stateRoot, "agents", agentId, "agent");
}

export async function ensureAgentRegistered(
  api: OpenClawPluginApi,
  workspaceRoot: string,
  agentIdRaw: string,
): Promise<void> {
  const agentId = String(agentIdRaw || "")
    .trim()
    .toLowerCase();
  if (!agentId || agentId === OWNER_AGENT) return;

  const configured = await listConfiguredAgentIds(api);
  if (configured.has(agentId)) return;

  const workspace = resolveWorkspaceForAgent(workspaceRoot, agentId);
  const agentDir = resolveAgentDirForAgent(workspaceRoot, agentId);
  try {
    await runOpenclawJsonCommand(
      api,
      [
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
      45_000,
    );
    api.logger.info(
      `qq-automation-manager: auto-registered agent id=${agentId} workspace=${workspace} agentDir=${agentDir}`,
    );
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (!/already exists/i.test(msg)) {
      throw err;
    }
  }
}
