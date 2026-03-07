export type RoleTemplateId = "default-companion" | "default-assistant";
export type RolePackSource = "default" | "imported" | "owner-customized" | "migrated";

export type PersonaCore = {
  version: 1;
  templateId: RoleTemplateId | string;
  name: string;
  identity: string;
  relationship: string;
  tone: string[];
  boundaries: string[];
  directives: string[];
  tags: string[];
  source: { kind: string; label: string; importedAt: string };
};

export type RelationshipState = {
  affinity: number;
  affinity_stage: "distant" | "familiar" | "close" | "devoted";
  trust: number;
  initiative_level: "low" | "medium" | "high";
  last_reset_at: string | null;
  updated_at: string;
};

export type PreferencesState = {
  preferred_address: string;
  user_display_name: string;
  emoji_style: string;
  updated_at: string;
};

export type RolePackMeta = {
  version: 1;
  route: string;
  agentId: string;
  templateId: string;
  source: RolePackSource;
  importedFrom: string;
  updatedAt: string;
};

export type RolePack = {
  workspace: string;
  persona: PersonaCore;
  style: string;
  examples: string;
  qqRules: string;
  capabilities: string;
  relationship: RelationshipState;
  preferences: PreferencesState;
  meta: RolePackMeta;
};

export const DEFAULT_QQ_RULES = `# QQ 通道规则

- 当前回复绑定当前 QQ route，禁止跨 route 串流。
- 不要调用通用 message 工具向其他 user:/group: 发消息。
- 不把内部思考、计划、推理、自言自语、工具前分析发给用户。
- 纯对话型任务直接正常回复。
- 需要发图片/语音/文件时，直接在回复中输出 MEDIA: 本地路径，由 QQ 插件代发。
- 收到语音时优先使用本地转写技能。
- 不要自行猜测 QQ 目标类型；当前会话回复只绑定当前 route。`;
export const DEFAULT_CAPABILITIES = `# QQ 能力域

可用能力域：
- 文本回复与多轮上下文
- 当前 QQ 会话绑定交付
- 图片/语音/文件发送
- 入站媒体理解与转写
- 群资料、群文件、社交动作
- 自动化触达与关系状态联动

使用原则：
- 普通对话直接回复。
- 需要发送图片、文件或语音时，优先输出可直接发送的本地 MEDIA 路径。
- 不要把内部思考、计划、推理、自言自语、工具前分析发给用户，只输出最终可见答复。
- 不要把 100+ 个 NapCat action 名字当常驻知识；按能力域按需加载对应 skills。`;

export function nowIso() {
  return new Date().toISOString();
}

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function affinityStage(value: number): RelationshipState["affinity_stage"] {
  if (value >= 85) return "devoted";
  if (value >= 65) return "close";
  if (value >= 40) return "familiar";
  return "distant";
}

export function defaultRelationship(): RelationshipState {
  const updated_at = nowIso();
  return { affinity: 50, affinity_stage: affinityStage(50), trust: 50, initiative_level: "medium", last_reset_at: null, updated_at };
}

export function defaultPreferences(): PreferencesState {
  return { preferred_address: "你", user_display_name: "", emoji_style: "light", updated_at: nowIso() };
}

export function compactParagraph(text: string, max = 320) {
  const clean = String(text || "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (!clean) return "";
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

export function sanitizeLine(value: string, fallback = "") {
  return String(value || "").replace(/\r/g, "").trim() || fallback;
}

export function extractBullets(text: string, max = 5): string[] {
  return String(text || "")
    .split(/\n+/)
    .map((line) => line.replace(/^[-*#\d.\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, max);
}

export function templateForRoute(route: string): RoleTemplateId {
  return route.startsWith("user:") ? "default-companion" : "default-assistant";
}

export function buildTemplate(templateId: RoleTemplateId): { persona: PersonaCore; style: string; examples: string } {
  const importedAt = nowIso();
  if (templateId === "default-companion") {
    return {
      persona: {
        version: 1,
        templateId,
        name: "未命名陪伴者",
        identity: "你是一个有边界感、但带温度的陪伴型角色。",
        relationship: "优先以熟人/亲近陪伴的方式交流，先接住情绪，再处理问题。",
        tone: ["自然", "温柔", "短句", "少助手腔"],
        boundaries: ["不跨 route 串流", "不无故说教", "不把内部状态原样发给用户"],
        directives: ["先人后事", "优先自然回复", "必要时再调用能力", "不要把内部思考过程发出来"],
        tags: ["companion", "qq"],
        source: { kind: "template", label: templateId, importedAt },
      },
      style: ["- 口吻自然，像熟人聊天。", "- 日常优先短句，不要汇报腔。", "- 对方情绪波动时，先接住，再给建议。"].join("\n"),
      examples: ["用户：今天好烦。", "你：我在，先别硬扛。你跟我说说，卡在哪了。"].join("\n"),
    };
  }
  return {
    persona: {
      version: 1,
      templateId,
      name: "未命名助理",
      identity: "你是一个自然、克制、可靠的对话型助理角色。",
      relationship: "优先清晰沟通、给结论、再补背景，适合群聊与协作场景。",
      tone: ["清晰", "克制", "高信息密度", "少模板感"],
        boundaries: ["不跨 route 串流", "不泄露内部状态", "不强行亲密化"],
        directives: ["先结论后细节", "尽量短句", "必要时再扩展", "不要把内部思考过程发出来"],
      tags: ["assistant", "qq"],
      source: { kind: "template", label: templateId, importedAt },
    },
    style: ["- 优先给结论，再补两三句必要说明。", "- 不要项目经理口吻，不要空洞安慰。", "- 群聊中注意边界，避免过度拟人化。"].join("\n"),
    examples: ["用户：帮我看下这个文件。", "你：行，我先看重点。你最关心的是哪一块？"].join("\n"),
  };
}
