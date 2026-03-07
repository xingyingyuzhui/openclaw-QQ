type PolicyStore = {
  readRouteCapabilityPolicy: (route: string) => Promise<any>;
  readRouteUsageStats: (route: string) => Promise<any>;
  writeRouteCapabilityPolicy: (route: string, caps: any) => Promise<any>;
  writeRouteUsageStats: (route: string, stats: any) => Promise<void>;
};

function defaultRouteUsageStats() {
  return {
    dispatchCount: 0,
    sendTextCount: 0,
    sendMediaCount: 0,
    sendVoiceCount: 0,
    updatedAt: new Date().toISOString(),
  };
}

const POLICY_SUBCOMMANDS: Record<string, string> = {
  "查看": "get",
  "get": "get",
  "usage": "usage",
  "用量": "usage",
  "开关": "set",
  "set": "set",
  "技能": "skills",
  "skills": "skills",
  "次数": "limit",
  "limit": "limit",
  "清零": "reset-usage",
  "reset-usage": "reset-usage",
};

const POLICY_FIELD_MAP: Record<string, "sendText" | "sendMedia" | "sendVoice"> = {
  "sendText": "sendText",
  "文字": "sendText",
  "text": "sendText",
  "sendMedia": "sendMedia",
  "媒体": "sendMedia",
  "media": "sendMedia",
  "sendVoice": "sendVoice",
  "语音": "sendVoice",
  "voice": "sendVoice",
};

function parsePolicySubcommand(raw: string): string {
  return POLICY_SUBCOMMANDS[String(raw || "").trim()] || String(raw || "").trim();
}

function parsePolicyField(raw: string): "sendText" | "sendMedia" | "sendVoice" | undefined {
  return POLICY_FIELD_MAP[String(raw || "").trim()];
}

function parseLimitValue(raw: string): number | null | undefined {
  const valueRaw = String(raw || "").trim();
  if (!valueRaw) return undefined;
  if (["不限", "off", "none", "-1"].includes(valueRaw.toLowerCase())) return null;
  const numeric = Math.max(0, Math.floor(Number(valueRaw)));
  if (!Number.isFinite(numeric)) return undefined;
  return numeric;
}

function renderPolicySummary(route: string, caps: any, usage: any): string {
  return `[权限] ${route}\n开关: 文字=${caps.sendText ? "开" : "关"} 媒体=${caps.sendMedia ? "开" : "关"} 语音=${caps.sendVoice ? "开" : "关"}\n次数上限: 文字=${caps.maxSendText ?? "不限"} 媒体=${caps.maxSendMedia ?? "不限"} 语音=${caps.maxSendVoice ?? "不限"}\n技能: ${caps.skills.join(",") || "-"}\n用量: 调度=${usage.dispatchCount} 文字=${usage.sendTextCount} 媒体=${usage.sendMediaCount} 语音=${usage.sendVoiceCount}\n更新时间: ${usage.updatedAt}`;
}

export async function handlePolicyCommand(params: {
  parts: string[];
  routeNorm: string;
  isValidRoute: boolean;
  send: (msg: string) => void;
  store: PolicyStore;
}): Promise<boolean> {
  const { parts, routeNorm, isValidRoute, send, store } = params;
  const sub = parsePolicySubcommand(parts[1] || "");

  if ((sub === "get" || sub === "usage") && isValidRoute) {
    const caps = await store.readRouteCapabilityPolicy(routeNorm);
    const usage = await store.readRouteUsageStats(routeNorm);
    send(renderPolicySummary(routeNorm, caps, usage));
    return true;
  }

  if (sub === "set" && isValidRoute) {
    const field = parsePolicyField(parts[3] || "");
    const value = String(parts[4] || "").toLowerCase();
    const on = ["开", "on", "true", "1"].includes(value);
    const off = ["关", "off", "false", "0"].includes(value);
    if (!field || (!on && !off)) {
      send("用法: /权限 开关 <route> <文字|媒体|语音> <开|关>");
      return true;
    }
    const caps = await store.readRouteCapabilityPolicy(routeNorm);
    caps[field] = on;
    const next = await store.writeRouteCapabilityPolicy(routeNorm, caps);
    send(`[权限] 已更新 ${routeNorm}: 文字=${next.sendText ? "开" : "关"} 媒体=${next.sendMedia ? "开" : "关"} 语音=${next.sendVoice ? "开" : "关"}`);
    return true;
  }

  if (sub === "limit" && isValidRoute) {
    const field = parsePolicyField(parts[3] || "");
    const limitValue = parseLimitValue(parts[4] || "");
    if (!field || typeof limitValue === "undefined") {
      send("用法: /权限 次数 <route> <文字|媒体|语音> <次数|不限>");
      return true;
    }
    const caps = await store.readRouteCapabilityPolicy(routeNorm);
    if (field === "sendText") caps.maxSendText = limitValue;
    if (field === "sendMedia") caps.maxSendMedia = limitValue;
    if (field === "sendVoice") caps.maxSendVoice = limitValue;
    const next = await store.writeRouteCapabilityPolicy(routeNorm, caps);
    send(`[权限] 次数上限已更新 ${routeNorm}: 文字=${next.maxSendText ?? "不限"} 媒体=${next.maxSendMedia ?? "不限"} 语音=${next.maxSendVoice ?? "不限"}`);
    return true;
  }

  if (sub === "skills" && isValidRoute) {
    const opRaw = String(parts[3] || "").toLowerCase();
    const op = ({ "设置": "set", "set": "set", "添加": "add", "add": "add", "移除": "remove", "remove": "remove", "清空": "clear", "clear": "clear" } as any)[opRaw] || opRaw;
    const rawSkills = parts.slice(4).join(" ").trim();
    const skills = rawSkills ? rawSkills.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean) : [];
    const caps = await store.readRouteCapabilityPolicy(routeNorm);
    const curr = new Set((caps.skills || []).map((s: string) => String(s).trim()).filter(Boolean));
    if (op === "set") caps.skills = Array.from(new Set(skills));
    else if (op === "add") {
      for (const s of skills) curr.add(s);
      caps.skills = Array.from(curr);
    } else if (op === "remove") {
      for (const s of skills) curr.delete(s);
      caps.skills = Array.from(curr);
    } else if (op === "clear") {
      caps.skills = [];
    } else {
      send("用法: /权限 技能 <route> <设置|添加|移除|清空> [skills]");
      return true;
    }
    const next = await store.writeRouteCapabilityPolicy(routeNorm, caps);
    send(`[权限] 技能已更新 ${routeNorm}: ${next.skills.join(",") || "-"}`);
    return true;
  }

  if (sub === "reset-usage" && isValidRoute) {
    await store.writeRouteUsageStats(routeNorm, defaultRouteUsageStats());
    send(`[权限] 用量已清零 ${routeNorm}`);
    return true;
  }

  send(`用法:\n/权限 查看 <route>\n/权限 开关 <route> <文字|媒体|语音> <开|关>\n/权限 次数 <route> <文字|媒体|语音> <次数|不限>\n/权限 技能 <route> <设置|添加|移除|清空> [skills]\n/权限 清零 <route>`);
  return true;
}
