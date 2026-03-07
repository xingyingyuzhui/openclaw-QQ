import { promises as fs } from "node:fs";
import { buildRoleContextBlock } from "./context-assembler.js";
import { ensureRolePackForRoute } from "./role-pack-service.js";

async function readLegacyPersonaPrompt(workspaceRoot: string, route: string): Promise<string> {
  try {
    const p = `${workspaceRoot}/qq_sessions/${route}/agent.json`;
    const raw = await fs.readFile(p, "utf8");
    const parsed = JSON.parse(raw || "{}");
    return String(parsed?.personaPrompt || "").trim();
  } catch {
    return "";
  }
}

export async function readRoutePersonaPrompt(workspaceRoot: string, route: string): Promise<string> {
  await ensureRolePackForRoute(workspaceRoot, route).catch(() => null);
  const roleBlock = await buildRoleContextBlock({
    accountWorkspaceRoot: workspaceRoot,
    route,
    compactMode: false,
  }).catch(() => "");
  if (String(roleBlock || "").trim()) return roleBlock;
  return readLegacyPersonaPrompt(workspaceRoot, route);
}
