import { getOwnerRoute, isValidQQRoute } from "./routing.js";
import { defaultRouteUsageStats } from "./session-store.js";

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
}): Promise<boolean> {
  const { text, isGuild, isGroup, isAdmin, userId, groupId, selfId } = args;
  const send = (msg: string) => (isGroup ? args.sendGroup(msg) : args.sendPrivate(msg));

  if (isGuild || !text.trim().startsWith("/")) return false;
  const parts = text.trim().split(/\s+/);
  const cmd = parts[0];
  const ownerRoute = getOwnerRoute();
  const isOwnerPrivate = !!ownerRoute && !isGroup && `user:${userId}` === ownerRoute;

  if (cmd === "/status") {
    const statusMsg = `[OpenClawd QQ]\nState: Connected\nSelf ID: ${selfId ?? "-"}\nMemory: ${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)} MB`;
    send(statusMsg);
    return true;
  }

  if (cmd === "/help" || cmd === "/帮助") {
    const helpMsg = `[OpenClawd QQ]\n/status - 状态\n/权限 查看 <route> - 查看权限与用量\n/权限 开关 <route> <文字|媒体|语音> <开|关>\n/权限 次数 <route> <文字|媒体|语音> <次数|不限>\n/权限 技能 <route> <设置|添加|移除|清空> [skills]\n/权限 清零 <route> - 清零用量\n(兼容英文: /policy ... )\n/mute @用户 [分] - 禁言\n/kick @用户 - 踢出\n/help - 帮助`;
    send(helpMsg);
    return true;
  }

  if (cmd === "/policy" || cmd === "/权限") {
    if (!isAdmin && !isOwnerPrivate) return true;
    const canManagePolicy = isAdmin || (!!ownerRoute && !isGroup && `user:${userId}` === ownerRoute);
    if (!canManagePolicy) {
      send("无权限执行 /policy。");
      return true;
    }
    const subRaw = String(parts[1] || "").trim();
    const sub = ({ "查看": "get", "get": "get", "usage": "usage", "用量": "usage", "开关": "set", "set": "set", "技能": "skills", "skills": "skills", "次数": "limit", "limit": "limit", "清零": "reset-usage", "reset-usage": "reset-usage" } as any)[subRaw] || subRaw;
    const routeNorm = String(parts[2] || "").trim();
    const fieldMap: any = { "sendText": "sendText", "文字": "sendText", "text": "sendText", "sendMedia": "sendMedia", "媒体": "sendMedia", "media": "sendMedia", "sendVoice": "sendVoice", "语音": "sendVoice", "voice": "sendVoice" };

    if ((sub === "get" || sub === "usage") && isValidQQRoute(routeNorm)) {
      const caps = await args.readRouteCapabilityPolicy(routeNorm);
      const usage = await args.readRouteUsageStats(routeNorm);
      send(`[权限] ${routeNorm}\n开关: 文字=${caps.sendText ? "开" : "关"} 媒体=${caps.sendMedia ? "开" : "关"} 语音=${caps.sendVoice ? "开" : "关"}\n次数上限: 文字=${caps.maxSendText ?? "不限"} 媒体=${caps.maxSendMedia ?? "不限"} 语音=${caps.maxSendVoice ?? "不限"}\n技能: ${caps.skills.join(",") || "-"}\n用量: 调度=${usage.dispatchCount} 文字=${usage.sendTextCount} 媒体=${usage.sendMediaCount} 语音=${usage.sendVoiceCount}\n更新时间: ${usage.updatedAt}`);
      return true;
    }

    if (sub === "set" && isValidQQRoute(routeNorm)) {
      const field = fieldMap[String(parts[3] || "").trim()];
      const value = String(parts[4] || "").toLowerCase();
      const on = ["开", "on", "true", "1"].includes(value);
      const off = ["关", "off", "false", "0"].includes(value);
      if (!["sendText", "sendMedia", "sendVoice"].includes(field) || (!on && !off)) {
        send("用法: /权限 开关 <route> <文字|媒体|语音> <开|关>");
        return true;
      }
      const caps = await args.readRouteCapabilityPolicy(routeNorm);
      (caps as any)[field] = on;
      const next = await args.writeRouteCapabilityPolicy(routeNorm, caps);
      send(`[权限] 已更新 ${routeNorm}: 文字=${next.sendText ? "开" : "关"} 媒体=${next.sendMedia ? "开" : "关"} 语音=${next.sendVoice ? "开" : "关"}`);
      return true;
    }

    if (sub === "limit" && isValidQQRoute(routeNorm)) {
      const field = fieldMap[String(parts[3] || "").trim()];
      const valueRaw = String(parts[4] || "").trim();
      if (!["sendText", "sendMedia", "sendVoice"].includes(field) || !valueRaw) {
        send("用法: /权限 次数 <route> <文字|媒体|语音> <次数|不限>");
        return true;
      }
      const caps = await args.readRouteCapabilityPolicy(routeNorm);
      const limitValue = (["不限", "off", "none", "-1"].includes(valueRaw.toLowerCase()) ? null : Math.max(0, Math.floor(Number(valueRaw))));
      if (limitValue !== null && !Number.isFinite(limitValue)) {
        send("次数必须是数字，或用“不限”。");
        return true;
      }
      if (field === "sendText") caps.maxSendText = limitValue;
      if (field === "sendMedia") caps.maxSendMedia = limitValue;
      if (field === "sendVoice") caps.maxSendVoice = limitValue;
      const next = await args.writeRouteCapabilityPolicy(routeNorm, caps);
      send(`[权限] 次数上限已更新 ${routeNorm}: 文字=${next.maxSendText ?? "不限"} 媒体=${next.maxSendMedia ?? "不限"} 语音=${next.maxSendVoice ?? "不限"}`);
      return true;
    }

    if (sub === "skills" && isValidQQRoute(routeNorm)) {
      const opRaw = String(parts[3] || "").toLowerCase();
      const op = ({ "设置": "set", "set": "set", "添加": "add", "add": "add", "移除": "remove", "remove": "remove", "清空": "clear", "clear": "clear" } as any)[opRaw] || opRaw;
      const rawSkills = parts.slice(4).join(" ").trim();
      const skills = rawSkills ? rawSkills.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean) : [];
      const caps = await args.readRouteCapabilityPolicy(routeNorm);
      const curr = new Set((caps.skills || []).map((s: string) => String(s).trim()).filter(Boolean));
      if (op === "set") caps.skills = Array.from(new Set(skills));
      else if (op === "add") { for (const s of skills) curr.add(s); caps.skills = Array.from(curr); }
      else if (op === "remove") { for (const s of skills) curr.delete(s); caps.skills = Array.from(curr); }
      else if (op === "clear") caps.skills = [];
      else { send("用法: /权限 技能 <route> <设置|添加|移除|清空> [skills]"); return true; }
      const next = await args.writeRouteCapabilityPolicy(routeNorm, caps);
      send(`[权限] 技能已更新 ${routeNorm}: ${next.skills.join(",") || "-"}`);
      return true;
    }

    if (sub === "reset-usage" && isValidQQRoute(routeNorm)) {
      await args.writeRouteUsageStats(routeNorm, defaultRouteUsageStats());
      send(`[权限] 用量已清零 ${routeNorm}`);
      return true;
    }

    send(`用法:\n/权限 查看 <route>\n/权限 开关 <route> <文字|媒体|语音> <开|关>\n/权限 次数 <route> <文字|媒体|语音> <次数|不限>\n/权限 技能 <route> <设置|添加|移除|清空> [skills]\n/权限 清零 <route>`);
    return true;
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
