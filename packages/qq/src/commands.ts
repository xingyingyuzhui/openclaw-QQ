import { isOwnerPrivateRoute, isValidQQRoute } from "./routing.js";
import { handlePolicyCommand } from "./services/policy-command-service.js";
import {
  handleAffinityCommand,
  handleAgentAdminCommand,
  handleRelationshipCommand,
  handleRoleCommand,
} from "./services/role-command-service.js";
import type { PluginRuntime } from "openclaw/plugin-sdk";

export async function handleQQSlashCommand(args: {
  text: string;
  isGuild: boolean;
  isGroup: boolean;
  isAdmin: boolean;
  userId: number;
  groupId?: number;
  selfId?: number | null;
  sendGroup: (msg: string) => void;
  sendPrivate: (msg: string) => void;
  setGroupBan: (groupId: number, userId: number, durationSec?: number) => void;
  setGroupKick: (groupId: number, userId: number) => void;
  readRouteCapabilityPolicy: (route: string) => Promise<any>;
  readRouteUsageStats: (route: string) => Promise<any>;
  writeRouteCapabilityPolicy: (route: string, caps: any) => Promise<any>;
  writeRouteUsageStats: (route: string, stats: any) => Promise<void>;
  adminsConfigured: boolean;
  currentRoute: string;
  accountWorkspaceRoot: string;
  accountId: string;
  runtime: PluginRuntime;
}): Promise<boolean> {
  const { text, isGuild, isGroup, isAdmin, userId, groupId, selfId, currentRoute, accountWorkspaceRoot, accountId, runtime } = args;
  const send = (msg: string) => (isGroup ? args.sendGroup(msg) : args.sendPrivate(msg));

  if (isGuild || !text.trim().startsWith("/")) return false;
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0];
  const isOwnerPrivate = !isGroup && isOwnerPrivateRoute(`user:${userId}`);

  if (cmd === "/status") {
    const statusMsg = `[OpenClawd QQ]\nState: Connected\nSelf ID: ${selfId ?? "-"}\nMemory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`;
    send(statusMsg);
    return true;
  }

  if (cmd === "/help" || cmd === "/帮助") {
    const helpMsg = `[OpenClawd QQ]\n/status - 状态\n/权限 查看 <route> - 查看权限与用量\n/权限 开关 <route> <文字|媒体|语音> <开|关>\n/权限 次数 <route> <文字|媒体|语音> <次数|不限>\n/权限 技能 <route> <设置|添加|移除|清空> [skills]\n/权限 清零 <route> - 清零用量\n/角色 查看 [route]\n/角色 重置 [route] [彻底]\n/角色 模板 [route] <陪伴型|助手型>\n/角色 导入 [route] 文件 <路径>\n/角色 导入 [route] 文本 <设定>\n/好感度 [route]\n/好感度 设置 [route] <0-100>\n/关系 查看 [route]\n/关系 重置 [route]\n/代理 查看 [route]\n/代理 修复 [route]\n(兼容英文: /policy /role /affinity /agent)\n/mute @用户 [分] - 禁言\n/kick @用户 - 踢出\n/help - 帮助`;
    send(helpMsg);
    return true;
  }

  if (cmd === "/policy" || cmd === "/权限") {
    if (!isAdmin && !isOwnerPrivate) return true;
    const canManagePolicy = isAdmin || (!isGroup && isOwnerPrivateRoute(`user:${userId}`));
    if (!canManagePolicy) {
      send("无权限执行 /policy。");
      return true;
    }
    const routeNorm = String(parts[2] || "").trim();
    return handlePolicyCommand({
      parts,
      routeNorm,
      isValidRoute: isValidQQRoute(routeNorm),
      send,
      store: {
        readRouteCapabilityPolicy: args.readRouteCapabilityPolicy,
        readRouteUsageStats: args.readRouteUsageStats,
        writeRouteCapabilityPolicy: args.writeRouteCapabilityPolicy,
        writeRouteUsageStats: args.writeRouteUsageStats,
      },
    });
  }

  if (cmd === "/role" || cmd === "/角色") {
    if (!isAdmin && !isOwnerPrivate) return true;
    return handleRoleCommand({
      parts,
      currentRoute,
      accountWorkspaceRoot,
      allowCrossRoute: isOwnerPrivate,
      send,
    });
  }

  if (cmd === "/affinity" || cmd === "/好感度") {
    if (!isAdmin && !isOwnerPrivate) return true;
    return handleAffinityCommand({
      parts,
      currentRoute,
      accountWorkspaceRoot,
      allowCrossRoute: isOwnerPrivate,
      send,
    });
  }

  if (cmd === "/关系") {
    if (!isAdmin && !isOwnerPrivate) return true;
    return handleRelationshipCommand({
      parts,
      currentRoute,
      accountWorkspaceRoot,
      allowCrossRoute: isOwnerPrivate,
      send,
    });
  }

  if (cmd === "/agent" || cmd === "/代理") {
    if (!isAdmin && !isOwnerPrivate) return true;
    return handleAgentAdminCommand({
      parts,
      currentRoute,
      accountWorkspaceRoot,
      accountId,
      runtime,
      allowCrossRoute: isOwnerPrivate,
      send,
    });
  }

  if (isGroup && (cmd === "/mute" || cmd === "/ban") && groupId) {
    if (!isAdmin) return true;
    const targetMatch = text.match(/\[CQ:at,qq=(\d+)\]/);
    const targetId = targetMatch ? parseInt(targetMatch[1]) : (parts[1] ? parseInt(parts[1]) : null);
    if (targetId) {
      args.setGroupBan(groupId, targetId, parts[2] ? parseInt(parts[2]) * 60 : 1800);
      args.sendGroup("已禁言。");
    }
    return true;
  }

  if (isGroup && cmd === "/kick" && groupId) {
    if (!isAdmin) return true;
    const targetMatch = text.match(/\[CQ:at,qq=(\d+)\]/);
    const targetId = targetMatch ? parseInt(targetMatch[1]) : (parts[1] ? parseInt(parts[1]) : null);
    if (targetId) {
      args.setGroupKick(groupId, targetId);
      args.sendGroup("已踢出。");
    }
    return true;
  }

  return false;
}
