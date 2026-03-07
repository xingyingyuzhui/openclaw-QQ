import { promises as fs } from "node:fs";
import path from "node:path";
import { OWNER_MAIN_AGENT_ID, isOwnerPrivateRoute, routeToResidentAgentId } from "../routing.js";
import { resolveWorkspaceForAgent } from "./resident-agent-service.js";
import {
  affinityStage,
  buildTemplate,
  clamp,
  compactParagraph,
  DEFAULT_CAPABILITIES,
  DEFAULT_QQ_RULES,
  defaultPreferences,
  defaultRelationship,
  nowIso,
  templateForRoute,
  type PersonaCore,
  type PreferencesState,
  type RelationshipState,
  type RolePack,
  type RolePackMeta,
  type RolePackSource,
} from "./role-pack-defaults.js";
import { buildImportedPersonaBits, importSeedFromSource } from "./role-pack-importer.js";

type LocalRouteMetadata = {
  agentId: string;
  route: string;
  accountId: string;
  createdAt: string;
  updatedAt: string;
  capabilities?: {
    sendText: boolean;
    sendMedia: boolean;
    sendVoice: boolean;
    skills: string[];
    maxSendText?: number | null;
    maxSendMedia?: number | null;
    maxSendVoice?: number | null;
  };
  rolePackVersion?: number;
  roleTemplateId?: string;
  relationshipStatePath?: string;
  rolePackSource?: RolePackSource;
  personaPrompt?: string;
};

function agentIdForRoute(route: string): string {
  return isOwnerPrivateRoute(route) ? OWNER_MAIN_AGENT_ID : routeToResidentAgentId(route);
}

export function resolveRoleWorkspace(accountWorkspaceRoot: string, route: string): string {
  return resolveWorkspaceForAgent(accountWorkspaceRoot, agentIdForRoute(route));
}

export function rolePackPaths(agentWorkspace: string) {
  return {
    persona: path.join(agentWorkspace, "character", "persona-core.json"),
    style: path.join(agentWorkspace, "character", "style.md"),
    examples: path.join(agentWorkspace, "character", "examples.md"),
    qqRules: path.join(agentWorkspace, "channel", "qq-rules.md"),
    capabilities: path.join(agentWorkspace, "channel", "capabilities.md"),
    relationship: path.join(agentWorkspace, "runtime", "relationship.json"),
    preferences: path.join(agentWorkspace, "runtime", "preferences.json"),
    meta: path.join(agentWorkspace, "runtime", "role-pack.meta.json"),
    soul: path.join(agentWorkspace, "SOUL.md"),
  };
}

function routeMetadataFile(accountWorkspaceRoot: string, route: string) {
  return path.join(accountWorkspaceRoot, "qq_sessions", route, "agent.json");
}

async function readLocalRouteMetadata(accountWorkspaceRoot: string, route: string): Promise<LocalRouteMetadata | null> {
  try {
    const raw = await fs.readFile(routeMetadataFile(accountWorkspaceRoot, route), "utf8");
    return JSON.parse(raw || "{}") as LocalRouteMetadata;
  } catch {
    return null;
  }
}

async function writeLocalRouteMetadata(accountWorkspaceRoot: string, route: string, data: LocalRouteMetadata): Promise<void> {
  const filePath = routeMetadataFile(accountWorkspaceRoot, route);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

export async function ensureRouteRoleMetadata(accountWorkspaceRoot: string, route: string, accountId: string): Promise<LocalRouteMetadata> {
  const now = nowIso();
  const existing = await readLocalRouteMetadata(accountWorkspaceRoot, route);
  const next: LocalRouteMetadata = {
    agentId: existing?.agentId || agentIdForRoute(route),
    route,
    accountId: existing?.accountId || accountId || "default",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    capabilities: existing?.capabilities || {
      sendText: true,
      sendMedia: true,
      sendVoice: true,
      skills: [],
      maxSendText: null,
      maxSendMedia: null,
      maxSendVoice: null,
    },
    rolePackVersion: existing?.rolePackVersion,
    roleTemplateId: existing?.roleTemplateId,
    relationshipStatePath: existing?.relationshipStatePath,
    rolePackSource: existing?.rolePackSource,
    personaPrompt: existing?.personaPrompt,
  };
  await writeLocalRouteMetadata(accountWorkspaceRoot, route, next);
  return next;
}

async function readJsonIfExists<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw || "null") as T | null;
  } catch {
    return null;
  }
}

async function readTextIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function writeText(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

async function syncRouteRoleMetadata(accountWorkspaceRoot: string, route: string, patch: Partial<{ rolePackVersion: number; roleTemplateId: string; relationshipStatePath: string; rolePackSource: RolePackSource }>) {
  const existing = (await readLocalRouteMetadata(accountWorkspaceRoot, route)) || (await ensureRouteRoleMetadata(accountWorkspaceRoot, route, "default"));
  await writeLocalRouteMetadata(accountWorkspaceRoot, route, { ...existing, ...patch, updatedAt: nowIso() });
}

async function buildSeedStyle(accountWorkspaceRoot: string, route: string, agentWorkspace: string, templateStyle: string): Promise<string> {
  const { soul } = rolePackPaths(agentWorkspace);
  const soulText = compactParagraph(await readTextIfExists(soul), 1200);
  if (soulText) return `${templateStyle}\n\n# 迁移自 SOUL.md\n\n${soulText}`;
  try {
    const raw = await fs.readFile(routeMetadataFile(accountWorkspaceRoot, route), "utf8");
    const parsed = JSON.parse(raw || "{}");
    const legacy = compactParagraph(String(parsed?.personaPrompt || ""), 800);
    if (legacy) return `${templateStyle}\n\n# 迁移自 personaPrompt\n\n${legacy}`;
  } catch {}
  return templateStyle;
}

async function writeRolePack(agentWorkspace: string, payload: { persona: PersonaCore; style: string; examples: string; relationship: RelationshipState; preferences: PreferencesState; meta: RolePackMeta }) {
  const paths = rolePackPaths(agentWorkspace);
  await writeJson(paths.persona, payload.persona);
  await writeText(paths.style, `${payload.style.trim()}\n`);
  await writeText(paths.examples, `${payload.examples.trim()}\n`);
  await writeText(paths.qqRules, `${DEFAULT_QQ_RULES}\n`);
  await writeText(paths.capabilities, `${DEFAULT_CAPABILITIES}\n`);
  await writeJson(paths.relationship, payload.relationship);
  await writeJson(paths.preferences, payload.preferences);
  await writeJson(paths.meta, payload.meta);
  return paths;
}

function needsRuleRefresh(text: string): boolean {
  const value = String(text || "");
  if (!value.trim()) return true;
  if (!/需要发送图片、语音、文件时，直接输出 MEDIA:/i.test(value)) return true;
  if (!/不把内部思考|不要把内部思考/.test(value)) return true;
  return false;
}

function needsCapabilitiesRefresh(text: string): boolean {
  const value = String(text || "");
  if (!value.trim()) return true;
  if (!/当前 QQ 会话绑定交付/.test(value)) return true;
  if (!/不要把内部思考|不要把内部思考过程发给用户/.test(value)) return true;
  return false;
}

async function refreshRolePackDocs(agentWorkspace: string): Promise<void> {
  const paths = rolePackPaths(agentWorkspace);
  const [qqRules, capabilities] = await Promise.all([
    readTextIfExists(paths.qqRules),
    readTextIfExists(paths.capabilities),
  ]);
  const writes: Array<Promise<void>> = [];
  if (needsRuleRefresh(qqRules)) writes.push(writeText(paths.qqRules, `${DEFAULT_QQ_RULES}\n`));
  if (needsCapabilitiesRefresh(capabilities)) writes.push(writeText(paths.capabilities, `${DEFAULT_CAPABILITIES}\n`));
  await Promise.all(writes);
}

export async function ensureRolePackForRoute(accountWorkspaceRoot: string, route: string): Promise<string | null> {
  if (isOwnerPrivateRoute(route)) return resolveRoleWorkspace(accountWorkspaceRoot, route);
  await ensureRouteRoleMetadata(accountWorkspaceRoot, route, "default");
  const agentWorkspace = resolveRoleWorkspace(accountWorkspaceRoot, route);
  const paths = rolePackPaths(agentWorkspace);
  const persona = await readJsonIfExists(paths.persona);
  if (persona) {
    await refreshRolePackDocs(agentWorkspace);
    return agentWorkspace;
  }
  const templateId = templateForRoute(route);
  const tpl = buildTemplate(templateId);
  const importedAt = nowIso();
  const written = await writeRolePack(agentWorkspace, {
    persona: { ...tpl.persona, source: { kind: "migrated", label: templateId, importedAt } },
    style: await buildSeedStyle(accountWorkspaceRoot, route, agentWorkspace, tpl.style),
    examples: tpl.examples,
    relationship: defaultRelationship(),
    preferences: defaultPreferences(),
    meta: { version: 1, route, agentId: agentIdForRoute(route), templateId, source: "migrated", importedFrom: "bootstrap-or-legacy", updatedAt: importedAt },
  });
  await syncRouteRoleMetadata(accountWorkspaceRoot, route, { rolePackVersion: 1, roleTemplateId: templateId, relationshipStatePath: written.relationship, rolePackSource: "migrated" });
  await refreshRolePackDocs(agentWorkspace);
  return agentWorkspace;
}

export async function readRolePackForRoute(accountWorkspaceRoot: string, route: string): Promise<RolePack | null> {
  const agentWorkspace = resolveRoleWorkspace(accountWorkspaceRoot, route);
  const paths = rolePackPaths(agentWorkspace);
  const persona = await readJsonIfExists<PersonaCore>(paths.persona);
  if (!persona) return null;
  const [style, examples, qqRules, capabilities, relationship, preferences, meta] = await Promise.all([
    readTextIfExists(paths.style),
    readTextIfExists(paths.examples),
    readTextIfExists(paths.qqRules),
    readTextIfExists(paths.capabilities),
    readJsonIfExists<RelationshipState>(paths.relationship),
    readJsonIfExists<PreferencesState>(paths.preferences),
    readJsonIfExists<RolePackMeta>(paths.meta),
  ]);
  return {
    workspace: agentWorkspace,
    persona,
    style,
    examples,
    qqRules,
    capabilities,
    relationship: relationship || defaultRelationship(),
    preferences: preferences || defaultPreferences(),
    meta: meta || { version: 1, route, agentId: agentIdForRoute(route), templateId: String(persona.templateId || templateForRoute(route)), source: "default", importedFrom: "unknown", updatedAt: nowIso() },
  };
}

export async function upsertRelationshipForRoute(accountWorkspaceRoot: string, route: string, patch: Partial<RelationshipState>): Promise<RelationshipState> {
  await ensureRolePackForRoute(accountWorkspaceRoot, route);
  const agentWorkspace = resolveRoleWorkspace(accountWorkspaceRoot, route);
  const paths = rolePackPaths(agentWorkspace);
  const current = (await readJsonIfExists<RelationshipState>(paths.relationship)) || defaultRelationship();
  const affinity = clamp(Number(patch.affinity ?? current.affinity), 0, 100);
  const trust = clamp(Number(patch.trust ?? current.trust), 0, 100);
  const next: RelationshipState = {
    affinity,
    affinity_stage: patch.affinity_stage || affinityStage(affinity),
    trust,
    initiative_level: patch.initiative_level || current.initiative_level,
    last_reset_at: patch.last_reset_at === undefined ? current.last_reset_at : patch.last_reset_at,
    updated_at: nowIso(),
  };
  await writeJson(paths.relationship, next);
  return next;
}

export async function resetRelationshipForRoute(accountWorkspaceRoot: string, route: string): Promise<RelationshipState> {
  const next = defaultRelationship();
  next.last_reset_at = nowIso();
  return upsertRelationshipForRoute(accountWorkspaceRoot, route, next);
}

export async function applyRoleTemplateForRoute(accountWorkspaceRoot: string, route: string, templateIdRaw: string): Promise<RolePack> {
  const templateId = String(templateIdRaw || "").trim() === "default-assistant" || String(templateIdRaw || "").trim() === "助手型" ? "default-assistant" : "default-companion";
  const agentWorkspace = resolveRoleWorkspace(accountWorkspaceRoot, route);
  const tpl = buildTemplate(templateId);
  const importedAt = nowIso();
  const written = await writeRolePack(agentWorkspace, {
    persona: { ...tpl.persona, source: { kind: "template", label: templateId, importedAt } },
    style: tpl.style,
    examples: tpl.examples,
    relationship: defaultRelationship(),
    preferences: defaultPreferences(),
    meta: { version: 1, route, agentId: agentIdForRoute(route), templateId, source: "default", importedFrom: templateId, updatedAt: importedAt },
  });
  await syncRouteRoleMetadata(accountWorkspaceRoot, route, { rolePackVersion: 1, roleTemplateId: templateId, relationshipStatePath: written.relationship, rolePackSource: "default" });
  await refreshRolePackDocs(agentWorkspace);
  return (await readRolePackForRoute(accountWorkspaceRoot, route)) as RolePack;
}

export async function resetRolePackForRoute(accountWorkspaceRoot: string, route: string, _opts?: { deep?: boolean }): Promise<RolePack> {
  return applyRoleTemplateForRoute(accountWorkspaceRoot, route, templateForRoute(route));
}

export async function importRolePackForRoute(params: { accountWorkspaceRoot: string; route: string; source: string; sourceType?: "text" | "file" }): Promise<RolePack> {
  const { accountWorkspaceRoot, route } = params;
  const seed = await importSeedFromSource({ source: params.source, sourceType: params.sourceType || "text" });
  const importedAt = nowIso();
  const bits = buildImportedPersonaBits(seed);
  const agentWorkspace = resolveRoleWorkspace(accountWorkspaceRoot, route);
  const written = await writeRolePack(agentWorkspace, {
    persona: {
      version: 1,
      templateId: templateForRoute(route),
      name: bits.name,
      identity: bits.identity,
      relationship: bits.relationship,
      tone: bits.tone,
      boundaries: ["不跨 route 串流", "不把内部状态原样发给用户"],
      directives: bits.directives,
      tags: bits.tags,
      source: { kind: params.sourceType || "text", label: bits.sourceLabel, importedAt },
    },
    style: bits.style,
    examples: bits.examples,
    relationship: defaultRelationship(),
    preferences: defaultPreferences(),
    meta: { version: 1, route, agentId: agentIdForRoute(route), templateId: templateForRoute(route), source: "imported", importedFrom: bits.sourceLabel, updatedAt: importedAt },
  });
  await syncRouteRoleMetadata(accountWorkspaceRoot, route, { rolePackVersion: 1, roleTemplateId: templateForRoute(route), relationshipStatePath: written.relationship, rolePackSource: "imported" });
  await refreshRolePackDocs(agentWorkspace);
  return (await readRolePackForRoute(accountWorkspaceRoot, route)) as RolePack;
}

export function renderRolePackSummary(role: RolePack): string {
  return [`[角色] ${role.meta.route}`, `名称: ${role.persona.name || "-"}`, `模板: ${role.meta.templateId || "-"}`, `身份: ${role.persona.identity || "-"}`, `关系: ${role.persona.relationship || "-"}`, `语气: ${(role.persona.tone || []).join("、") || "-"}`, `好感度: ${role.relationship.affinity} (${role.relationship.affinity_stage})`, `信任: ${role.relationship.trust}`, `主动性: ${role.relationship.initiative_level}`, `工作区: ${role.workspace}`, `更新: ${role.meta.updatedAt}`].join("\n");
}
