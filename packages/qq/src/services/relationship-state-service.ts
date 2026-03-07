import {
  readRolePackForRoute,
  resetRelationshipForRoute,
  renderRolePackSummary,
  upsertRelationshipForRoute,
} from "./role-pack-service.js";

export async function readRelationshipSummary(accountWorkspaceRoot: string, route: string): Promise<string> {
  const role = await readRolePackForRoute(accountWorkspaceRoot, route);
  if (!role) return `[关系] ${route}\n未初始化角色包。`;
  return [
    `[关系] ${route}`,
    `名称: ${role.persona.name || "-"}`,
    `好感度: ${role.relationship.affinity}`,
    `阶段: ${role.relationship.affinity_stage}`,
    `信任: ${role.relationship.trust}`,
    `主动性: ${role.relationship.initiative_level}`,
    `更新时间: ${role.relationship.updated_at}`,
  ].join("\n");
}

export async function readAffinitySummary(accountWorkspaceRoot: string, route: string): Promise<string> {
  const role = await readRolePackForRoute(accountWorkspaceRoot, route);
  if (!role) return `[好感度] ${route}\n未初始化角色包。`;
  return [
    `[好感度] ${route}`,
    `名称: ${role.persona.name || "-"}`,
    `好感度: ${role.relationship.affinity}`,
    `阶段: ${role.relationship.affinity_stage}`,
    `信任: ${role.relationship.trust}`,
    `主动性: ${role.relationship.initiative_level}`,
  ].join("\n");
}

export async function setRouteAffinity(accountWorkspaceRoot: string, route: string, affinity: number): Promise<string> {
  const next = await upsertRelationshipForRoute(accountWorkspaceRoot, route, { affinity });
  return [`[好感度] ${route}`, `已设置为 ${next.affinity}`, `阶段: ${next.affinity_stage}`, `信任: ${next.trust}`].join("\n");
}

export async function resetRouteRelationship(accountWorkspaceRoot: string, route: string): Promise<string> {
  const next = await resetRelationshipForRoute(accountWorkspaceRoot, route);
  return [`[关系] ${route}`, `已重置`, `好感度: ${next.affinity}`, `阶段: ${next.affinity_stage}`].join("\n");
}

export async function readRoleAndRelationshipSummary(accountWorkspaceRoot: string, route: string): Promise<string> {
  const role = await readRolePackForRoute(accountWorkspaceRoot, route);
  if (!role) return `[角色] ${route}\n未初始化角色包。`;
  return renderRolePackSummary(role);
}
