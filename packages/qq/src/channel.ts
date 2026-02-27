import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  type ChannelPlugin,
  type ChannelAccountSnapshot,
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
  type ReplyPayload,
  applyAccountNameToChannelSection,
  migrateBaseNameToDefaultAccount,
} from "openclaw/plugin-sdk";
import { OneBotClient } from "./client.js";
import { QQConfigSchema, type QQConfig } from "./config.js";
import { handleQQSlashCommand } from "./commands.js";
import { createDeliveryManager } from "./delivery.js";
import { withTimeout } from "./utils/timeouts.js";
import { enqueueRouteTask } from "./task-units.js";
import { normalizeReplyPayload } from "./outbound/media-payload-normalizer.js";
import { sendTextChunks, buildTextMessage } from "./outbound/text-sender.js";
import { sendMediaItems } from "./outbound/media-sender.js";
import { logSendAttempt, sendToParsedTarget, summarizeText } from "./outbound/send-target.js";
import { configureQQLogger, logDeliveryAttemptTrace, logQQTrace, resetQQLoggerAccount, sanitizeOutboundText } from "./diagnostics/logger.js";
import { checkConversationPolicyHook } from "./policy/capability-guard.js";
import { checkRouteUsageQuota, getRouteSendBudget } from "./policy/quota-guard.js";
import { cleanCQCodes, getReplyMessageId } from "./inbound/message-normalizer.js";
import {
  buildQQSystemBlock,
  resolveInboundRouteContext,
  shouldSplitSendRequested,
} from "./inbound/session-pipeline.js";
import {
  finalizeRouteAggregation,
  getRouteAggregationSeq,
  isRouteGenerationCurrent,
  nextRouteGeneration,
  pushRouteAggregation,
} from "./inbound/aggregation.js";
import { messageMentionsSelf } from "./inbound-utils.js";
import { parseInboundMessage } from "./inbound/message-handler.js";
import {
  buildGroupHistoryContext,
  isTriggeredByMentionOrKeyword,
  passesRequireMention,
} from "./inbound/message-handler.js";
import {
  appendConversationLog as appendConversationLogCore,
  beginRouteInFlight,
  claimRoutePendingLatest,
  clearRouteInFlight,
  clearRoutePendingLatest,
  conversationBaseDir as conversationBaseDirCore,
  getRoutePendingLatest,
  getRouteInFlight,
  hasRouteInFlight,
  markRouteDispatchTimeout,
  routeHadRecentTimeout,
  upsertRoutePendingLatest,
} from "./core/runtime-context.js";
import {
  buildResidentSessionKey,
  configureOwnerQq,
  normalizeTarget,
  parseTarget,
  resolveOutboundTarget,
  routeToResidentAgentId,
} from "./routing.js";
import {
  bumpRouteUsage,
  consumeImageQuota,
  ensureRouteAgentMetadata,
  migrateLegacySessionIfNeeded,
  readProactiveState,
  readRouteCapabilityPolicy,
  readRouteUsageStats,
  writeProactiveState,
  writeRouteCapabilityPolicy,
  writeRouteUsageStats,
  updateConversationStateOnInbound,
} from "./session-store.js";
import { getQQRuntime } from "./runtime.js";
import { ensureMediaRelayStarted } from "./media-relay.js";
import type { OneBotMessage } from "./types.js";
import type { QQReplyPayload } from "./types/reply.js";
import type { DeliveryDropReason } from "./types/reply.js";

export type ResolvedQQAccount = ChannelAccountSnapshot & {
  config: QQConfig;
  client?: OneBotClient;
};

const memberCache = new Map<string, { name: string; time: number }>();
const ensuredAgentVisible = new Set<string>();
const ensureAgentVisibleAttemptAt = new Map<string, number>();
const ENSURE_AGENT_VISIBLE_RETRY_MS = 60_000;

function getCachedMemberName(groupId: string, userId: string): string | null {
    const key = `${groupId}:${userId}`;
    const cached = memberCache.get(key);
    if (cached && Date.now() - cached.time < 3600000) { // 1 hour cache
        return cached.name;
    }
    return null;
}

function setCachedMemberName(groupId: string, userId: string, name: string) {
    memberCache.set(`${groupId}:${userId}`, { name, time: Date.now() });
}

function resolveStateRootFromWorkspace(workspaceRoot: string): string {
  return path.resolve(path.dirname(workspaceRoot));
}

function resolveWorkspaceForAgent(workspaceRoot: string, agentId: string): string {
  if (agentId === "main") return workspaceRoot;
  const stateRoot = resolveStateRootFromWorkspace(workspaceRoot);
  return path.join(stateRoot, `workspace-${agentId}`);
}

function resolveAgentDirForAgent(workspaceRoot: string, agentId: string): string {
  const stateRoot = resolveStateRootFromWorkspace(workspaceRoot);
  return path.join(stateRoot, "agents", agentId, "agent");
}

async function ensureResidentAgentVisible(
  runtime: ReturnType<typeof getQQRuntime>,
  workspaceRoot: string,
  agentIdRaw: string,
): Promise<void> {
  const agentId = String(agentIdRaw || "").trim().toLowerCase();
  if (!agentId || agentId === "main") return;
  if (ensuredAgentVisible.has(agentId)) return;

  const now = Date.now();
  const lastAttempt = ensureAgentVisibleAttemptAt.get(agentId) || 0;
  if (now - lastAttempt < ENSURE_AGENT_VISIBLE_RETRY_MS) return;
  ensureAgentVisibleAttemptAt.set(agentId, now);

  try {
    const listRes = await runtime.system.runCommandWithTimeout(["openclaw", "agents", "list", "--json"], {
      timeoutMs: 20_000,
    });
    if (listRes.code === 0) {
      const rows = JSON.parse(String(listRes.stdout || "[]"));
      if (Array.isArray(rows) && rows.some((r) => String((r as any)?.id || "").toLowerCase() === agentId)) {
        ensuredAgentVisible.add(agentId);
        return;
      }
    }

    const workspace = resolveWorkspaceForAgent(workspaceRoot, agentId);
    const agentDir = resolveAgentDirForAgent(workspaceRoot, agentId);
    const addRes = await runtime.system.runCommandWithTimeout(
      [
        "openclaw",
        "agents",
        "add",
        agentId,
        "--workspace",
        workspace,
        "--agent-dir",
        agentDir,
        "--non-interactive",
        "--json",
      ],
      { timeoutMs: 45_000 },
    );
    if (addRes.code !== 0 && !/already exists/i.test(String(addRes.stderr || ""))) {
      throw new Error(String(addRes.stderr || addRes.stdout || `exit_code=${addRes.code}`));
    }
    ensuredAgentVisible.add(agentId);
    console.log(`[QQ][agent-visible] ensured agent_id=${agentId} workspace=${workspace}`);
  } catch (err: any) {
    console.warn(`[QQ][agent-visible] ensure failed agent_id=${agentId} error=${err?.message || err}`);
  }
}

async function readRoutePersonaPrompt(workspaceRoot: string, route: string): Promise<string> {
  try {
    const p = `${workspaceRoot}/qq_sessions/${route}/agent.json`;
    const raw = await fs.readFile(p, "utf8");
    const parsed = JSON.parse(raw || "{}");
    const prompt = String(parsed?.personaPrompt || "").trim();
    return prompt;
  } catch {
    return "";
  }
}

type RouteRecentMediaState = { urls: string[]; updatedAt: number; lastMsgId?: string };
type RouteMediaManifest = {
  msgId: string;
  route: string;
  mediaUrls: string[];
  localUrls: string[];
  updatedAt: number;
};
const routeRecentMedia = new Map<string, RouteRecentMediaState>();
const routeMediaManifestByMsg = new Map<string, RouteMediaManifest>();
const routeLatestManifestKey = new Map<string, string>();
const routeFileTaskLockUntil = new Map<string, number>();
const routeInboundSeq = new Map<string, number>();
const routeLastFallbackAt = new Map<string, number>();

function nextRouteInboundSeq(route: string): number {
  const v = (routeInboundSeq.get(route) || 0) + 1;
  routeInboundSeq.set(route, v);
  return v;
}

function getRouteInboundSeq(route: string): number {
  return routeInboundSeq.get(route) || 0;
}

function lockRouteFileTask(route: string, ttlMs = 60_000) {
  routeFileTaskLockUntil.set(route, Date.now() + Math.max(1000, ttlMs));
}

function isRouteFileTaskLocked(route: string): boolean {
  const until = routeFileTaskLockUntil.get(route) || 0;
  if (!until) return false;
  if (Date.now() > until) {
    routeFileTaskLockUntil.delete(route);
    return false;
  }
  return true;
}

function makeManifestKey(route: string, msgId: string) {
  return `${route}|${msgId}`;
}

function rememberRouteMediaManifest(route: string, msgId: string, mediaUrls: string[], localUrls: string[]) {
  const key = makeManifestKey(route, msgId);
  const manifest: RouteMediaManifest = {
    msgId,
    route,
    mediaUrls: Array.from(new Set((mediaUrls || []).map((u) => String(u || "").trim()).filter(Boolean))),
    localUrls: Array.from(new Set((localUrls || []).map((u) => String(u || "").trim()).filter(Boolean))),
    updatedAt: Date.now(),
  };
  routeMediaManifestByMsg.set(key, manifest);
  routeLatestManifestKey.set(route, key);
}

function getRouteMediaManifest(route: string, msgId: string, ttlMs = 10 * 60 * 1000): RouteMediaManifest | null {
  const key = makeManifestKey(route, msgId);
  const found = routeMediaManifestByMsg.get(key);
  if (!found) return null;
  if (Date.now() - found.updatedAt > Math.max(1000, ttlMs)) {
    routeMediaManifestByMsg.delete(key);
    return null;
  }
  return found;
}

function getRouteLatestMediaManifest(route: string, ttlMs = 10 * 60 * 1000): RouteMediaManifest | null {
  const key = routeLatestManifestKey.get(route);
  if (!key) return null;
  const found = routeMediaManifestByMsg.get(key);
  if (!found) return null;
  if (Date.now() - found.updatedAt > Math.max(1000, ttlMs)) {
    routeMediaManifestByMsg.delete(key);
    routeLatestManifestKey.delete(route);
    return null;
  }
  return found;
}

function rememberRouteRecentMedia(route: string, urls: string[], msgId?: string) {
  const dedup = Array.from(new Set((urls || []).map((u) => String(u || "").trim()).filter(Boolean)));
  if (dedup.length === 0) return;
  routeRecentMedia.set(route, {
    urls: dedup,
    updatedAt: Date.now(),
    lastMsgId: msgId ? String(msgId) : undefined,
  });
}

function getRouteRecentMedia(route: string, ttlMs = 10 * 60 * 1000, maxItems = 6): string[] {
  const state = routeRecentMedia.get(route);
  if (!state) return [];
  if (Date.now() - state.updatedAt > Math.max(1000, ttlMs)) {
    routeRecentMedia.delete(route);
    return [];
  }
  return state.urls.slice(0, Math.max(1, maxItems));
}

// Keep persona/behavior at agent base layer; avoid heavy QQ-specific prompt stuffing here.

const clients = new Map<string, OneBotClient>();
const cleanupIntervals = new Map<string, NodeJS.Timeout>();
const routeLastInboundAt = new Map<string, number>();
const routeLastProactiveAt = new Map<string, number>();
const proactiveStateHydrated = new Set<string>();
const routeRecentOutboundText = new Map<string, { text: string; at: number }>();

function routeStateKey(accountId: string, route: string): string {
  return `${accountId}|${route}`;
}

function getRouteLastInboundAt(accountId: string, route: string): number {
  return routeLastInboundAt.get(routeStateKey(accountId, route)) || 0;
}

function getRouteLastProactiveAt(accountId: string, route: string): number {
  return routeLastProactiveAt.get(routeStateKey(accountId, route)) || 0;
}

function setRouteLastInboundAt(accountId: string, route: string, ts: number): void {
  routeLastInboundAt.set(routeStateKey(accountId, route), ts);
}

function setRouteLastProactiveAt(accountId: string, route: string, ts: number): void {
  routeLastProactiveAt.set(routeStateKey(accountId, route), ts);
}

function shouldLogProactiveSkip(verbose: boolean, reason: string): boolean {
  if (verbose) return true;
  return reason === "tick_busy" || reason === "invalid_route" || reason === "policy_blocked" || reason === "quota_exceeded";
}

async function hydrateProactiveStateOnce(accountId: string, route: string, verbose: boolean): Promise<void> {
  const key = routeStateKey(accountId, route);
  if (proactiveStateHydrated.has(key)) return;
  proactiveStateHydrated.add(key);
  try {
    const state = await readProactiveState(resolveAccountWorkspaceRoot(accountId), route);
    if (state) {
      setRouteLastInboundAt(accountId, route, Number(state.lastInboundAt || 0));
      setRouteLastProactiveAt(accountId, route, Number(state.lastProactiveAt || 0));
      if (verbose) {
        console.log(
          `[QQ][qq_proactive_state] account_id=${accountId} route=${route} action=load result=success last_inbound_at=${Number(state.lastInboundAt || 0)} last_proactive_at=${Number(state.lastProactiveAt || 0)}`,
        );
      }
    } else if (verbose) {
      console.log(`[QQ][qq_proactive_state] account_id=${accountId} route=${route} action=load result=empty`);
    }
  } catch (err: any) {
    console.warn(`[QQ][qq_proactive_state] account_id=${accountId} route=${route} action=load result=failed error=${err?.message || err}`);
  }
}

async function persistProactiveState(accountId: string, route: string, verbose: boolean): Promise<void> {
  const state = {
    lastInboundAt: getRouteLastInboundAt(accountId, route),
    lastProactiveAt: getRouteLastProactiveAt(accountId, route),
    updatedAt: new Date().toISOString(),
  };
  try {
    await writeProactiveState(resolveAccountWorkspaceRoot(accountId), route, state);
    if (verbose) {
      console.log(
        `[QQ][qq_proactive_state] account_id=${accountId} route=${route} action=save result=success last_inbound_at=${state.lastInboundAt} last_proactive_at=${state.lastProactiveAt}`,
      );
    }
  } catch (err: any) {
    console.warn(`[QQ][qq_proactive_state] account_id=${accountId} route=${route} action=save result=failed error=${err?.message || err}`);
  }
}

function getClientForAccount(accountId: string) {
    return clients.get(accountId);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const execFileAsync = promisify(execFile);

type VoiceTranscript = {
  text: string;
  durationSec?: number;
  language?: string;
  audioPath?: string;
};

function tryParseJsonObject(raw: string): any | null {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}
  const begin = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (begin >= 0 && end > begin) {
    const sliced = text.slice(begin, end + 1);
    try {
      return JSON.parse(sliced);
    } catch {}
  }
  return null;
}

function isLikelyVoiceFileUrl(url: string): boolean {
  const s = String(url || "").toLowerCase();
  return (
    s.startsWith("file://") &&
    (s.includes(".amr") || s.includes(".wav") || s.includes(".mp3") || s.includes(".m4a") || s.includes(".ogg") || s.includes(".silk"))
  );
}

async function transcribeInboundVoiceOnce(params: {
  workspaceRoot: string;
  localFileUrls: string[];
  route: string;
  msgId: string;
}): Promise<VoiceTranscript | null> {
  const { workspaceRoot, localFileUrls, route, msgId } = params;
  const scriptPath = `${workspaceRoot}/skills/whisper-stt-local/scripts/transcribe.sh`;
  try {
    await fs.access(scriptPath);
  } catch {
    return null;
  }
  const voiceUrl = localFileUrls.find((u) => isLikelyVoiceFileUrl(u));
  if (!voiceUrl) return null;
  let audioPath = "";
  try {
    audioPath = decodeURIComponent(new URL(voiceUrl).pathname);
  } catch {
    return null;
  }
  if (!audioPath) return null;
  const startedAt = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync(
      "bash",
      [scriptPath, audioPath, "zh", "small", "int8"],
      { cwd: workspaceRoot, timeout: 30_000, maxBuffer: 1024 * 1024 * 8 },
    );
    const parsed = tryParseJsonObject(stdout) || tryParseJsonObject(stderr) || {};
    const transcriptText = String(parsed?.text || "").trim();
    const durationSec = Number(parsed?.duration || 0) || undefined;
    const language = String(parsed?.language || "").trim() || undefined;
    const elapsedMs = Date.now() - startedAt;
    if (!transcriptText) {
      console.warn(
        `[QQ][voice-transcribe] route=${route} msg_id=${msgId} result=empty duration_ms=${elapsedMs}`,
      );
      return null;
    }
    console.log(
      `[QQ][voice-transcribe] route=${route} msg_id=${msgId} result=ok duration_ms=${elapsedMs} audio_seconds=${durationSec ?? 0}`,
    );
    return {
      text: transcriptText,
      durationSec,
      language,
      audioPath,
    };
  } catch (err: any) {
    const elapsedMs = Date.now() - startedAt;
    console.warn(
      `[QQ][voice-transcribe] route=${route} msg_id=${msgId} result=failed duration_ms=${elapsedMs} error=${err?.message || err}`,
    );
    return null;
  }
}

function isAbortLeakText(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  return /^(request was aborted|operation was aborted|the operation was aborted|this operation was aborted)$/i.test(t);
}

function isAbortLeakTextLoose(text: string): boolean {
  const t = String(text || "").trim();
  if (!t) return false;
  return /^(request was aborted|operation was aborted)$/i.test(t);
}

class DispatchDropError extends Error {
  reason: DeliveryDropReason;

  constructor(reason: DeliveryDropReason) {
    super(reason);
    this.reason = reason;
    this.name = "DispatchDropError";
  }
}

function assertDispatchCanSend(
  route: string,
  msgIdText: string,
  dispatchId: string,
  opts?: { allowMissingInFlight?: boolean },
): void {
  const inflight = getRouteInFlight(route);
  if (!inflight) {
    if (opts?.allowMissingInFlight) return;
    throw new DispatchDropError("dispatch_id_mismatch");
  }
  if (inflight.dispatchId !== dispatchId) {
    throw new DispatchDropError("dispatch_id_mismatch");
  }
  if (inflight.abortController.signal.aborted) {
    throw new DispatchDropError("dispatch_aborted");
  }
}

function normalizeOutboundDedupText(text: string): string {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function shouldSuppressDuplicateOutboundText(route: string, chunk: string, dedupWindowMs: number): boolean {
  const normalized = normalizeOutboundDedupText(chunk);
  if (!normalized) return false;
  const now = Date.now();
  const prev = routeRecentOutboundText.get(route);
  if (!prev) return false;
  if (now - prev.at > Math.max(500, dedupWindowMs)) return false;
  return prev.text === normalized;
}

function rememberRouteOutboundText(route: string, chunk: string): void {
  const normalized = normalizeOutboundDedupText(chunk);
  if (!normalized) return;
  routeRecentOutboundText.set(route, { text: normalized, at: Date.now() });
}

function stopCleanupInterval(accountId: string) {
  const timer = cleanupIntervals.get(accountId);
  if (!timer) return;
  try {
    clearInterval(timer);
  } catch {}
  cleanupIntervals.delete(accountId);
}

function cleanupAccountRuntime(accountId: string, clientHint?: OneBotClient) {
  stopCleanupInterval(accountId);
  const prefix = `${accountId}|`;
  for (const key of Array.from(routeLastInboundAt.keys())) {
    if (key.startsWith(prefix)) routeLastInboundAt.delete(key);
  }
  for (const key of Array.from(routeLastProactiveAt.keys())) {
    if (key.startsWith(prefix)) routeLastProactiveAt.delete(key);
  }
  for (const key of Array.from(proactiveStateHydrated.values())) {
    if (key.startsWith(prefix)) proactiveStateHydrated.delete(key);
  }
  const client = clients.get(accountId) || clientHint;
  if (client) {
    try { client.disconnect(); } catch {}
  }
  clients.delete(accountId);
  accountWorkspaceRoots.delete(accountId);
  resetQQLoggerAccount(accountId);
}


async function ensureClientReadyForSend(accountId: string, config: QQConfig): Promise<void> {
  const client = getClientForAccount(accountId);
  if (!client) throw new Error(`QQ client not found for account=${accountId}`);
  if (client.isConnected()) return;
  const waitMs = Math.max(100, Number(config.sendWaitForReconnectMs ?? 5000));
  const ok = await client.waitUntilConnected(waitMs);
  if (!ok) throw new Error("WebSocket not open");
}

const deliveryManager = createDeliveryManager({
  ensureReady: ensureClientReadyForSend,
  onAttemptLog: logSendAttempt,
});
const proactiveNudges = [
  "忙完了没？我在。要不要我顺手帮你把下一步也做了。",
  "路过提醒：别一直硬扛，喝口水再继续，我陪你。",
  "今天状态还行吗？要是累了，我给你走个省脑模式。",
] as const;
const AUTOMATION_SKIP_TOKENS = new Set([
  "[[QQ_AUTO_SKIP]]",
  "__QQ_AUTO_SKIP__",
  "QQ_AUTO_SKIP",
  "[[ANNOUNCE_SKIP]]",
  "ANNOUNCE_SKIP",
  "[[NO_REPLY]]",
  "NO_REPLY",
]);

function isAutomationSkipText(text: string): boolean {
  const normalized = String(text || "").trim();
  return normalized.length > 0 && AUTOMATION_SKIP_TOKENS.has(normalized);
}

function isAutomationMetaLeakText(text: string): boolean {
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
  if (/Message failed:\s*Unknown target \"?\d{5,12}\"? for QQ/i.test(compact)) return true;
  if (/Unknown target \"?\d{5,12}\"? for QQ \(OneBot\)/i.test(compact)) return true;
  return false;
}

function isFallbackEligibleDropReason(reason: DeliveryDropReason): boolean {
  if (reason === "duplicate_text_suppressed") return false;
  if (reason === "abort_text_suppressed") return false;
  if (reason === "automation_meta_leak_guard") return false;
  if (reason === "dispatch_aborted") return false;
  if (reason === "dispatch_id_mismatch") return false;
  if (reason === "policy_blocked") return false;
  if (reason === "quota_exceeded") return false;
  return true;
}

const FALLBACK_WORKSPACE = path.join(process.env.HOME || "", ".openclaw", "workspace");
const accountWorkspaceRoots = new Map<string, string>();
const DEFAULT_SEND_CFG = {
  sendQueueMaxRetries: 3,
  sendQueueBaseDelayMs: 1000,
  sendQueueJitterMs: 400,
  sendRetryMinDelayMs: 500,
  sendRetryMaxDelayMs: 8000,
  sendRetryJitterRatio: 0.15,
  sendWaitForReconnectMs: 5000,
  rateLimitMs: 1000,
} as QQConfig;

function resolveWorkspaceRootFromConfig(cfg: any): string {
  const fromCfg = cfg?.agents?.defaults?.workspace;
  if (typeof fromCfg === "string" && fromCfg.trim()) return fromCfg.trim();
  return process.env.OPENCLAW_WORKSPACE || FALLBACK_WORKSPACE;
}

function bindAccountWorkspaceRoot(accountId: string, cfg: any): string {
  const root = resolveWorkspaceRootFromConfig(cfg);
  accountWorkspaceRoots.set(accountId || DEFAULT_ACCOUNT_ID, root);
  return root;
}

function resolveAccountWorkspaceRoot(accountId?: string): string {
  const key = String(accountId || DEFAULT_ACCOUNT_ID).trim() || DEFAULT_ACCOUNT_ID;
  return accountWorkspaceRoots.get(key) || process.env.OPENCLAW_WORKSPACE || FALLBACK_WORKSPACE;
}

function conversationBaseDir(accountId: string, route: string) {
  return conversationBaseDirCore(resolveAccountWorkspaceRoot(accountId), route);
}

async function appendConversationLog(route: string, accountId: string, direction: "in" | "out", data: {
  messageId?: string | number | null;
  text?: string;
  mediaCount?: number;
  filePath?: string;
  mediaItemsTotal?: number;
  mediaItemsMaterialized?: number;
  mediaItemsUnresolved?: number;
  unresolvedReasons?: string[];
}) {
  await appendConversationLogCore({
    workspaceRoot: resolveAccountWorkspaceRoot(accountId),
    route,
    accountId,
    direction,
    data,
    summarizeText,
  });
}


export const qqChannel: ChannelPlugin<ResolvedQQAccount> = {
  id: "qq",
  meta: {
    id: "qq",
    label: "QQ (OneBot)",
    selectionLabel: "QQ",
    docsPath: "extensions/qq",
    blurb: "Connect to QQ via OneBot v11",
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    // @ts-ignore
    deleteMessage: true,
  },
  configSchema: buildChannelConfigSchema(QQConfigSchema),
  config: {
    listAccountIds: (cfg) => {
        // @ts-ignore
        const qq = cfg.channels?.qq;
        if (!qq) return [];
        if (qq.accounts) return Object.keys(qq.accounts);
        return [DEFAULT_ACCOUNT_ID];
    },
    resolveAccount: (cfg, accountId) => {
        const id = accountId ?? DEFAULT_ACCOUNT_ID;
        // @ts-ignore
        const qq = cfg.channels?.qq;
        const accountConfig = id === DEFAULT_ACCOUNT_ID ? qq : qq?.accounts?.[id];
        return {
            accountId: id,
            name: accountConfig?.name ?? "QQ Default",
            enabled: true,
            configured: Boolean(accountConfig?.wsUrl),
            tokenSource: accountConfig?.accessToken ? "config" : "none",
            config: accountConfig || {},
        };
    },
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    describeAccount: (acc) => ({
        accountId: acc.accountId,
        configured: acc.configured,
    }),
  },
  directory: {
      listPeers: async ({ accountId }) => {
          const client = getClientForAccount(accountId || DEFAULT_ACCOUNT_ID);
          if (!client) return [];
          try {
              const friends = await client.getFriendList();
              return friends.map(f => ({
                  id: String(f.user_id),
                  name: f.remark || f.nickname,
                  type: "user" as const,
                  metadata: { ...f }
              }));
          } catch (e) {
              return [];
          }
      },
      listGroups: async ({ accountId, cfg }) => {
          const client = getClientForAccount(accountId || DEFAULT_ACCOUNT_ID);
          if (!client) return [];
          const list: any[] = [];
          
          try {
              const groups = await client.getGroupList();
              list.push(...groups.map(g => ({
                  id: String(g.group_id),
                  name: g.group_name,
                  type: "group" as const,
                  metadata: { ...g }
              })));
          } catch (e) {}

          // @ts-ignore
          const enableGuilds = cfg?.channels?.qq?.enableGuilds ?? true;
          if (enableGuilds) {
              try {
                  const guilds = await client.getGuildList();
                  list.push(...guilds.map(g => ({
                      id: `guild:${g.guild_id}`,
                      name: `[频道] ${g.guild_name}`,
                      type: "group" as const,
                      metadata: { ...g }
                  })));
              } catch (e) {}
          }
          return list;
      }
  },
  status: {
      probeAccount: async ({ account, timeoutMs }) => {
          if (!account.config.wsUrl) return { ok: false, error: "Missing wsUrl" };

          const liveClient = clients.get(account.accountId);
          if (liveClient?.isConnected()) {
              try {
                  const info = await liveClient.getLoginInfo();
                  return {
                      ok: true,
                      bot: { id: String(info.user_id), username: info.nickname }
                  };
              } catch (e) {
                  return { ok: false, error: String(e) };
              }
          }
          
          const client = new OneBotClient({
              wsUrl: account.config.wsUrl,
              accessToken: account.config.accessToken,
              silent: true,
          });
          
          return new Promise((resolve) => {
              const timer = setTimeout(() => {
                  client.disconnect();
                  resolve({ ok: false, error: "Connection timeout" });
              }, timeoutMs || 5000);

              client.on("connect", async () => {
                  try {
                      const info = await client.getLoginInfo();
                      clearTimeout(timer);
                      client.disconnect();
                      resolve({ 
                          ok: true, 
                          bot: { id: String(info.user_id), username: info.nickname } 
                      });
                  } catch (e) {
                      clearTimeout(timer);
                      client.disconnect();
                      resolve({ ok: false, error: String(e) });
                  }
              });
              
              client.on("error", (err) => {
                  clearTimeout(timer);
                  resolve({ ok: false, error: String(err) });
              });

              client.connect();
          });
      },
      buildAccountSnapshot: ({ account, runtime, probe }) => {
          return {
              accountId: account.accountId,
              name: account.name,
              enabled: account.enabled,
              configured: account.configured,
              running: runtime?.running ?? false,
              lastStartAt: runtime?.lastStartAt ?? null,
              lastError: runtime?.lastError ?? null,
              probe,
          };
      }
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) => 
        applyAccountNameToChannelSection({ cfg, channelKey: "qq", accountId, name }),
    validateInput: ({ input }) => null,
    applyAccountConfig: ({ cfg, accountId, input }) => {
        const namedConfig = applyAccountNameToChannelSection({
            cfg,
            channelKey: "qq",
            accountId,
            name: input.name,
        });
        
        const next = accountId !== DEFAULT_ACCOUNT_ID 
            ? migrateBaseNameToDefaultAccount({ cfg: namedConfig, channelKey: "qq" }) 
            : namedConfig;

        const newConfig = {
            wsUrl: input.wsUrl || "ws://localhost:3001",
            accessToken: input.accessToken,
            enabled: true,
        };

        if (accountId === DEFAULT_ACCOUNT_ID) {
            return {
                ...next,
                channels: {
                    ...next.channels,
                    qq: { ...next.channels?.qq, ...newConfig }
                }
            };
        }
        
        return {
            ...next,
            channels: {
                ...next.channels,
                qq: {
                    ...next.channels?.qq,
                    enabled: true,
                    accounts: {
                        ...next.channels?.qq?.accounts,
                        [accountId]: {
                            ...next.channels?.qq?.accounts?.[accountId],
                            ...newConfig
                        }
                    }
                }
            }
        };
    }
  },
  proactive: {
    shouldEnable: ({ account }) => {
      const config = (account as ResolvedQQAccount).config as any;
      return config?.proactiveUseCoreScheduler !== false;
    },
    tick: async ({ accountId, account, nowMs }) => {
      const config = (account as ResolvedQQAccount).config as any;
      const proactiveVerbose = config.proactiveDmLogVerbose === true;
      const accountWorkspaceRoot = resolveAccountWorkspaceRoot(accountId);

      if (config.proactiveDmEnabled !== true) {
        if (shouldLogProactiveSkip(proactiveVerbose, "disabled")) {
          console.log(`[QQ][qq_proactive_skip] account_id=${accountId} route= skip_reason=disabled`);
        }
        return {
          route: "",
          allowed: false,
          skipReason: "disabled",
        };
      }

      const route = String(config.proactiveDmRoute || "user:2151539153").trim();
      if (!/^user:\d{5,12}$/.test(route)) {
        if (shouldLogProactiveSkip(proactiveVerbose, "invalid_route")) {
          console.log(`[QQ][qq_proactive_skip] account_id=${accountId} route=${route} skip_reason=invalid_route`);
        }
        return {
          route,
          allowed: false,
          skipReason: "invalid_route",
        };
      }
      await hydrateProactiveStateOnce(accountId, route, proactiveVerbose);
      const target = parseTarget(route);
      if (!target || target.kind !== "user") {
        if (shouldLogProactiveSkip(proactiveVerbose, "invalid_route")) {
          console.log(`[QQ][qq_proactive_skip] account_id=${accountId} route=${route} skip_reason=invalid_route`);
        }
        return {
          route,
          allowed: false,
          skipReason: "invalid_route",
        };
      }

      const lastInbound = getRouteLastInboundAt(accountId, route);
      const lastProactive = getRouteLastProactiveAt(accountId, route);
      const lastInboundAgo = lastInbound > 0 ? Math.max(0, nowMs - lastInbound) : -1;
      const lastProactiveAgo = lastProactive > 0 ? Math.max(0, nowMs - lastProactive) : -1;
      if (proactiveVerbose) {
        console.log(
          `[QQ][qq_proactive_tick] account_id=${accountId} route=${route} now=${nowMs} last_inbound_ms_ago=${lastInboundAgo} last_proactive_ms_ago=${lastProactiveAgo}`,
        );
      }
      if (!lastInbound) {
        if (shouldLogProactiveSkip(proactiveVerbose, "no_inbound_yet")) {
          console.log(`[QQ][qq_proactive_skip] account_id=${accountId} route=${route} skip_reason=no_inbound_yet`);
        }
        return {
          route,
          allowed: false,
          skipReason: "no_inbound_yet",
          sessionKey: buildResidentSessionKey(route),
          agentId: routeToResidentAgentId(route),
          stateBefore: {
            lastInboundAt: lastInbound,
            lastProactiveAt: lastProactive,
          },
          stateAfter: {
            lastInboundAt: lastInbound,
            lastProactiveAt: lastProactive,
          },
        };
      }

      const minSilence = Math.max(60_000, Number(config.proactiveDmMinSilenceMs ?? 90 * 60 * 1000));
      const minInterval = Math.max(60_000, Number(config.proactiveDmMinIntervalMs ?? 2 * 60 * 60 * 1000));
      if (nowMs - lastInbound < minSilence) {
        if (shouldLogProactiveSkip(proactiveVerbose, "silence_not_reached")) {
          console.log(
            `[QQ][qq_proactive_skip] account_id=${accountId} route=${route} skip_reason=silence_not_reached last_inbound_ms_ago=${lastInboundAgo} threshold_ms=${minSilence}`,
          );
        }
        return {
          route,
          allowed: false,
          skipReason: "silence_not_reached",
          sessionKey: buildResidentSessionKey(route),
          agentId: routeToResidentAgentId(route),
          stateBefore: {
            lastInboundAt: lastInbound,
            lastProactiveAt: lastProactive,
          },
          stateAfter: {
            lastInboundAt: lastInbound,
            lastProactiveAt: lastProactive,
          },
        };
      }
      if (nowMs - lastProactive < minInterval) {
        if (shouldLogProactiveSkip(proactiveVerbose, "interval_not_reached")) {
          console.log(
            `[QQ][qq_proactive_skip] account_id=${accountId} route=${route} skip_reason=interval_not_reached last_proactive_ms_ago=${lastProactiveAgo} threshold_ms=${minInterval}`,
          );
        }
        return {
          route,
          allowed: false,
          skipReason: "interval_not_reached",
          sessionKey: buildResidentSessionKey(route),
          agentId: routeToResidentAgentId(route),
          stateBefore: {
            lastInboundAt: lastInbound,
            lastProactiveAt: lastProactive,
          },
          stateAfter: {
            lastInboundAt: lastInbound,
            lastProactiveAt: lastProactive,
          },
        };
      }

      try {
        await checkConversationPolicyHook(config, accountWorkspaceRoot, "beforeOutbound", route, "sendText");
      } catch (err: any) {
        console.warn(
          `[QQ][qq_proactive_skip] account_id=${accountId} route=${route} skip_reason=policy_blocked error=${err?.message || err}`,
        );
        return {
          route,
          allowed: false,
          skipReason: "policy_blocked",
          sessionKey: buildResidentSessionKey(route),
          agentId: routeToResidentAgentId(route),
        };
      }
      try {
        await checkRouteUsageQuota(accountWorkspaceRoot, route, "sendText");
      } catch (err: any) {
        console.warn(
          `[QQ][qq_proactive_skip] account_id=${accountId} route=${route} skip_reason=quota_exceeded error=${err?.message || err}`,
        );
        return {
          route,
          allowed: false,
          skipReason: "quota_exceeded",
          sessionKey: buildResidentSessionKey(route),
          agentId: routeToResidentAgentId(route),
        };
      }

      const messageText = proactiveNudges[Math.floor(Math.random() * proactiveNudges.length)] || proactiveNudges[0];
      return {
        route,
        allowed: true,
        messageText,
        sessionKey: buildResidentSessionKey(route),
        agentId: routeToResidentAgentId(route),
        stateBefore: {
          lastInboundAt: lastInbound,
          lastProactiveAt: lastProactive,
        },
        stateAfter: {
          lastInboundAt: lastInbound,
          lastProactiveAt: nowMs,
        },
      };
    },
    markSent: async ({ context, result, nowMs }) => {
      const route = String(result.route || "").trim();
      if (!route) return;
      const config = (context.account as ResolvedQQAccount).config as any;
      const verbose = config.proactiveDmLogVerbose === true;
      setRouteLastProactiveAt(context.accountId, route, nowMs);
      await persistProactiveState(context.accountId, route, verbose);
      console.log(
        `[QQ][qq_proactive_send] account_id=${context.accountId} route=${route} result=success dispatch_ms=0 retry_count=0`,
      );
    },
    markFailed: async ({ context, result, error }) => {
      const route = String(result.route || "").trim();
      console.warn(
        `[QQ][qq_proactive_send] account_id=${context.accountId} route=${route} result=failed dispatch_ms=0 retry_count=0 error=${error}`,
      );
    },
  },
  gateway: {
    startAccount: async (ctx) => {
        const { account, cfg, abortSignal, setStatus } = ctx;
        const config = account.config;
        configureOwnerQq(String((config as any).ownerUserId || process.env.OPENCLAW_QQ_OWNER_ID || "").trim());
        const accountWorkspaceRoot = bindAccountWorkspaceRoot(account.accountId, cfg);
        configureQQLogger({
          accountId: account.accountId,
          workspaceRoot: accountWorkspaceRoot,
          traceEnabled: (config as any).loggingTraceEnabled !== false,
          verboseErrors: (config as any).loggingVerboseErrors === true,
        });

        if (!config.wsUrl) throw new Error("QQ: wsUrl is required");

        await ensureMediaRelayStarted({
          workspaceRoot: accountWorkspaceRoot,
          enabled: (config as any).mediaProxyEnabled === true,
          host: (config as any).mediaProxyListenHost || "0.0.0.0",
          port: Number((config as any).mediaProxyListenPort || 18890),
          proxyPath: String((config as any).mediaProxyPath || "/qq/media"),
          token: String((config as any).mediaProxyToken || "").trim() || "openclaw-qq-relay",
        });

        // Ensure one runtime instance (client + cleanup timer) per account.
        if (clients.has(account.accountId) || cleanupIntervals.has(account.accountId)) {
          console.log(`[QQ] Stopping existing runtime for account ${account.accountId} before restart`);
        }
        cleanupAccountRuntime(account.accountId);

        const client = new OneBotClient({
            wsUrl: config.wsUrl,
            accessToken: config.accessToken,
        });
        
        clients.set(account.accountId, client);

        const processedMsgIds = new Set<string>();
        const cleanupInterval = setInterval(() => {
            if (processedMsgIds.size > 1000) processedMsgIds.clear();
        }, 3600000);
        cleanupIntervals.set(account.accountId, cleanupInterval);

        client.on("connect", async () => {
             console.log(`[QQ] Connected account ${account.accountId}`);
             try {
               setStatus?.({ ...ctx.getStatus(), accountId: account.accountId, connected: true, running: true, lastError: null });
             } catch {}
             try {
                const info = await client.getLoginInfo();
                if (info && info.user_id) client.setSelfId(info.user_id);
                if (info && info.nickname) console.log(`[QQ] Logged in as: ${info.nickname} (${info.user_id})`);
                getQQRuntime().channel.activity.record({
                    channel: "qq", accountId: account.accountId, direction: "inbound", 
                 });
             } catch (err) { }
        });
        client.on("disconnect", () => {
          try {
            setStatus?.({ ...ctx.getStatus(), accountId: account.accountId, connected: false });
          } catch {}
        });

        client.on("request", (event) => {
            if (config.autoApproveRequests) {
                if (event.request_type === "friend") client.setFriendAddRequest(event.flag, true);
                else if (event.request_type === "group") client.setGroupAddRequest(event.flag, event.sub_type, true);
            }
        });

        client.on("message", async (event) => {
          try {
            if (event.post_type === "meta_event") {
                 if (event.meta_event_type === "lifecycle" && event.sub_type === "connect" && event.self_id) client.setSelfId(event.self_id);
                 return;
            }

            if (event.post_type === "notice" && event.notice_type === "notify" && event.sub_type === "poke") {
                if (String(event.target_id) === String(client.getSelfId())) {
                    event.post_type = "message";
                    event.message_type = event.group_id ? "group" : "private";
                    event.raw_message = `[动作] 用户戳了你一下`;
                    event.message = [{ type: "text", data: { text: event.raw_message } }];
                } else return;
            }

            if (event.post_type !== "message") return;
            
            // 2. Dynamic self-message filtering
            const selfId = client.getSelfId() || event.self_id;
            if (selfId && String(event.user_id) === String(selfId)) return;

            if (config.enableDeduplication !== false && event.message_id) {
                const msgIdKey = [
                  account.accountId,
                  String(event.self_id ?? client.getSelfId() ?? ""),
                  String(event.message_type || ""),
                  String(event.group_id ?? ""),
                  String(event.user_id ?? ""),
                  String(event.message_id),
                ].join("|");
                if (processedMsgIds.has(msgIdKey)) return;
                processedMsgIds.add(msgIdKey);
            }

            if (event.message_type === "guild" && !config.enableGuilds) return;

            const isGroupMsg = event.message_type === "group";
            const aggregateWindowMs = Math.max(
              0,
              Number(
                isGroupMsg
                  ? ((config as any).groupAggregateWindowMs ?? (config as any).aggregateWindowMs ?? 900)
                  : ((config as any).dmAggregateWindowMs ?? (config as any).aggregateWindowMs ?? 900),
              ),
            );
            const parsedInbound = await parseInboundMessage({
              event,
              client,
              aggregateWindowMs,
              conversationBaseDir: (route) => conversationBaseDir(account.accountId, route),
              nextRouteGeneration,
              pushRouteAggregation,
              isRouteGenerationCurrent,
              getRouteAggregationSeq,
              finalizeRouteAggregation,
              getCachedMemberName,
              setCachedMemberName,
              sleep,
              inboundMediaResolvePrefer: (config as any).inboundMediaResolvePrefer ?? "napcat-first",
              inboundMediaHttpTimeoutMs: Number((config as any).inboundMediaHttpTimeoutMs ?? 8000),
              inboundMediaHttpRetries: Number((config as any).inboundMediaHttpRetries ?? 2),
              inboundMediaUseStream: (config as any).inboundMediaUseStream !== false,
              inboundMediaFallbackGetMsg: (config as any).inboundMediaFallbackGetMsg !== false,
              inboundMediaMaxPerMessage: Math.max(1, Number((config as any).inboundMediaMaxPerMessage ?? 8)),
            });
            if (!parsedInbound) return;

            const {
              text,
              inboundRoute,
              routeGen,
              userId,
              groupId,
              guildId,
              channelId,
              isGroup,
              isGuild,
              effectiveInboundMediaUrls,
              materializedInboundMediaUrls,
              mediaItemsTotal,
              mediaItemsMaterialized,
              mediaItemsUnresolved,
              unresolvedReasons,
            } = parsedInbound;
            const inboundTs = Date.now();
            setRouteLastInboundAt(account.accountId, inboundRoute, inboundTs);
            const proactiveRoute = String((config as any).proactiveDmRoute || "user:2151539153").trim();
            if ((config as any).proactiveDmEnabled === true && inboundRoute === proactiveRoute) {
              void persistProactiveState(account.accountId, inboundRoute, (config as any).proactiveDmLogVerbose === true);
            }
            const mergedLocalInboundMediaUrls = Array.from(
              new Set(
                [...materializedInboundMediaUrls, ...effectiveInboundMediaUrls.filter((u) => /^file:\/\//i.test(String(u || "")))]
                  .filter(Boolean)
                  .map((u) => String(u)),
              ),
            );
            const currentMsgId = String(event.message_id ?? "");
            const inboundSeq = nextRouteInboundSeq(inboundRoute);
            if (currentMsgId) {
              rememberRouteMediaManifest(inboundRoute, currentMsgId, effectiveInboundMediaUrls, mergedLocalInboundMediaUrls);
            }
            if (mergedLocalInboundMediaUrls.length > 0) {
              rememberRouteRecentMedia(inboundRoute, mergedLocalInboundMediaUrls, currentMsgId);
              lockRouteFileTask(inboundRoute, Number((config as any).fileTaskLockMs || 60_000));
            }

            if (config.blockedUsers?.includes(userId)) return;
            if (isGroup && config.allowedGroups?.length && !config.allowedGroups.includes(groupId)) return;
            
            const isAdmin = config.admins?.includes(userId) ?? false;

            const slashHandled = await handleQQSlashCommand({
              text,
              isGuild,
              isGroup,
              isAdmin,
              userId,
              groupId,
              selfId: client.getSelfId(),
              sendGroup: (msg) => client.sendGroupMsg(groupId, msg),
              sendPrivate: (msg) => client.sendPrivateMsg(userId, msg),
              setGroupBan: (gid, uid, durationSec) => client.setGroupBan(gid, uid, durationSec),
              setGroupKick: (gid, uid) => client.setGroupKick(gid, uid),
              readRouteCapabilityPolicy: (route) => readRouteCapabilityPolicy(accountWorkspaceRoot, route),
              readRouteUsageStats: (route) => readRouteUsageStats(accountWorkspaceRoot, route),
              writeRouteCapabilityPolicy: (route, caps) => writeRouteCapabilityPolicy(accountWorkspaceRoot, route, caps),
              writeRouteUsageStats: (route, stats) => writeRouteUsageStats(accountWorkspaceRoot, route, stats),
              adminsConfigured: Boolean(config.admins?.length),
            });
            if (slashHandled) return;

            // Group mode: only reply when explicitly @mentioned.
            if (isGroup) {
              const selfId = client.getSelfId();
              if (!messageMentionsSelf(event, selfId)) return;
            }
            
            let repliedMsg: any = null;
            const replyMsgId = getReplyMessageId(event.message, text);
            if (replyMsgId) {
                try { repliedMsg = await client.getMsg(replyMsgId); } catch (err) {}
            }
            
            const historyContext = await buildGroupHistoryContext({
              isGroup,
              historyLimit: config.historyLimit ?? 5,
              groupId,
              client,
            });

            const isTriggered = isTriggeredByMentionOrKeyword({
              text,
              isGroup,
              isGuild,
              keywordTriggers: config.keywordTriggers,
            });

            const mentionPassed = passesRequireMention({
              event,
              requireMention: Boolean(config.requireMention),
              isGroup,
              isGuild,
              isTriggered,
              selfId: client.getSelfId(),
              repliedMsg,
            });
            if (!mentionPassed) return;

            const { route, conversationLabel } = resolveInboundRouteContext({
              isGroup,
              isGuild,
              userId,
              groupId,
              guildId,
              channelId,
            });
            const normalizedAccountId = DEFAULT_ACCOUNT_ID;
            const residentAgentId = routeToResidentAgentId(route);
            const residentSessionKey = buildResidentSessionKey(route);
            const msgIdText = String(event.message_id ?? "");
            const runtime = getQQRuntime();
            await ensureResidentAgentVisible(runtime, accountWorkspaceRoot, residentAgentId);
            await ensureRouteAgentMetadata(accountWorkspaceRoot, route, normalizedAccountId);
            const convoState = await updateConversationStateOnInbound(accountWorkspaceRoot, route, text);
            logQQTrace({
              event: "qq_inbound_received",
              route,
              agent_id: residentAgentId,
              session_key: residentSessionKey,
              msg_id: msgIdText,
              source: "chat",
              account_id: account.accountId,
              workspace_root: accountWorkspaceRoot,
            });

            await appendConversationLog(route, account.accountId, "in", {
                messageId: event.message_id,
                text,
                mediaCount: effectiveInboundMediaUrls.length,
                filePath: mergedLocalInboundMediaUrls[0],
                mediaItemsTotal,
                mediaItemsMaterialized,
                mediaItemsUnresolved,
                unresolvedReasons,
            });

            const splitSendRequested = shouldSplitSendRequested(cleanCQCodes(text));
            const inboundTextForRepeatGuard = cleanCQCodes(text || "").trim();
            const inboundLowSignalForRepeatGuard =
              inboundTextForRepeatGuard.length <= 8 ||
              /^\[CQ:face/i.test(String(event.raw_message || "")) ||
              /^(好|嗯|哦|ok|okk|收到|知道了|哈哈|哈+|表情)+[!！。.\s]*$/i.test(inboundTextForRepeatGuard);
            const hasInboundMediaLike = mediaItemsTotal > 0 || mergedLocalInboundMediaUrls.length > 0;
            const replyRunTimeoutMs = Math.max(1000, Number((config as any).replyRunTimeoutMs ?? 600000));
            const routePreemptOldRunBase = (config as any).routePreemptOldRun !== false;
            const interruptPolicy = String((config as any).interruptPolicy ?? "adaptive");
            const adaptiveTimeoutDegradeWindowMs = Math.max(
              0,
              Number((config as any).adaptiveTimeoutDegradeWindowMs ?? 60_000),
            );
            const degradeToQueueLatest =
              interruptPolicy === "adaptive" &&
              adaptiveTimeoutDegradeWindowMs > 0 &&
              routeHadRecentTimeout(route, adaptiveTimeoutDegradeWindowMs);
            const mediaInterruptPolicy = String((config as any).mediaInterruptPolicy ?? "queue-latest");
            const lockBlocksPreempt = isRouteFileTaskLocked(route);
            const routePreemptOldRun =
              routePreemptOldRunBase &&
              !lockBlocksPreempt &&
              interruptPolicy !== "queue-latest" &&
              !degradeToQueueLatest &&
              (!hasInboundMediaLike || mediaInterruptPolicy === "adaptive-preempt");
            const replyAbortOnTimeout = (config as any).replyAbortOnTimeout !== false;
            let dispatchId = "";
            let routeHadDelivered = false;
            let routeHadDropped = false;
            let routeHadFallbackEligibleDrop = false;
            let routeFallbackSentAt = 0;
            let deliveryAttemptSeq = 0;
            const nextAttemptId = (kind: "text" | "media") => `${dispatchId || "none"}:${kind}:${++deliveryAttemptSeq}`;
            const recordFallbackSent = () => {
              const now = Date.now();
              routeLastFallbackAt.set(route, now);
              routeFallbackSentAt = now;
            };
            const canSendFallbackNow = () => {
              const enabled = (config as any).outboundFallbackOnDrop !== false;
              if (!enabled) return false;
              const cooldownMs = Math.max(1000, Number((config as any).outboundFallbackCooldownMs ?? 30_000));
              const last = routeLastFallbackAt.get(route) || 0;
              return Date.now() - last >= cooldownMs;
            };

            const deliver = async (payload: ReplyPayload) => {
              const boundRoute = route;
              if (dispatchId) {
                const inflight = getRouteInFlight(route);
                if (!inflight || inflight.dispatchId !== dispatchId) {
                  console.warn(
                    `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId} run_timeout=false superseded=true drop_reason=dispatch_id_mismatch`,
                  );
                  return;
                }
              }
              try {
                const textPreview = typeof payload?.text === "string" ? payload.text.slice(0, 120).replace(/\s+/g, " ") : "";
                const fileCount = Array.isArray((payload as any)?.files) ? (payload as any).files.length : 0;
                console.log(`[QQ][deliver] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId || "none"} hasText=${Boolean(payload?.text)} files=${fileCount} preview=${textPreview}`);
              } catch {}
              const target = parseTarget(route);
              if (!target) return;
              if (target.route !== boundRoute) throw new Error(`QQ route isolation violation: ${boundRoute} -> ${target.route}`);

              const normalized = normalizeReplyPayload(payload as QQReplyPayload, config, {
                splitSendRequested,
                maxMessageLength: config.maxMessageLength || 4000,
              });
              const strictAbortPattern = (config as any).outboundAbortPatternStrict !== false;
              const filteredTextChunks = normalized.textChunks.filter((chunk) =>
                strictAbortPattern ? !isAbortLeakText(chunk) : !isAbortLeakTextLoose(chunk),
              );
              if (normalized.textChunks.length > 0 && filteredTextChunks.length !== normalized.textChunks.length) {
                console.warn(
                  `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId || "none"} run_timeout=false superseded=false drop_reason=abort_text_suppressed`,
                );
                routeHadDropped = true;
                routeHadFallbackEligibleDrop = routeHadFallbackEligibleDrop || isFallbackEligibleDropReason("abort_text_suppressed");
              }

              const sendTextChunk = async (chunk: string, replyId?: string, action = "send_text") => {
                const attemptId = nextAttemptId("text");
                logDeliveryAttemptTrace({
                  route,
                  msgId: msgIdText,
                  dispatchId: dispatchId || "none",
                  attemptId,
                  phase: "prepared",
                  action,
                });
                try {
                  if (isAutomationMetaLeakText(chunk)) {
                    routeHadDropped = true;
                    routeHadFallbackEligibleDrop = routeHadFallbackEligibleDrop || isFallbackEligibleDropReason("automation_meta_leak_guard");
                    logDeliveryAttemptTrace({
                      route,
                      msgId: msgIdText,
                      dispatchId: dispatchId || "none",
                      attemptId,
                      phase: "dropped",
                      result: "dropped",
                      dropReason: "automation_meta_leak_guard",
                      action,
                    });
                    console.log(
                      `[QQ][deliver] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId || "none"} source=automation skip_reason=automation_meta_leak_guard`,
                    );
                    return false;
                  }
                  const dedupWindowMs = Math.max(0, Number((config as any).outboundTextDedupWindowMs ?? 12_000));
                  if (dedupWindowMs > 0 && shouldSuppressDuplicateOutboundText(route, chunk, dedupWindowMs)) {
                    routeHadDropped = true;
                    routeHadFallbackEligibleDrop = routeHadFallbackEligibleDrop || isFallbackEligibleDropReason("duplicate_text_suppressed");
                    logDeliveryAttemptTrace({
                      route,
                      msgId: msgIdText,
                      dispatchId: dispatchId || "none",
                      attemptId,
                      phase: "dropped",
                      result: "dropped",
                      dropReason: "duplicate_text_suppressed",
                      action,
                    });
                    console.warn(
                      `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId || "none"} run_timeout=false superseded=false drop_reason=duplicate_text_suppressed`,
                    );
                    return false;
                  }
                  const repeatGuardWindowMs = Math.max(0, Number((config as any).outboundRepeatGuardWindowMs ?? 2 * 60 * 60 * 1000));
                  if (
                    inboundLowSignalForRepeatGuard &&
                    repeatGuardWindowMs > 0 &&
                    chunk.trim().length >= 24 &&
                    shouldSuppressDuplicateOutboundText(route, chunk, repeatGuardWindowMs)
                  ) {
                    routeHadDropped = true;
                    routeHadFallbackEligibleDrop = routeHadFallbackEligibleDrop || isFallbackEligibleDropReason("duplicate_text_suppressed");
                    logDeliveryAttemptTrace({
                      route,
                      msgId: msgIdText,
                      dispatchId: dispatchId || "none",
                      attemptId,
                      phase: "dropped",
                      result: "dropped",
                      dropReason: "duplicate_text_suppressed",
                      action,
                    });
                    console.warn(
                      `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId || "none"} run_timeout=false superseded=false drop_reason=repeat_guard_suppressed`,
                    );
                    return false;
                  }
                  await checkRouteUsageQuota(accountWorkspaceRoot, route, "sendText");
                  const message = buildTextMessage(chunk, replyId);
                  logDeliveryAttemptTrace({
                    route,
                    msgId: msgIdText,
                    dispatchId: dispatchId || "none",
                    attemptId,
                    phase: "queued",
                    action,
                  });
                  await deliveryManager.sendWithRetry(
                    config,
                    {
                      accountId: account.accountId,
                      route,
                      targetKind: target.kind,
                      action,
                      summary: chunk,
                      msgId: msgIdText,
                      dispatchId: dispatchId || "none",
                      attemptId,
                      source: isAutomationSkipText(chunk) ? "automation" : "chat",
                      preflight: () => {
                        if (dispatchId) assertDispatchCanSend(route, msgIdText, dispatchId, { allowMissingInFlight: true });
                        logDeliveryAttemptTrace({
                          route,
                          msgId: msgIdText,
                          dispatchId: dispatchId || "none",
                          attemptId,
                          phase: "sending",
                          action,
                        });
                      },
                    },
                    async () => sendToParsedTarget(client, target, message),
                  );
                  routeHadDelivered = true;
                  logDeliveryAttemptTrace({
                    route,
                    msgId: msgIdText,
                    dispatchId: dispatchId || "none",
                    attemptId,
                    phase: "sent",
                    result: "ok",
                    action,
                  });
                  rememberRouteOutboundText(route, chunk);
                  return true;
                } catch (err: any) {
                  routeHadDropped = true;
                  if (err instanceof DispatchDropError) {
                    routeHadFallbackEligibleDrop = routeHadFallbackEligibleDrop || isFallbackEligibleDropReason(err.reason);
                    logDeliveryAttemptTrace({
                      route,
                      msgId: msgIdText,
                      dispatchId: dispatchId || "none",
                      attemptId,
                      phase: "dropped",
                      result: "dropped",
                      dropReason: err.reason,
                      action,
                    });
                    return false;
                  }
                  const maybeQuota = String(err?.message || "").toLowerCase().includes("quota exceeded");
                  if (!maybeQuota) {
                    routeHadFallbackEligibleDrop = true;
                  }
                  logDeliveryAttemptTrace({
                    route,
                    msgId: msgIdText,
                    dispatchId: dispatchId || "none",
                    attemptId,
                    phase: "failed",
                    result: "failed",
                    dropReason: maybeQuota ? "quota_exceeded" : undefined,
                    action,
                    error: err?.message || String(err),
                  });
                  throw err;
                }
              };

              const sendSegments = async (segments: OneBotMessage, mediaDedupKey?: string) => {
                const attemptId = nextAttemptId("media");
                logDeliveryAttemptTrace({
                  route,
                  msgId: msgIdText,
                  dispatchId: dispatchId || "none",
                  attemptId,
                  phase: "queued",
                  action: "send_media",
                });
                if (dispatchId) assertDispatchCanSend(route, msgIdText, dispatchId, { allowMissingInFlight: true });
                await deliveryManager.sendWithRetry(
                  config,
                  {
                    accountId: account.accountId,
                    route,
                    targetKind: target.kind,
                    action: "send_media",
                    summary: JSON.stringify(segments).slice(0, 180),
                    mediaDedupKey,
                    msgId: msgIdText,
                    dispatchId: dispatchId || "none",
                    attemptId,
                    source: "chat",
                    preflight: () => {
                      if (dispatchId) assertDispatchCanSend(route, msgIdText, dispatchId, { allowMissingInFlight: true });
                      logDeliveryAttemptTrace({
                        route,
                        msgId: msgIdText,
                        dispatchId: dispatchId || "none",
                        attemptId,
                        phase: "sending",
                        action: "send_media",
                      });
                    },
                  },
                  async () => sendToParsedTarget(client, target, segments),
                );
                routeHadDelivered = true;
                logDeliveryAttemptTrace({
                  route,
                  msgId: msgIdText,
                  dispatchId: dispatchId || "none",
                  attemptId,
                  phase: "sent",
                  result: "ok",
                  action: "send_media",
                });
              };

              try {
                await checkConversationPolicyHook(config, accountWorkspaceRoot, "beforeOutbound", route, "sendText");
              } catch (err: any) {
                routeHadDropped = true;
                routeHadFallbackEligibleDrop = routeHadFallbackEligibleDrop || isFallbackEligibleDropReason("policy_blocked");
                logDeliveryAttemptTrace({
                  route,
                  msgId: msgIdText,
                  dispatchId: dispatchId || "none",
                  attemptId: `${dispatchId || "none"}:policy:${++deliveryAttemptSeq}`,
                  phase: "dropped",
                  result: "dropped",
                  dropReason: "policy_blocked",
                  action: "send_text",
                  error: err?.message || String(err),
                });
                throw err;
              }

              await sendTextChunks({
                chunks: filteredTextChunks,
                targetKind: target.kind,
                userId,
                enqueue: async (fn) => deliveryManager.enqueueSend(config, fn),
                sendTextChunk: async (chunk) => sendTextChunk(chunk),
                onChunkSent: async (chunk) => {
                  if (dispatchId) assertDispatchCanSend(route, msgIdText, dispatchId, { allowMissingInFlight: true });
                  await appendConversationLog(route, account.accountId, "out", { text: chunk, mediaCount: 0 });
                  await bumpRouteUsage(accountWorkspaceRoot, route, "sendText");
                },
              });

              await sendMediaItems({
                items: normalized.mediaItems,
                route,
                workspaceRoot: accountWorkspaceRoot,
                config,
                conversationBaseDir: (r) => conversationBaseDir(account.accountId, r),
                enqueue: async (fn) => deliveryManager.enqueueSend(config, fn),
                sendSegments: async (segments, dedup) => sendSegments(segments, dedup),
                checkBeforeOutboundMedia: async () =>
                  checkConversationPolicyHook(config, accountWorkspaceRoot, "beforeOutbound", route, "sendMedia"),
                checkQuota: async (kind) => checkRouteUsageQuota(accountWorkspaceRoot, route, kind === "sendVoice" ? "sendVoice" : "sendMedia"),
                canSendRecord: async () => client.canSendRecord(),
                canSendImage: async () => client.canSendImage(),
                consumeImageQuota: async () => consumeImageQuota(accountWorkspaceRoot, route),
                onSent: async (item, persistedPath, kind) => {
                  if (dispatchId) assertDispatchCanSend(route, msgIdText, dispatchId, { allowMissingInFlight: true });
                  await appendConversationLog(route, account.accountId, "out", { text: item.name || item.source, mediaCount: 1, filePath: persistedPath });
                  await bumpRouteUsage(accountWorkspaceRoot, route, kind === "record" ? "sendVoice" : "sendMedia");
                },
                streamClient: client,
              });

              if (!routeHadDelivered && routeHadDropped && routeHadFallbackEligibleDrop && canSendFallbackNow()) {
                const fallbackText = "处理中断，请再发一次。";
                try {
                  if (dispatchId) {
                    const inflight = getRouteInFlight(route);
                    if (!inflight || inflight.dispatchId !== dispatchId) {
                      routeHadDropped = true;
                      logDeliveryAttemptTrace({
                        route,
                        msgId: msgIdText,
                        dispatchId: dispatchId || "none",
                        attemptId: `${dispatchId || "none"}:fallback:${++deliveryAttemptSeq}`,
                        phase: "dropped",
                        result: "dropped",
                        dropReason: "dispatch_id_mismatch",
                        action: "send_text",
                      });
                      console.warn(
                        `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId || "none"} run_timeout=false superseded=true drop_reason=fallback_dispatch_mismatch`,
                      );
                      return;
                    }
                  }
                  await deliveryManager.sendWithRetry(
                    config,
                    {
                      accountId: account.accountId,
                      route,
                      targetKind: target.kind,
                      action: "send_text",
                      summary: fallbackText,
                      msgId: msgIdText,
                      dispatchId: dispatchId || "none",
                      attemptId: `${dispatchId || "none"}:fallback:${++deliveryAttemptSeq}`,
                      source: "chat",
                    },
                    async () => sendToParsedTarget(client, target, fallbackText),
                  );
                  await appendConversationLog(route, account.accountId, "out", { text: fallbackText, mediaCount: 0 });
                  recordFallbackSent();
                  routeHadDelivered = true;
                  console.warn(
                    `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId || "none"} run_timeout=false superseded=false drop_reason=fallback_sent_on_drop fallback_at=${routeFallbackSentAt}`,
                  );
                } catch (fallbackErr: any) {
                  console.warn(
                    `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId || "none"} run_timeout=false superseded=false drop_reason=fallback_send_failed error=${fallbackErr?.message || fallbackErr}`,
                  );
                }
              }
            };

            const { dispatcher, replyOptions } = runtime.channel.reply.createReplyDispatcherWithTyping({ deliver });

            let replyToBody = "";
            let replyToSender = "";
            if (replyMsgId && repliedMsg) {
                replyToBody = cleanCQCodes(typeof repliedMsg.message === 'string' ? repliedMsg.message : repliedMsg.raw_message || '');
                replyToSender = repliedMsg.sender?.nickname || repliedMsg.sender?.card || String(repliedMsg.sender?.user_id || '');
            }

            const replySuffix = replyToBody ? `\n\n[Replying to ${replyToSender || "unknown"}]\n${replyToBody}\n[/Replying]` : "";
            let bodyWithReply = cleanCQCodes(text) + replySuffix;

            const sendBudget = await getRouteSendBudget(accountWorkspaceRoot, route);
            const mediaBlocked = sendBudget.mediaRemaining <= 0;
            const voiceBlocked = sendBudget.voiceRemaining <= 0;
            const inboundTextClean = cleanCQCodes(text);
            const asksForMediaAnalysis = /看图|识图|图片|附件|文件|语音|视频|内容|解析/i.test(inboundTextClean);
            const routeIsBusy = hasRouteInFlight(route);
            const routeRecentlyTimedOut = routeHadRecentTimeout(route, 2 * 60 * 1000);
            let effectiveHistoryContext = historyContext;
            if ((routeIsBusy || routeRecentlyTimedOut) && historyContext) {
              const lines = historyContext.split("\n").filter((it) => String(it || "").trim().length > 0);
              const degraded = Math.max(1, Math.floor((config.historyLimit ?? 5) / 2));
              effectiveHistoryContext = lines.slice(-degraded).join("\n");
            }
            const routePersonaPrompt = await readRoutePersonaPrompt(accountWorkspaceRoot, route);
            const mergedSystemPrompt = [String(config.systemPrompt || "").trim(), routePersonaPrompt].filter(Boolean).join("\n\n");
            const blockBuild = buildQQSystemBlock({
              systemPrompt: mergedSystemPrompt || undefined,
              splitSendRequested,
              historyContext: effectiveHistoryContext,
              mediaBlocked,
              voiceBlocked,
              inboundTextClean,
              mediaRemaining: sendBudget.mediaRemaining,
              voiceRemaining: sendBudget.voiceRemaining,
            });
            if (blockBuild.shouldHardBlockMediaIntent) {
              await deliver({ text: blockBuild.hardBlockMessage || "已触发权限上限，请联系管理员。" });
              return;
            }

            bodyWithReply = blockBuild.systemBlock + bodyWithReply;
            const routeInboundFilesDir = `${conversationBaseDir(account.accountId, route)}/in/files`;
            bodyWithReply = `<system>QQ入站非文本兜底规则：当消息包含“[图片]/[语音消息]/[文件]”占位，且上下文未显式提供可用媒体URL/本地路径时，必须主动检查当前route的入站落盘目录（${routeInboundFilesDir}），优先读取最近3分钟内最新的1-3个文件进行判断；禁止读取其他route目录。</system>\n\n` + bodyWithReply;
            const historyIncludeMedia = Boolean((config as any).historyIncludeMedia);
            const historyMediaMaxItems = Math.max(1, Number((config as any).historyMediaMaxItems ?? 1));
            const recentMediaTtlMs = Math.max(1000, Number((config as any).recentInboundMediaTtlMs ?? 10 * 60 * 1000));
            const currentMsgManifest = getRouteMediaManifest(route, msgIdText, recentMediaTtlMs);
            const latestManifest = getRouteLatestMediaManifest(route, recentMediaTtlMs);
            const recentInboundMediaUrls = getRouteRecentMedia(route, recentMediaTtlMs, historyMediaMaxItems);

            // Dual-path media attach:
            // 1) strict current message manifest
            // 2) current parsed payload
            // 3) latest manifest/recent media (analysis follow-up)
            const attachInboundMediaUrls = (currentMsgManifest?.localUrls?.length ? currentMsgManifest.localUrls : [])
              .concat(mergedLocalInboundMediaUrls)
              .concat(asksForMediaAnalysis ? (latestManifest?.localUrls || recentInboundMediaUrls) : []);
            const attachMediaUrls = (currentMsgManifest?.mediaUrls?.length ? currentMsgManifest.mediaUrls : [])
              .concat(effectiveInboundMediaUrls)
              .concat(asksForMediaAnalysis ? (latestManifest?.mediaUrls || recentInboundMediaUrls) : []);

            const attachLocalFinal = Array.from(new Set(attachInboundMediaUrls.map((u) => String(u || "").trim()).filter(Boolean)));
            const attachMediaFinal = Array.from(new Set(attachMediaUrls.map((u) => String(u || "").trim()).filter(Boolean)));

            if (mediaItemsMaterialized > 0 && attachLocalFinal.length === 0 && attachMediaFinal.length === 0) {
              console.warn(
                `[QQ][ctx-attach-assert] route=${route} msgId=${msgIdText} materialized=${mediaItemsMaterialized} but no media attached`,
              );
            }

            const shouldAttachInboundMedia = historyIncludeMedia || attachLocalFinal.length > 0 || asksForMediaAnalysis;
            if (shouldAttachInboundMedia && attachLocalFinal.length > 0) {
              const mediaHints = attachLocalFinal.slice(0, historyMediaMaxItems).map((u, i) => `[入站媒体#${i + 1}] ${u}`);
              bodyWithReply = `${bodyWithReply}\n\n<inbound_media>\n${mediaHints.join("\n")}\n</inbound_media>`;
            }
            if (attachMediaFinal.length > 0 || attachLocalFinal.length > 0) {
              bodyWithReply = `${bodyWithReply}\n\n<inbound_media_manifest msg_id=\"${msgIdText}\">\nmedia_urls=${attachMediaFinal.length}\nlocal_urls=${attachLocalFinal.length}\n</inbound_media_manifest>`;
            }

            console.log(
              `[QQ][ctx-attach] route=${route} msgId=${msgIdText} media_urls=${attachMediaFinal.length} local_urls=${attachLocalFinal.length} asks_analysis=${asksForMediaAnalysis} manifest=${currentMsgManifest ? "hit" : "miss"}`,
            );

            const inboundHasVoice = mediaItemsTotal > 0 && /\[语音消息\]/.test(text);
            if (inboundHasVoice) {
              const voiceTranscript = await transcribeInboundVoiceOnce({
                workspaceRoot: accountWorkspaceRoot,
                localFileUrls: attachLocalFinal,
                route,
                msgId: msgIdText,
              });
              if (voiceTranscript?.text) {
                const voiceMeta = [
                  `<voice_message source="qq_record">`,
                  `transcript=${voiceTranscript.text}`,
                  voiceTranscript.durationSec ? `duration_sec=${voiceTranscript.durationSec}` : "",
                  voiceTranscript.language ? `language=${voiceTranscript.language}` : "",
                  `</voice_message>`,
                ]
                  .filter(Boolean)
                  .join("\n");
                bodyWithReply = `${bodyWithReply}\n\n${voiceMeta}`;
              }
            }

            const ctxPayload = runtime.channel.reply.finalizeInboundContext({
                Provider: "qq", Channel: "qq", From: route, To: "qq:bot", Body: bodyWithReply, RawBody: text,
                BodyForAgent: bodyWithReply,
                BodyForCommands: cleanCQCodes(text),
                SenderId: String(userId), SenderName: event.sender?.nickname || "Unknown", ConversationLabel: conversationLabel,
                SessionKey: residentSessionKey, AccountId: normalizedAccountId, ChatType: isGroup ? "group" : isGuild ? "channel" : "direct", Timestamp: event.time * 1000,
                OriginatingChannel: "qq", OriginatingTo: route, CommandAuthorized: true,
                ...(attachMediaFinal.length > 0 && { MediaUrls: attachMediaFinal }),
                ...(attachLocalFinal.length > 0 && { QQInboundMediaLocalUrls: attachLocalFinal }),
                ...(replyMsgId && { ReplyToId: replyMsgId, ReplyToBody: replyToBody, ReplyToSender: replyToSender }),
            });

            console.log(`[QQ][inbound] route=${route} msgId=${String(event.message_id ?? "")} stage=session_prepare`);
            await withTimeout(
              migrateLegacySessionIfNeeded(runtime, cfg, account.accountId, route, residentSessionKey, residentAgentId),
              4000,
              "migrateLegacySessionIfNeeded"
            );

            console.log(`[QQ][inbound] route=${route} msgId=${String(event.message_id ?? "")} stage=record_inbound`);
            await withTimeout(
              runtime.channel.session.recordInboundSession({
                  storePath: runtime.channel.session.resolveStorePath(cfg.session?.store, { agentId: residentAgentId }),
                  sessionKey: ctxPayload.SessionKey!, ctx: ctxPayload,
                  updateLastRoute: { sessionKey: ctxPayload.SessionKey!, channel: "qq", to: route, accountId: DEFAULT_ACCOUNT_ID },
                  onRecordError: (err) => console.error("QQ Session Error:", err)
              }),
              5000,
              "recordInboundSession"
            );

            const taskMetaPath = `${conversationBaseDir(account.accountId, route)}/meta/task-state.json`;
            const taskKind = mediaItemsTotal > 0 ? "heavy_media" : "chat";
            const persistTaskState = async (state: "queued" | "running" | "succeeded" | "failed" | "timeout", extra?: Record<string, unknown>) => {
              try {
                await fs.mkdir(`${conversationBaseDir(account.accountId, route)}/meta`, { recursive: true });
                const payload = {
                  route,
                  msgId: msgIdText,
                  dispatchId: dispatchId || null,
                  state,
                  taskKind,
                  at: Date.now(),
                  ...extra,
                };
                await fs.writeFile(taskMetaPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
              } catch (e) {
                console.warn("[QQ][task-meta] write failed", e);
              }
            };

            await persistTaskState("queued", { inboundSeq, mediaCount: mediaItemsTotal });

            const heavyByMedia = mediaItemsTotal > 0;
            const heavyByLongGen = cleanCQCodes(text || "").length >= 800;
            const shouldDispatchAsChildTask = heavyByMedia || heavyByLongGen;
            if (shouldDispatchAsChildTask) {
              const taskResult = await enqueueRouteTask({
                workspaceRoot: accountWorkspaceRoot,
                route,
                msgId: msgIdText,
                dispatchId: dispatchId || undefined,
                taskKind: heavyByMedia ? "heavy_media" : "heavy_long_generation",
                payloadSummary: cleanCQCodes(text || "").slice(0, 200),
                guardrails: {
                  taskMaxRuntimeMs: Number((config as any).taskMaxRuntimeMs ?? 120000),
                  taskMaxRetries: Number((config as any).taskMaxRetries ?? 1),
                  taskMaxConcurrency: Number((config as any).taskMaxConcurrency ?? 1),
                  taskIdempotencyEnabled: (config as any).taskIdempotencyEnabled !== false,
                },
                run: async (attempt) => {
                  const inflightBegin = beginRouteInFlight({ route, msgId: msgIdText });
                  dispatchId = inflightBegin.current.dispatchId;
                  try {
                    await checkConversationPolicyHook(config, accountWorkspaceRoot, "beforeDispatch", route);
                    await bumpRouteUsage(accountWorkspaceRoot, route, "dispatch");
                    console.log(`[QQ][task-unit] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId} task_attempt=${attempt} stage=dispatch_start`);
                    await persistTaskState("running", { dispatchId, inboundSeq, taskAttempt: attempt, childTask: true });
                    const replyOptionsWithAbort = {
                      ...replyOptions,
                      abortSignal: inflightBegin.current.abortController.signal,
                    } as typeof replyOptions;
                    const startedAt = Date.now();
                    await withTimeout(
                      runtime.channel.reply.dispatchReplyFromConfig({ ctx: ctxPayload, cfg, dispatcher, replyOptions: replyOptionsWithAbort }),
                      Number((config as any).taskMaxRuntimeMs ?? (config as any).replyRunTimeoutMs ?? 600000),
                      "qq_dispatch_child_task",
                    );
                    const durationMs = Date.now() - startedAt;
                    await persistTaskState("succeeded", { dispatchId, dispatchDurationMs: durationMs, taskAttempt: attempt, childTask: true });
                    console.log(`[QQ][task-unit] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId} task_attempt=${attempt} stage=dispatch_done duration_ms=${durationMs}`);
                    return { resultSummary: `dispatch_done_${durationMs}ms` };
                  } finally {
                    if (dispatchId) clearRouteInFlight(route, dispatchId);
                  }
                },
                onFailed: async (error, status) => {
                  const reason = String((error as any)?.message || error || "child_task_failed");
                  await persistTaskState(status === "timeout" ? "timeout" : "failed", {
                    dispatchId,
                    dropReason: reason,
                    childTask: true,
                  });
                  console.warn(`[QQ][task-unit] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId || "none"} status=${status} error=${reason}`);
                  if (config.enableErrorNotify) {
                    try { await deliver({ text: status === "timeout" ? "处理超时了，请稍后重试。" : "处理失败了，我稍后可以重试。" }); } catch {}
                  }
                },
              });
              console.log(`[QQ][task-unit] route=${route} msg_id=${msgIdText} task_key=${taskResult.taskKey} deduped=${taskResult.deduped}`);
              return;
            }

            let inputStatusOpened = false;
            let runTimedOut = false;
            let runSuperseded = false;
            try {
              if (route.startsWith("user:") && !isRouteGenerationCurrent(route, routeGen)) {
                console.warn(`[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=none run_timeout=false superseded=true drop_reason=route_generation_stale`);
                return;
              }

              const interruptCoalesceEnabled = (config as any).interruptCoalesceEnabled !== false;
              const configuredInterruptWindowMs = Number((config as any).interruptWindowMs ?? 0);
              const legacyInterruptCoalesceMs = Number((config as any).interruptCoalesceMs ?? 0);
              const interruptCoalesceMs = Math.max(
                100,
                configuredInterruptWindowMs > 0
                  ? configuredInterruptWindowMs
                  : legacyInterruptCoalesceMs > 0
                    ? legacyInterruptCoalesceMs
                    : aggregateWindowMs,
              );
              const existingInFlight = getRouteInFlight(route);
              if (existingInFlight && !routePreemptOldRun) {
                const pending = upsertRoutePendingLatest({
                  route,
                  msgId: msgIdText,
                  inboundSeq,
                  hasInboundMediaLike,
                });
                console.warn(
                  `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=none run_timeout=false superseded=false drop_reason=queued_while_busy pending_seq=${pending.inboundSeq}`,
                );
                await persistTaskState("queued", { reason: "busy", pendingSeq: pending.inboundSeq });
                const followup = cleanCQCodes(text || "").trim();
                if (followup && /可以吗|处理了吗|好了没|进度|怎么样|看下|现在可以|ok\??/i.test(followup)) {
                  try { await deliver({ text: "正在处理你刚发的文件，马上给你结果。" }); } catch {}
                }
                const waitDeadline = Date.now() + Math.max(15_000, replyRunTimeoutMs * 2);
                while (hasRouteInFlight(route) && Date.now() < waitDeadline) {
                  await sleep(80);
                }
                if (!claimRoutePendingLatest(route, inboundSeq)) {
                  const latestPending = getRoutePendingLatest(route);
                  console.warn(
                    `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=none run_timeout=false superseded=true drop_reason=queued_superseded_by_newer_inbound latest_seq=${latestPending?.inboundSeq ?? -1}`,
                  );
                  return;
                }
                console.log(
                  `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=none run_timeout=false superseded=false drop_reason=queued_resumed_after_busy`,
                );
              }
              if (existingInFlight && routePreemptOldRun && interruptCoalesceEnabled) {
                try {
                  existingInFlight.abortController.abort(new Error("preempted_by_new_inbound_coalesce"));
                } catch {}
                await sleep(interruptCoalesceMs);
                if (getRouteInboundSeq(route) !== inboundSeq) {
                  console.warn(
                    `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=none run_timeout=false superseded=true drop_reason=coalesce_superseded_after_preempt`,
                  );
                  return;
                }
              }
              if (!existingInFlight && interruptCoalesceEnabled) {
                await sleep(interruptCoalesceMs);
                if (getRouteInboundSeq(route) !== inboundSeq) {
                  console.warn(
                    `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=none run_timeout=false superseded=true drop_reason=merged_into_newer_inbound`,
                  );
                  return;
                }
              }

              const inflightBegin = beginRouteInFlight({ route, msgId: msgIdText });
              dispatchId = inflightBegin.current.dispatchId;
              if (inflightBegin.previous && inflightBegin.previous.dispatchId !== dispatchId) {
                try {
                  inflightBegin.previous.abortController.abort(new Error("preempted_by_new_inbound"));
                } catch {}
                console.warn(
                  `[QQ][dispatch-trace] route=${route} msg_id=${inflightBegin.previous.msgId || ""} dispatch_id=${inflightBegin.previous.dispatchId} run_timeout=false superseded=true drop_reason=preempted_by_new_inbound`,
                );
              }

              // Fast acknowledgement for heavy tasks to keep chat responsive
              if (mediaItemsTotal > 0 && !routeHadDelivered) {
                try {
                  await deliver({ text: "收到，正在处理你刚发的文件/图片，我先开工，稍后给你结果。" });
                  routeHadDelivered = true;
                } catch {}
              }

              // NapCat typing indicator: private chats only
              if (!isGroup && !isGuild) {
                try {
                  await client.setInputStatus(userId, 1);
                  inputStatusOpened = true;
                } catch (e: any) {
                  console.warn(`[QQ][typing] open failed user=${userId} err=${e?.message || e}`);
                }
              }
              await checkConversationPolicyHook(config, accountWorkspaceRoot, "beforeDispatch", route);
              await bumpRouteUsage(accountWorkspaceRoot, route, "dispatch");
              console.log(`[QQ][inbound] route=${route} msgId=${msgIdText} dispatch_id=${dispatchId} stage=dispatch_start`);
              logQQTrace({
                event: "qq_dispatch_start",
                route,
                msg_id: msgIdText,
                dispatch_id: dispatchId,
                source: "chat",
                agent_id: residentAgentId,
                session_key: residentSessionKey,
                account_id: account.accountId,
                workspace_root: accountWorkspaceRoot,
              });
              await persistTaskState("running", { dispatchId, inboundSeq });
              const dispatchStartedAt = Date.now();
              const replyOptionsWithAbort = {
                ...replyOptions,
                abortSignal: inflightBegin.current.abortController.signal,
              } as typeof replyOptions;
              await withTimeout(
                runtime.channel.reply.dispatchReplyFromConfig({ ctx: ctxPayload, cfg, dispatcher, replyOptions: replyOptionsWithAbort }),
                replyRunTimeoutMs,
                "qq_dispatch_run",
                {
                  onTimeout: async () => {
                    runTimedOut = true;
                    markRouteDispatchTimeout(route);
                    if (replyAbortOnTimeout) {
                      try {
                        inflightBegin.current.abortController.abort(new Error("qq_dispatch_run_timeout_abort"));
                      } catch {}
                    }
                  },
                },
              );
              const dispatchDurationMs = Date.now() - dispatchStartedAt;
              runSuperseded = (getRouteInFlight(route)?.dispatchId || "") !== dispatchId;
              console.log(
                `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId} dispatch_duration_ms=${dispatchDurationMs} run_timeout=false superseded=${runSuperseded} drop_reason=${runSuperseded ? "dispatch_id_mismatch" : ""}`,
              );
              logQQTrace({
                event: runSuperseded ? "qq_dispatch_drop" : "qq_dispatch_done",
                route,
                msg_id: msgIdText,
                dispatch_id: dispatchId,
                source: "chat",
                drop_reason: runSuperseded ? "dispatch_id_mismatch" : "",
                duration_ms: dispatchDurationMs,
                agent_id: residentAgentId,
                session_key: residentSessionKey,
                account_id: account.accountId,
                workspace_root: accountWorkspaceRoot,
              });
              if (!runSuperseded) {
                console.log(`[QQ][inbound] route=${route} msgId=${msgIdText} dispatch_id=${dispatchId} stage=dispatch_done`);
                await persistTaskState("succeeded", { dispatchId, dispatchDurationMs });
              }
            } catch (error) {
              console.error(`[QQ][dispatch] route=${route} msgId=${msgIdText} dispatch_id=${dispatchId || "none"} error=`, error);
              const dispatchDropReason = error instanceof DispatchDropError ? error.reason : "";
              if (!runTimedOut) runTimedOut = String((error as any)?.message || "").includes("qq_dispatch_run timeout");
              runSuperseded = (getRouteInFlight(route)?.dispatchId || "") !== dispatchId;
              const dropReason = dispatchDropReason || (runTimedOut ? "dispatch_timeout" : runSuperseded ? "dispatch_id_mismatch" : "dispatch_error");
              console.warn(
                `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId || "none"} run_timeout=${runTimedOut} superseded=${runSuperseded} drop_reason=${dropReason}`,
              );
              logQQTrace({
                event: runTimedOut ? "qq_dispatch_timeout" : "qq_dispatch_error",
                route,
                msg_id: msgIdText,
                dispatch_id: dispatchId || "none",
                source: "chat",
                drop_reason: dropReason,
                error: String((error as any)?.message || error || ""),
                agent_id: residentAgentId,
                session_key: residentSessionKey,
                account_id: account.accountId,
                workspace_root: accountWorkspaceRoot,
              });
              if (runTimedOut) {
                markRouteDispatchTimeout(route);
                await persistTaskState("timeout", { dispatchId, dropReason });
              } else {
                await persistTaskState("failed", { dispatchId, dropReason });
              }
              if (config.enableErrorNotify && !runSuperseded) {
                try { await deliver({ text: runTimedOut ? "处理中超时，请稍后重试。" : "⚠️ 服务调用失败，请稍后重试。" }); } catch {}
              }
              if (!routeHadDelivered && !runSuperseded && (runTimedOut || routeHadFallbackEligibleDrop) && canSendFallbackNow()) {
                const fallbackText = "处理中断，请再发一次。";
                try {
                  const target = parseTarget(route);
                  if (target) {
                    await deliveryManager.sendWithRetry(
                      config,
                      {
                        accountId: account.accountId,
                        route,
                        targetKind: target.kind,
                        action: "send_text",
                        summary: fallbackText,
                        msgId: msgIdText,
                        dispatchId: dispatchId || "none",
                        attemptId: `${dispatchId || "none"}:fallback-catch:${Date.now()}`,
                        source: "chat",
                      },
                      async () => sendToParsedTarget(client, target, fallbackText),
                    );
                    await appendConversationLog(route, account.accountId, "out", { text: fallbackText, mediaCount: 0 });
                    recordFallbackSent();
                    routeHadDelivered = true;
                    console.warn(
                      `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId || "none"} run_timeout=${runTimedOut} superseded=${runSuperseded} drop_reason=fallback_sent_after_dispatch_error`,
                    );
                  }
                } catch (fallbackErr: any) {
                  console.warn(
                    `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=${dispatchId || "none"} run_timeout=${runTimedOut} superseded=${runSuperseded} drop_reason=fallback_send_failed error=${fallbackErr?.message || fallbackErr}`,
                  );
                }
              }
            } finally {
              if (dispatchId) clearRouteInFlight(route, dispatchId);
              const latestPending = getRoutePendingLatest(route);
              if (latestPending && latestPending.inboundSeq <= inboundSeq) {
                clearRoutePendingLatest(route);
              }
              // no explicit close: NapCat set_input_status is edge-version dependent; indicator is client-side ephemeral.
              void inputStatusOpened;
            }
          } catch (err) {
            console.error("[QQ] Critical error in message handler:", err);
          }
        });

        client.connect();
        const cleanup = () => {
          cleanupAccountRuntime(account.accountId, client);
        };
        if (abortSignal.aborted) {
          cleanup();
          return;
        }
        await new Promise<void>((resolve) => {
          abortSignal.addEventListener("abort", () => resolve(), { once: true });
        });
        cleanup();
    },
    stopAccount: async ({ accountId }) => {
        cleanupAccountRuntime(accountId);
    },
    logoutAccount: async ({ accountId, cfg }) => {
        return { loggedOut: true, cleared: true };
    }
  },
  outbound: {
    sendText: async ({ to, text, accountId, replyTo, cfg }) => {
        const client = getClientForAccount(accountId || DEFAULT_ACCOUNT_ID);
        if (!client) return { channel: "qq", sent: false, error: "Client not connected" };
        const parsed = await resolveOutboundTarget(to);
        if (!parsed) return { channel: "qq", sent: false, error: `Unknown target format: ${to}` };
        const outboundWorkspaceRoot = resolveAccountWorkspaceRoot(accountId || DEFAULT_ACCOUNT_ID);
        await ensureRouteAgentMetadata(outboundWorkspaceRoot, parsed.route, DEFAULT_ACCOUNT_ID);
        const runtime = getQQRuntime();
        const canonicalSessionKey = buildResidentSessionKey(parsed.route);
        const canonicalAgentId = routeToResidentAgentId(parsed.route);
        await migrateLegacySessionIfNeeded(runtime, cfg || {}, accountId || DEFAULT_ACCOUNT_ID, parsed.route, canonicalSessionKey, canonicalAgentId);
        const outboundConfig = (cfg?.channels?.qq?.accounts?.[accountId || DEFAULT_ACCOUNT_ID] || cfg?.channels?.qq || DEFAULT_SEND_CFG) as QQConfig;
        const normalized = normalizeReplyPayload({ text: sanitizeOutboundText(text) }, outboundConfig, {
          splitSendRequested: false,
          maxMessageLength: outboundConfig.maxMessageLength || 4000,
        });
        let replyInjected = false;

        await checkConversationPolicyHook(DEFAULT_SEND_CFG, outboundWorkspaceRoot, "beforeOutbound", parsed.route, "sendText");
        await sendTextChunks({
          chunks: normalized.textChunks,
          targetKind: parsed.kind,
          userId: parsed.kind === "user" ? parsed.userId : 0,
          enqueue: async (fn) => deliveryManager.enqueueSend(DEFAULT_SEND_CFG, fn),
          sendTextChunk: async (chunk) => {
            if (isAutomationMetaLeakText(chunk)) {
              console.log(`[QQ][outbound] route=${parsed.route} source=automation skip_reason=automation_meta_leak_guard`);
              return false;
            }
            let message: OneBotMessage | string = chunk;
            if (replyTo && !replyInjected) {
              message = [{ type: "reply", data: { id: String(replyTo) } }, { type: "text", data: { text: chunk } }];
              replyInjected = true;
            }
            await checkRouteUsageQuota(outboundWorkspaceRoot, parsed.route, "sendText");
            await deliveryManager.sendWithRetry(
              DEFAULT_SEND_CFG,
              {
                accountId: accountId || DEFAULT_ACCOUNT_ID,
                route: parsed.route,
                targetKind: parsed.kind,
                action: "send_text",
                summary: chunk,
              },
              async () => sendToParsedTarget(client, parsed, message),
            );
            return true;
          },
          onChunkSent: async (chunk) => {
            await appendConversationLog(parsed.route, accountId || DEFAULT_ACCOUNT_ID, "out", { text: chunk, mediaCount: 0 });
            await bumpRouteUsage(outboundWorkspaceRoot, parsed.route, "sendText");
          },
        });

        await sendMediaItems({
          items: normalized.mediaItems,
          route: parsed.route,
          workspaceRoot: outboundWorkspaceRoot,
          config: outboundConfig,
          conversationBaseDir: (r) => conversationBaseDir(accountId || DEFAULT_ACCOUNT_ID, r),
          enqueue: async (fn) => deliveryManager.enqueueSend(DEFAULT_SEND_CFG, fn),
          sendSegments: async (segments, mediaDedupKey) => {
            let message = segments;
            if (replyTo && !replyInjected) {
              message = [{ type: "reply", data: { id: String(replyTo) } }, ...segments];
              replyInjected = true;
            }
            await deliveryManager.sendWithRetry(
              DEFAULT_SEND_CFG,
              {
                accountId: accountId || DEFAULT_ACCOUNT_ID,
                route: parsed.route,
                targetKind: parsed.kind,
                action: "send_media",
                summary: JSON.stringify(segments).slice(0, 180),
                mediaDedupKey,
              },
              async () => sendToParsedTarget(client, parsed, message),
            );
          },
          checkBeforeOutboundMedia: async () =>
            checkConversationPolicyHook(DEFAULT_SEND_CFG, outboundWorkspaceRoot, "beforeOutbound", parsed.route, "sendMedia"),
          checkQuota: async (kind) => checkRouteUsageQuota(outboundWorkspaceRoot, parsed.route, kind === "sendVoice" ? "sendVoice" : "sendMedia"),
          canSendRecord: async () => client.canSendRecord(),
          canSendImage: async () => client.canSendImage(),
          consumeImageQuota: async () => consumeImageQuota(outboundWorkspaceRoot, parsed.route),
          onSent: async (item, persistedPath, kind) => {
            await appendConversationLog(parsed.route, accountId || DEFAULT_ACCOUNT_ID, "out", { text: item.name || item.source, mediaCount: 1, filePath: persistedPath });
            await bumpRouteUsage(outboundWorkspaceRoot, parsed.route, kind === "record" ? "sendVoice" : "sendMedia");
          },
          streamClient: client,
        });

        return { channel: "qq", sent: true };
    },
    sendMedia: async ({ to, text, mediaUrl, accountId, replyTo, cfg }) => {
         const client = getClientForAccount(accountId || DEFAULT_ACCOUNT_ID);
         if (!client) return { channel: "qq", sent: false, error: "Client not connected" };
         const parsed = await resolveOutboundTarget(to);
         if (!parsed) return { channel: "qq", sent: false, error: `Unknown target format: ${to}` };
         const outboundWorkspaceRoot = resolveAccountWorkspaceRoot(accountId || DEFAULT_ACCOUNT_ID);
         await ensureRouteAgentMetadata(outboundWorkspaceRoot, parsed.route, DEFAULT_ACCOUNT_ID);
         const runtime = getQQRuntime();
         const canonicalSessionKey = buildResidentSessionKey(parsed.route);
         const canonicalAgentId = routeToResidentAgentId(parsed.route);
         await migrateLegacySessionIfNeeded(runtime, cfg || {}, accountId || DEFAULT_ACCOUNT_ID, parsed.route, canonicalSessionKey, canonicalAgentId);
         const outboundConfig = (cfg?.channels?.qq?.accounts?.[accountId || DEFAULT_ACCOUNT_ID] || cfg?.channels?.qq || DEFAULT_SEND_CFG) as QQConfig;
         const normalized = normalizeReplyPayload(
           {
             text: sanitizeOutboundText(text || ""),
             mediaUrl,
           } as QQReplyPayload,
           outboundConfig,
           { splitSendRequested: false, maxMessageLength: outboundConfig.maxMessageLength || 4000 },
         );
         let replyInjected = false;

         await checkConversationPolicyHook(DEFAULT_SEND_CFG, outboundWorkspaceRoot, "beforeOutbound", parsed.route, "sendText");
         await sendTextChunks({
           chunks: normalized.textChunks,
           targetKind: parsed.kind,
           userId: parsed.kind === "user" ? parsed.userId : 0,
           enqueue: async (fn) => deliveryManager.enqueueSend(DEFAULT_SEND_CFG, fn),
           sendTextChunk: async (chunk) => {
             if (isAutomationMetaLeakText(chunk)) {
               console.log(`[QQ][outbound] route=${parsed.route} source=automation skip_reason=automation_meta_leak_guard`);
               return false;
             }
             let message: OneBotMessage | string = chunk;
             if (replyTo && !replyInjected) {
               message = [{ type: "reply", data: { id: String(replyTo) } }, { type: "text", data: { text: chunk } }];
               replyInjected = true;
             }
             await checkRouteUsageQuota(outboundWorkspaceRoot, parsed.route, "sendText");
             await deliveryManager.sendWithRetry(
               DEFAULT_SEND_CFG,
               {
                 accountId: accountId || DEFAULT_ACCOUNT_ID,
                 route: parsed.route,
                 targetKind: parsed.kind,
                 action: "send_text",
                 summary: chunk,
               },
               async () => sendToParsedTarget(client, parsed, message),
             );
             return true;
           },
           onChunkSent: async (chunk) => {
             await appendConversationLog(parsed.route, accountId || DEFAULT_ACCOUNT_ID, "out", { text: chunk, mediaCount: 0 });
             await bumpRouteUsage(outboundWorkspaceRoot, parsed.route, "sendText");
           },
         });

         await sendMediaItems({
           items: normalized.mediaItems,
           route: parsed.route,
           workspaceRoot: outboundWorkspaceRoot,
           config: outboundConfig,
           conversationBaseDir: (r) => conversationBaseDir(accountId || DEFAULT_ACCOUNT_ID, r),
           enqueue: async (fn) => deliveryManager.enqueueSend(DEFAULT_SEND_CFG, fn),
           sendSegments: async (segments, mediaDedupKey) => {
             let message = segments;
             if (replyTo && !replyInjected) {
               message = [{ type: "reply", data: { id: String(replyTo) } }, ...segments];
               replyInjected = true;
             }
             await deliveryManager.sendWithRetry(
               DEFAULT_SEND_CFG,
               {
                 accountId: accountId || DEFAULT_ACCOUNT_ID,
                 route: parsed.route,
                 targetKind: parsed.kind,
                 action: "send_media",
                 summary: JSON.stringify(segments).slice(0, 180),
                 mediaDedupKey,
               },
               async () => sendToParsedTarget(client, parsed, message),
             );
           },
           checkBeforeOutboundMedia: async () =>
             checkConversationPolicyHook(DEFAULT_SEND_CFG, outboundWorkspaceRoot, "beforeOutbound", parsed.route, "sendMedia"),
           checkQuota: async (kind) => checkRouteUsageQuota(outboundWorkspaceRoot, parsed.route, kind === "sendVoice" ? "sendVoice" : "sendMedia"),
           canSendRecord: async () => client.canSendRecord(),
           canSendImage: async () => client.canSendImage(),
           consumeImageQuota: async () => consumeImageQuota(outboundWorkspaceRoot, parsed.route),
           onSent: async (item, persistedPath, kind) => {
             await appendConversationLog(parsed.route, accountId || DEFAULT_ACCOUNT_ID, "out", {
               text: item.name || item.source,
               mediaCount: 1,
               filePath: persistedPath,
             });
             await bumpRouteUsage(outboundWorkspaceRoot, parsed.route, kind === "record" ? "sendVoice" : "sendMedia");
           },
           streamClient: client,
         });
         return { channel: "qq", sent: true };
    },
    // @ts-ignore
    deleteMessage: async ({ messageId, accountId }) => {
        const client = getClientForAccount(accountId || DEFAULT_ACCOUNT_ID);
        if (!client) return { channel: "qq", success: false, error: "Client not connected" };
        try { client.deleteMsg(messageId); return { channel: "qq", success: true }; }
        catch (err) { return { channel: "qq", success: false, error: String(err) }; }
    }
  },
  messaging: { 
      normalizeTarget,
      targetResolver: {
          looksLikeId: (id) => /^user:\d{5,12}$/.test(id) || /^group:\d{5,12}$/.test(id) || /^guild:[^:]+:[^:]+$/.test(id),
          hint: "user:QQ号, group:群号, guild:频道",
      }
  }
};
