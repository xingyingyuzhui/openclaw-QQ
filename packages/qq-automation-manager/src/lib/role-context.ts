import path from "node:path";
import { readJson } from "./state-store.js";
import { resolveWorkspaceForAgent } from "./route-agent-resolver.js";

export type AutomationRoleContext = {
  templateId: string;
  roleName: string;
  roleIdentity: string;
  roleRelationship: string;
  styleSummary: string;
  affinity: number;
  affinityStage: string;
  trust: number;
  initiativeLevel: string;
};

function compact(value: string, max: number): string {
  const text = String(value || "").replace(/\r/g, "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

async function readText(filePath: string): Promise<string> {
  try {
    const { promises: fs } = await import("node:fs");
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

export async function readAutomationRoleContext(params: {
  workspaceRoot: string;
  route: string;
  agentId: string;
}): Promise<AutomationRoleContext | null> {
  const agentWorkspace = resolveWorkspaceForAgent(params.workspaceRoot, params.agentId);
  const meta = await readJson<{ templateId?: string }>(path.join(agentWorkspace, "runtime", "role-pack.meta.json"));
  const persona = await readJson<{
    name?: string;
    identity?: string;
    relationship?: string;
  }>(path.join(agentWorkspace, "character", "persona-core.json"));
  const relationship = await readJson<{
    affinity?: number;
    affinity_stage?: string;
    trust?: number;
    initiative_level?: string;
  }>(path.join(agentWorkspace, "runtime", "relationship.json"));
  const style = await readText(path.join(agentWorkspace, "character", "style.md"));

  if (!meta && !persona && !relationship && !style.trim()) return null;

  return {
    templateId: String(meta?.templateId || "default"),
    roleName: compact(String(persona?.name || ""), 24),
    roleIdentity: compact(String(persona?.identity || ""), 96),
    roleRelationship: compact(String(persona?.relationship || ""), 96),
    styleSummary: compact(style, 160),
    affinity: Number(relationship?.affinity || 50),
    affinityStage: String(relationship?.affinity_stage || "familiar"),
    trust: Number(relationship?.trust || 50),
    initiativeLevel: String(relationship?.initiative_level || "medium"),
  };
}

export function buildAutomationRoleBlock(ctx: AutomationRoleContext | null): string {
  if (!ctx) return "";
  const lines = [
    "角色与关系约束：",
    `- 模板: ${ctx.templateId}`,
    ctx.roleName ? `- 名称: ${ctx.roleName}` : "",
    ctx.roleIdentity ? `- 身份: ${ctx.roleIdentity}` : "",
    ctx.roleRelationship ? `- 关系定位: ${ctx.roleRelationship}` : "",
    `- 当前关系: 好感度=${ctx.affinity} (${ctx.affinityStage})，信任=${ctx.trust}，主动性=${ctx.initiativeLevel}`,
    ctx.styleSummary ? `- 风格摘要: ${ctx.styleSummary}` : "",
    "- 只有在当前关系和风格下确实自然时才主动开口；否则宁可克制。",
  ].filter(Boolean);
  return lines.join("\n");
}
