export function shouldSplitSendRequested(text: string): boolean {
  return /(分开发|分开发|逐条发|一条一条|分别发|每条单独发)/.test(String(text || ""));
}

export type InboundRouteContext = {
  route: string;
  conversationLabel: string;
};

export function resolveInboundRouteContext(params: {
  isGroup: boolean;
  isGuild: boolean;
  userId: number;
  groupId?: number;
  guildId?: string;
  channelId?: string;
}): InboundRouteContext {
  const { isGroup, isGuild, userId, groupId, guildId, channelId } = params;
  if (isGroup) {
    return {
      route: `group:${groupId}`,
      conversationLabel: `QQ Group ${groupId}`,
    };
  }
  if (isGuild) {
    return {
      route: `guild:${guildId}:${channelId}`,
      conversationLabel: `QQ Guild ${guildId} Channel ${channelId}`,
    };
  }
  return {
    route: `user:${userId}`,
    conversationLabel: `QQ User ${userId}`,
  };
}

export function looksLikeMediaGenerationIntent(text: string): boolean {
  const t = String(text || "").toLowerCase();
  return /(画|生成图|生图|图片|海报|poster|image|midjourney|flux|stable diffusion|配图|做张图|语音|tts|朗读|配音|音频|audio|voice)/i.test(t);
}

export function looksLikeVoiceIntent(text: string): boolean {
  const t = String(text || "").toLowerCase();
  return /(语音|来条语音|发个语音|tts|朗读|配音|音频|audio|voice|qwen3|音色)/i.test(t);
}

export function buildQQSystemBlock(params: {
  systemPrompt?: string;
  splitSendRequested: boolean;
  historyContext?: string;
  mediaBlocked: boolean;
  voiceBlocked: boolean;
  inboundTextClean: string;
  mediaRemaining: number;
  voiceRemaining: number;
}): {
  systemBlock: string;
  shouldHardBlockMediaIntent: boolean;
  hardBlockMessage?: string;
} {
  const {
    systemPrompt,
    splitSendRequested,
    historyContext,
    mediaBlocked,
    voiceBlocked,
    inboundTextClean,
    mediaRemaining,
    voiceRemaining,
  } = params;

  let systemBlock = "";
  if (systemPrompt) systemBlock += `<system>${systemPrompt}</system>\n\n`;
  systemBlock += `<system>你当前在QQ路由会话内回复。禁止调用message工具发送消息（包括发到user:/group:）。需要发图片/语音/文件时，直接在回复中输出MEDIA: 路径（可多行），由QQ插件发送到当前会话route。</system>\n\n`;
  systemBlock += `<system>QQ语音入站规则（强制）：当收到语音相关消息（如“[语音消息]”或音频文件）时，必须优先使用本地技能 whisper-stt-local 做转写，再基于转写文本直接回应用户意图；不要先问“要不要转写”。仅当音频损坏/不可读时，才提示用户重发。</system>\n\n`;
  systemBlock += `<system>whisper-stt-local 路径：${OPENCLAW_HOME}/workspace/skills/whisper-stt-local/SKILL.md。音频转写脚本：bash ${OPENCLAW_HOME}/workspace/skills/whisper-stt-local/scripts/transcribe.sh "<audio_path>"</system>\n\n`;
  if (splitSendRequested) {
    systemBlock += `<system>用户明确要求“分开发/逐条发”：请用短句分行输出，每行表达一个独立点，不要合并成长段。</system>\n\n`;
  }
  systemBlock += `<system>技能发现提示：除当前工作区外，还应优先检查共享技能目录 ${OPENCLAW_HOME}/workspace/skills（全局可用），不要只在当前 route 工作区里找 skills 目录。</system>\n\n`;
  if (historyContext) systemBlock += `<history>\n${historyContext}\n</history>\n\n`;

  if ((mediaBlocked || voiceBlocked) && looksLikeMediaGenerationIntent(inboundTextClean)) {
    const tips: string[] = [];
    if (mediaBlocked) tips.push(`媒体已禁用或次数用尽（剩余 ${Number.isFinite(mediaRemaining) ? mediaRemaining : "∞"}）`);
    if (voiceBlocked) tips.push(`语音已禁用或次数用尽（剩余 ${Number.isFinite(voiceRemaining) ? voiceRemaining : "∞"}）`);
    return {
      systemBlock,
      shouldHardBlockMediaIntent: true,
      hardBlockMessage: "已触发权限上限，请联系管理员。",
    };
  }

  if (mediaBlocked || voiceBlocked) {
    const blockHints: string[] = [];
    if (mediaBlocked) blockHints.push("禁止调用任何会产出图片/文件的技能，不要输出 MEDIA:");
    if (voiceBlocked) blockHints.push("禁止调用任何会产出语音/TTS 的技能，不要输出 MEDIA:");
    if (blockHints.length) {
      systemBlock += `<system>当前路由发送策略限制：${blockHints.join("；")}。仅做纯文本回复。</system>\n\n`;
    }
  }

  if (!voiceBlocked && looksLikeVoiceIntent(inboundTextClean)) {
    systemBlock += `<system>当用户请求“语音/TTS/配音”时：优先使用 qwen3-tts-local 技能（路径：${OPENCLAW_HOME}/workspace/skills/qwen3-tts-local/SKILL.md）完成合成；禁止优先走通用 tts 工具。仅在 qwen3-tts-local 明确失败时，才允许回退到通用 tts。输出必须为 MEDIA: 音频路径，由QQ插件发送。</system>\n\n`;
  }

  return { systemBlock, shouldHardBlockMediaIntent: false };
}
