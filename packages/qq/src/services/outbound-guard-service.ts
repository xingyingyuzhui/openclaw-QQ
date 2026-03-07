import type { DeliveryDropReason } from "../types/reply.js";

const AUTOMATION_SKIP_TOKENS = new Set([
  "[[QQ_AUTO_SKIP]]",
  "__QQ_AUTO_SKIP__",
  "QQ_AUTO_SKIP",
  "[[ANNOUNCE_SKIP]]",
  "ANNOUNCE_SKIP",
  "[[NO_REPLY]]",
  "NO_REPLY",
]);

export function isAbortLeakText(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  return /^(request was aborted|operation was aborted|the operation was aborted|this operation was aborted)$/i.test(t);
}

export function isAbortLeakTextLoose(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  return /^(request was aborted|operation was aborted)$/i.test(t);
}

export function isAutomationSkipText(text: string): boolean {
  const normalized = String(text || "").trim();
  return normalized.length > 0 && AUTOMATION_SKIP_TOKENS.has(normalized);
}

export function isAutomationMetaLeakText(text: string): boolean {
  const normalized = String(text || "").trim();
  if (!normalized) return false;
  if (isAutomationSkipText(normalized)) return true;
  const compact = normalized.replace(/\s+/g, " ");
  if (/QQ_AUTO_SKIP|__QQ_AUTO_SKIP__|ANNOUNCE_SKIP|NO_REPLY/i.test(compact)) return true;
  if (/自动触达.*跳过(执行|了)/.test(compact)) return true;
  if (/跳过状态/.test(compact)) return true;
  if (/被系统判定为[“"]?跳过执行[”"]?/.test(compact)) return true;
  if (/没真正发出去/.test(compact)) return true;
  if (/没有实际发送/.test(compact)) return true;
  if (/没有实际发出消息/.test(compact)) return true;
  if (/未实际发出/.test(compact)) return true;
  if (/这次同样是跳过状态/.test(compact)) return true;
  if (/Subagent .*failed/i.test(compact)) return true;
  if (/Need use [a-z0-9_.-]+/i.test(compact)) return true;
  if (/^\s*I should\b/i.test(compact)) return true;
  if (/^\s*I need to\b/i.test(compact)) return true;
  if (/^\s*Thinking:/i.test(compact)) return true;
  if (/内部思考|推理过程|过程性分析/.test(compact)) return true;
  if (/no new output/i.test(compact)) return true;
  if (/Process still running/i.test(compact)) return true;
  if (/Queued announce messages while agent was busy/i.test(compact)) return true;
  if (/A scheduled reminder has been triggered/i.test(compact)) return true;
  if (/^\s*Cron\s*\((ok|error)\)\s*:/i.test(compact)) return true;
  if (/\[System Message\].*cron job/i.test(compact)) return true;
  if (/No available auth profile for openai-codex/i.test(compact)) return true;
  if (/all in cooldown or unavailable/i.test(compact)) return true;
  if (/Profile .* timed out \(possible rate limit\)/i.test(compact)) return true;
  if (/Embedded agent failed before reply/i.test(compact)) return true;
  if (/Message failed:\s*Unknown target "?\d{5,12}"? for QQ/i.test(compact)) return true;
  if (/Unknown target "?\d{5,12}"? for QQ \(OneBot\)/i.test(compact)) return true;
  return false;
}

export function scrubControlTokensForContext(input: string): string {
  return String(input || "")
    .replace(/\[\[\s*reply_to_current\s*\]\]/gi, "")
    .replace(/\[\[\s*NO_REPLY\s*\]\]/gi, "")
    .replace(/\bNO_REPLY\b/gi, "")
    .replace(/\bANNOUNCE_SKIP\b/gi, "")
    .replace(/\bQQ_AUTO_SKIP\b/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function scrubLiteRouteNoise(input: string): string {
  let out = String(input || "");
  if (!out) return "";
  out = out.replace(/Conversation info \(untrusted metadata\):[\s\S]*?```/gi, "");
  out = out.replace(/Sender \(untrusted metadata\):[\s\S]*?```/gi, "");
  out = out.replace(/Pre-compaction memory flush[\s\S]*?NO_REPLY/gi, "");
  out = out.replace(/Pre-compaction memory flush[\s\S]*$/gi, "");
  out = out.replace(/\[\[\s*reply_to_current\s*\]\]/gi, "");
  out = out.replace(/\bNO_REPLY\b/gi, "");
  out = out.replace(/\bANNOUNCE_SKIP\b/gi, "");
  out = out.replace(/\bQQ_AUTO_SKIP\b/gi, "");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out.trim();
}

export function scrubLiteHistoryContext(input: string): string {
  const cleaned = scrubLiteRouteNoise(input);
  if (!cleaned) return "";
  const lines = cleaned
    .split("\n")
    .map((it) => it.trim())
    .filter((it) => it.length > 0)
    .filter((it) => !/^<(system|history|inbound_media|inbound_media_manifest|voice_message)\b/i.test(it))
    .filter((it) => !/^```/.test(it));
  return lines.join("\n");
}

export function isFallbackEligibleDropReason(reason: DeliveryDropReason): boolean {
  if (reason === "duplicate_text_suppressed") return false;
  if (reason === "abort_text_suppressed") return false;
  if (reason === "automation_meta_leak_guard") return false;
  if (reason === "dispatch_aborted") return false;
  if (reason === "dispatch_id_mismatch") return false;
  if (reason === "policy_blocked") return false;
  if (reason === "quota_exceeded") return false;
  return true;
}
