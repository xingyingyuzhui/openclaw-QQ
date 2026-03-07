import { readRolePackForRoute } from "./role-pack-service.js";

function compact(text: string, max: number): string {
  const value = String(text || "").replace(/\r/g, "").replace(/\s+/g, " ").trim();
  if (!value) return "";
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
}

export async function buildRoleContextBlock(params: {
  accountWorkspaceRoot: string;
  route: string;
  compactMode?: boolean;
}): Promise<string> {
  const role = await readRolePackForRoute(params.accountWorkspaceRoot, params.route);
  if (!role) return "";
  const lines: string[] = [];
  lines.push(`<system>角色设定：名称=${compact(role.persona.name, 24)}；身份=${compact(role.persona.identity, params.compactMode ? 72 : 140)}；关系定位=${compact(role.persona.relationship, params.compactMode ? 72 : 140)}。</system>`);
  if (role.persona.tone.length) {
    lines.push(`<system>角色语气：${role.persona.tone.slice(0, params.compactMode ? 3 : 5).join("、")}。</system>`);
  }
  lines.push(`<system>关系状态：好感度=${role.relationship.affinity}；阶段=${role.relationship.affinity_stage}；信任=${role.relationship.trust}；主动性=${role.relationship.initiative_level}。</system>`);
  const style = compact(role.style, params.compactMode ? 120 : 280);
  if (style) {
    lines.push(`<system>风格摘要：${style}</system>`);
  }
  return lines.join("\n\n");
}
