import { type PluginRuntime } from "openclaw/plugin-sdk";
import { buildResidentSessionKey, isValidQQRoute, routeToResidentAgentId } from "../routing.js";
import { repairRouteDeliveryContext } from "./delivery-context-service.js";
import { ensureResidentAgentVisible } from "./resident-agent-service.js";
import {
  applyRoleTemplateForRoute,
  ensureRolePackForRoute,
  ensureRouteRoleMetadata,
  importRolePackForRoute,
  readRolePackForRoute, resolveRoleWorkspace,
  renderRolePackSummary,
  resetRolePackForRoute,
} from "./role-pack-service.js";
import {
  readAffinitySummary,
  readRelationshipSummary,
  resetRouteRelationship,
  setRouteAffinity,
} from "./relationship-state-service.js";

const ROLE_SUBCOMMANDS: Record<string, string> = {
  "查看": "show",
  show: "show",
  "重置": "reset",
  reset: "reset",
  "模板": "template",
  template: "template",
  "导入": "import",
  import: "import",
};

const REL_SUBCOMMANDS: Record<string, string> = {
  "查看": "show",
  show: "show",
  "重置": "reset",
  reset: "reset",
};

const AGENT_SUBCOMMANDS: Record<string, string> = {
  "查看": "show",
  show: "show",
  "修复": "repair",
  repair: "repair",
};

function normalizeSubcommand(raw: string, table: Record<string, string>): string {
  return table[String(raw || "").trim()] || String(raw || "").trim();
}

function normalizeTemplateId(raw: string): string {
  const value = String(raw || "").trim();
  if (["助手型", "assistant", "default-assistant"].includes(value)) return "default-assistant";
  return "default-companion";
}

function parseOptionalRoute(tokens: string[], fallbackRoute: string, allowCrossRoute: boolean): { route: string; rest: string[] } {
  const list = [...tokens];
  if (!allowCrossRoute) {
    return { route: fallbackRoute, rest: list.filter((it) => !isValidQQRoute(it)) };
  }
  if (list[0] && isValidQQRoute(list[0])) {
    return { route: list[0], rest: list.slice(1) };
  }
  const last = list[list.length - 1];
  if (last && isValidQQRoute(last)) {
    return { route: last, rest: list.slice(0, -1) };
  }
  return { route: fallbackRoute, rest: list };
}

async function readRouteAgentSummary(accountWorkspaceRoot: string, route: string): Promise<string> {
  const meta = await ensureRouteRoleMetadata(accountWorkspaceRoot, route, "default");
  const role = await readRolePackForRoute(accountWorkspaceRoot, route);
  const agentId = meta?.agentId || routeToResidentAgentId(route);
  return [
    `[代理] ${route}`,
    `agentId: ${agentId}`,
    `sessionKey: ${buildResidentSessionKey(route)}`,
    `workspace: ${resolveRoleWorkspace(accountWorkspaceRoot, route)}`,
    `角色包: ${role ? "已初始化" : "未初始化"}`,
    `模板: ${role?.meta.templateId || meta?.roleTemplateId || "-"}`,
    `来源: ${role?.meta.source || meta?.rolePackSource || "-"}`,
  ].join("\n");
}

export async function handleRoleCommand(params: {
  parts: string[];
  currentRoute: string;
  accountWorkspaceRoot: string;
  allowCrossRoute: boolean;
  send: (msg: string) => void;
}): Promise<boolean> {
  const { parts, currentRoute, accountWorkspaceRoot, allowCrossRoute, send } = params;
  const sub = normalizeSubcommand(parts[1], ROLE_SUBCOMMANDS);
  const { route, rest } = parseOptionalRoute(parts.slice(2), currentRoute, allowCrossRoute);

  if (sub === "show") {
    await ensureRolePackForRoute(accountWorkspaceRoot, route);
    const role = await readRolePackForRoute(accountWorkspaceRoot, route);
    send(role ? renderRolePackSummary(role) : `[角色] ${route}\n未初始化角色包。`);
    return true;
  }

  if (sub === "reset") {
    const deep = rest.includes("彻底") || rest.includes("deep");
    const role = await resetRolePackForRoute(accountWorkspaceRoot, route, { deep });
    await resetRouteRelationship(accountWorkspaceRoot, route);
    send(`[角色] ${route}\n已重置为 ${role.meta.templateId}${deep ? "（彻底）" : ""}`);
    return true;
  }

  if (sub === "template") {
    const templateRaw = rest[0] || "default-companion";
    const role = await applyRoleTemplateForRoute(accountWorkspaceRoot, route, normalizeTemplateId(templateRaw));
    send(`[角色] ${route}\n已切换模板：${role.meta.templateId}`);
    return true;
  }

  if (sub === "import") {
    const kind = String(rest[0] || "文本").trim().toLowerCase();
    if (kind === "文件" || kind === "file") {
      const filePath = String(rest[1] || "").trim();
      if (!filePath) {
        send("用法: /角色 导入 [route] 文件 <路径>");
        return true;
      }
      const role = await importRolePackForRoute({ accountWorkspaceRoot, route, sourceType: "file", source: filePath });
      send(`[角色] ${route}\n已导入文件角色卡：${role.meta.importedFrom}`);
      return true;
    }
    const text = (kind === "文本" || kind === "text") ? rest.slice(1).join(" ").trim() : rest.join(" ").trim();
    if (!text) {
      send("用法: /角色 导入 [route] 文本 <角色设定>");
      return true;
    }
    const role = await importRolePackForRoute({ accountWorkspaceRoot, route, sourceType: "text", source: text });
    send(`[角色] ${route}\n已导入文本角色设定：${role.persona.name}`);
    return true;
  }

  send("用法:\n/角色 查看 [route]\n/角色 重置 [route] [彻底]\n/角色 模板 [route] <陪伴型|助手型>\n/角色 导入 [route] 文件 <路径>\n/角色 导入 [route] 文本 <角色设定>");
  return true;
}

export async function handleAffinityCommand(params: {
  parts: string[];
  currentRoute: string;
  accountWorkspaceRoot: string;
  allowCrossRoute: boolean;
  send: (msg: string) => void;
}): Promise<boolean> {
  const { parts, currentRoute, accountWorkspaceRoot, allowCrossRoute, send } = params;
  const after = parts.slice(1);
  if (!after.length) {
    send(await readAffinitySummary(accountWorkspaceRoot, currentRoute));
    return true;
  }
  const normalized = String(after[0] || "").trim();
  if (["设置", "set"].includes(normalized)) {
    const { route, rest } = parseOptionalRoute(after.slice(1), currentRoute, allowCrossRoute);
    const value = Number(rest[0]);
    if (!Number.isFinite(value)) {
      send("用法: /好感度 设置 [route] <0-100>");
      return true;
    }
    send(await setRouteAffinity(accountWorkspaceRoot, route, value));
    return true;
  }
  const { route } = parseOptionalRoute(after, currentRoute, allowCrossRoute);
  send(await readAffinitySummary(accountWorkspaceRoot, route));
  return true;
}

export async function handleRelationshipCommand(params: {
  parts: string[];
  currentRoute: string;
  accountWorkspaceRoot: string;
  allowCrossRoute: boolean;
  send: (msg: string) => void;
}): Promise<boolean> {
  const { parts, currentRoute, accountWorkspaceRoot, allowCrossRoute, send } = params;
  const sub = normalizeSubcommand(parts[1], REL_SUBCOMMANDS);
  const { route } = parseOptionalRoute(parts.slice(2), currentRoute, allowCrossRoute);
  if (sub === "reset") {
    send(await resetRouteRelationship(accountWorkspaceRoot, route));
    return true;
  }
  send(await readRelationshipSummary(accountWorkspaceRoot, route));
  return true;
}

export async function handleAgentAdminCommand(params: {
  parts: string[];
  currentRoute: string;
  accountWorkspaceRoot: string;
  accountId: string;
  runtime: PluginRuntime;
  allowCrossRoute: boolean;
  send: (msg: string) => void;
}): Promise<boolean> {
  const { parts, currentRoute, accountWorkspaceRoot, runtime, send, accountId, allowCrossRoute } = params;
  const sub = normalizeSubcommand(parts[1], AGENT_SUBCOMMANDS);
  const { route } = parseOptionalRoute(parts.slice(2), currentRoute, allowCrossRoute);
  if (sub === "repair") {
    await ensureResidentAgentVisible(runtime, accountWorkspaceRoot, routeToResidentAgentId(route));
    const meta = await ensureRouteRoleMetadata(accountWorkspaceRoot, route, accountId);
    await ensureRolePackForRoute(accountWorkspaceRoot, route);
    const deliveryContextFixed = await repairRouteDeliveryContext({
      resolveStorePath: (runtime as any).channel?.session?.resolveStorePath,
      sessionStoreCfg: (runtime as any).config?.value?.session?.store || (runtime as any).cfg?.session?.store,
      route,
      agentId: meta.agentId || routeToResidentAgentId(route),
      accountId: meta.accountId || accountId,
    }).catch(() => false);
    send(`[代理] ${route}\n已完成修复。\ndeliveryContext: ${deliveryContextFixed ? "ok" : "not-found"}`);
    return true;
  }
  send(await readRouteAgentSummary(accountWorkspaceRoot, route));
  return true;
}
