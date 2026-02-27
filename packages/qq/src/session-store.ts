import { promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import type { getQQRuntime } from "./runtime.js";
import {
  OWNER_MAIN_AGENT_ID,
  getOwnerQq,
  isOwnerPrivateRoute,
  isValidQQRoute,
  routeToResidentAgentId,
} from "./routing.js";
import type { QQErrorCode } from "./types/logging.js";
import { logQQTrace } from "./diagnostics/logger.js";

export type QQRouteCapabilities = {
  sendText: boolean;
  sendMedia: boolean;
  sendVoice: boolean;
  skills: string[];
  maxSendText?: number | null;
  maxSendMedia?: number | null;
  maxSendVoice?: number | null;
};

export type QQRouteAgentMetadata = {
  agentId: string;
  route: string;
  accountId: string;
  createdAt: string;
  updatedAt: string;
  boundToMain?: boolean;
  orchestrationMode?: "dispatcher-first";
  dispatcherRules?: {
    heavyTaskDelegation: boolean;
    ackThenAsyncResult: boolean;
    idempotencyRequired: boolean;
    strictRouteIsolation: boolean;
  };
  capabilities: QQRouteCapabilities;
};

type QQConversationState = {
  affinity: number;
  mood: "neutral" | "cold" | "annoyed" | "tired";
  banterCount: number;
  lastUpdatedAt: string;
  imageWindowStartMs: number;
  imageCountInWindow: number;
};

export type QQRouteUsageStats = {
  dispatchCount: number;
  sendTextCount: number;
  sendMediaCount: number;
  sendVoiceCount: number;
  updatedAt: string;
};

export type QQProactiveState = {
  lastInboundAt: number;
  lastProactiveAt: number;
  updatedAt: string;
};

const IMAGE_QUOTA_WINDOW_MS = 2 * 60 * 60 * 1000;
const IMAGE_QUOTA_MAX = 5;

function currentOwnerQq(): string {
  return String(getOwnerQq() || "").trim();
}

function logMigrationEvent(
  event: "qq_session_migrate_start" | "qq_session_migrate_move" | "qq_session_migrate_done",
  data: Record<string, unknown>,
): void {
  const suffix = Object.entries(data)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" ");
  console.log(`[QQ][${event}] ${suffix}`);
  const route = String(data.route || "");
  if (route) {
    logQQTrace({
      event,
      route,
      source: "chat",
      ...data,
    });
  }
}

function logStoreError(errorCode: QQErrorCode, data: Record<string, unknown>): void {
  const suffix = Object.entries(data)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" ");
  console.warn(`[QQ][store-error] error_code=${errorCode} ${suffix}`);
  const route = String(data.route || "");
  if (route) {
    logQQTrace({
      event: "qq_session_migrate_done",
      route,
      source: "chat",
      materialize_error_code: errorCode,
      error: suffix,
    });
  }
}

export function routeMetadataDir(workspace: string, route: string) {
  if (!isValidQQRoute(route)) throw new Error(`Invalid QQ route: ${route}`);
  return path.join(workspace, "qq_sessions", route);
}

export function routeMetadataPath(workspace: string, route: string) {
  return path.join(routeMetadataDir(workspace, route), "agent.json");
}

function routeStatePath(workspace: string, route: string) {
  return path.join(routeMetadataDir(workspace, route), "state.json");
}

function routeUsagePath(workspace: string, route: string) {
  return path.join(routeMetadataDir(workspace, route), "usage.json");
}

function routeProactiveStatePath(workspace: string, route: string) {
  const canonical = route.replace(/[^a-zA-Z0-9:_-]/g, "_").replace(/:/g, "__");
  return path.join(workspace, "qq_sessions", canonical, "meta", "proactive-state.json");
}

function routeProactiveStatePathLegacy(workspace: string, route: string) {
  return path.join(routeMetadataDir(workspace, route), "meta", "proactive-state.json");
}

export function defaultRouteCapabilities(): QQRouteCapabilities {
  return { sendText: true, sendMedia: true, sendVoice: true, skills: [], maxSendText: null, maxSendMedia: null, maxSendVoice: null };
}

export function defaultRouteUsageStats(): QQRouteUsageStats {
  return {
    dispatchCount: 0,
    sendTextCount: 0,
    sendMediaCount: 0,
    sendVoiceCount: 0,
    updatedAt: new Date().toISOString(),
  };
}

export async function readRouteUsageStats(workspace: string, route: string): Promise<QQRouteUsageStats> {
  try {
    const raw = await fs.readFile(routeUsagePath(workspace, route), "utf8");
    const parsed = JSON.parse(raw || "{}");
    return {
      dispatchCount: Number(parsed?.dispatchCount || 0),
      sendTextCount: Number(parsed?.sendTextCount || 0),
      sendMediaCount: Number(parsed?.sendMediaCount || 0),
      sendVoiceCount: Number(parsed?.sendVoiceCount || 0),
      updatedAt: String(parsed?.updatedAt || new Date().toISOString()),
    };
  } catch {
    return defaultRouteUsageStats();
  }
}

export async function writeRouteUsageStats(workspace: string, route: string, stats: QQRouteUsageStats): Promise<void> {
  await fs.mkdir(routeMetadataDir(workspace, route), { recursive: true });
  await fs.writeFile(routeUsagePath(workspace, route), JSON.stringify(stats, null, 2), "utf8");
}

export async function bumpRouteUsage(workspace: string, route: string, kind: "dispatch" | "sendText" | "sendMedia" | "sendVoice", step = 1): Promise<void> {
  try {
    const s = await readRouteUsageStats(workspace, route);
    if (kind === "dispatch") s.dispatchCount += step;
    if (kind === "sendText") s.sendTextCount += step;
    if (kind === "sendMedia") s.sendMediaCount += step;
    if (kind === "sendVoice") s.sendVoiceCount += step;
    s.updatedAt = new Date().toISOString();
    await writeRouteUsageStats(workspace, route, s);
  } catch {
    // non-fatal
  }
}

export async function readProactiveState(workspace: string, route: string): Promise<QQProactiveState | null> {
  const readOne = async (filePath: string): Promise<QQProactiveState | null> => {
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const parsed = JSON.parse(raw || "{}");
      return {
        lastInboundAt: Number(parsed?.lastInboundAt || 0),
        lastProactiveAt: Number(parsed?.lastProactiveAt || 0),
        updatedAt: String(parsed?.updatedAt || new Date().toISOString()),
      };
    } catch {
      return null;
    }
  };
  const canonical = await readOne(routeProactiveStatePath(workspace, route));
  if (canonical) return canonical;
  const legacy = await readOne(routeProactiveStatePathLegacy(workspace, route));
  if (legacy) return legacy;
  return null;
}

export async function writeProactiveState(workspace: string, route: string, state: QQProactiveState): Promise<void> {
  const payload = JSON.stringify(
    {
      lastInboundAt: Number(state.lastInboundAt || 0),
      lastProactiveAt: Number(state.lastProactiveAt || 0),
      updatedAt: String(state.updatedAt || new Date().toISOString()),
    },
    null,
    2,
  );
  const writeOne = async (filePath: string): Promise<void> => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, payload, "utf8");
  };
  try {
    await writeOne(routeProactiveStatePath(workspace, route));
  } finally {
    // Compatibility period: keep legacy path in sync.
    try {
      await writeOne(routeProactiveStatePathLegacy(workspace, route));
    } catch {
      // non-fatal
    }
  }
}

function defaultConversationState(): QQConversationState {
  return {
    affinity: 0,
    mood: "neutral",
    banterCount: 0,
    lastUpdatedAt: new Date().toISOString(),
    imageWindowStartMs: Date.now(),
    imageCountInWindow: 0,
  };
}

async function readConversationState(workspace: string, route: string): Promise<QQConversationState> {
  try {
    const raw = await fs.readFile(routeStatePath(workspace, route), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaultConversationState();
    return {
      affinity: Number(parsed.affinity ?? 0),
      mood: ["neutral", "cold", "annoyed", "tired"].includes(parsed.mood) ? parsed.mood : "neutral",
      banterCount: Number(parsed.banterCount ?? 0),
      lastUpdatedAt: String(parsed.lastUpdatedAt || new Date().toISOString()),
      imageWindowStartMs: Number(parsed.imageWindowStartMs || Date.now()),
      imageCountInWindow: Number(parsed.imageCountInWindow || 0),
    };
  } catch {
    return defaultConversationState();
  }
}

async function writeConversationState(workspace: string, route: string, state: QQConversationState): Promise<void> {
  await fs.mkdir(routeMetadataDir(workspace, route), { recursive: true });
  await fs.writeFile(routeStatePath(workspace, route), JSON.stringify(state, null, 2), "utf8");
}

function hasBanterSignal(text: string): boolean {
  const t = (text || "").toLowerCase();
  return ["抬杠", "阴阳怪气", "你行你上", "你不行", "呵呵", "笑死", "急了", "嘴硬", "杠精"].some((k) => t.includes(k));
}

export async function updateConversationStateOnInbound(workspace: string, route: string, text: string): Promise<QQConversationState> {
  const state = await readConversationState(workspace, route);
  const now = Date.now();
  if (now - state.imageWindowStartMs >= IMAGE_QUOTA_WINDOW_MS) {
    state.imageWindowStartMs = now;
    state.imageCountInWindow = 0;
  }
  if (hasBanterSignal(text)) {
    state.banterCount += 1;
    state.affinity = Math.max(-100, state.affinity - 8);
  } else {
    state.banterCount = Math.max(0, state.banterCount - 1);
    state.affinity = Math.min(100, state.affinity + 1);
  }
  if (state.banterCount >= 4) state.mood = "tired";
  else if (state.banterCount >= 2) state.mood = "annoyed";
  else if (state.affinity < -20) state.mood = "cold";
  else state.mood = "neutral";
  state.lastUpdatedAt = new Date().toISOString();
  await writeConversationState(workspace, route, state);
  return state;
}

export async function consumeImageQuota(workspace: string, route: string): Promise<void> {
  const state = await readConversationState(workspace, route);
  const now = Date.now();
  if (now - state.imageWindowStartMs >= IMAGE_QUOTA_WINDOW_MS) {
    state.imageWindowStartMs = now;
    state.imageCountInWindow = 0;
  }
  if (state.imageCountInWindow >= IMAGE_QUOTA_MAX) {
    const mins = Math.max(1, Math.ceil((IMAGE_QUOTA_WINDOW_MS - (now - state.imageWindowStartMs)) / 60000));
    throw new Error(`该会话图片额度已用完（2小时最多${IMAGE_QUOTA_MAX}张），请约 ${mins} 分钟后再试`);
  }
  state.imageCountInWindow += 1;
  state.lastUpdatedAt = new Date().toISOString();
  await writeConversationState(workspace, route, state);
}

function normalizeCapabilities(input: any): QQRouteCapabilities {
  const toLimit = (v: any): number | null => {
    if (v === null || v === undefined || v === "" || String(v).toLowerCase() === "off") return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return Math.floor(n);
  };
  return {
    sendText: input?.sendText !== false,
    sendMedia: Boolean(input?.sendMedia),
    sendVoice: Boolean(input?.sendVoice),
    skills: Array.isArray(input?.skills) ? input.skills.map((s: any) => String(s)) : [],
    maxSendText: toLimit(input?.maxSendText),
    maxSendMedia: toLimit(input?.maxSendMedia),
    maxSendVoice: toLimit(input?.maxSendVoice),
  };
}

export async function readRouteAgentMetadata(workspace: string, route: string): Promise<QQRouteAgentMetadata | null> {
  try {
    const raw = await fs.readFile(routeMetadataPath(workspace, route), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const resolvedRoute = String(parsed.route || route);
    if (!isValidQQRoute(resolvedRoute)) return null;
    const shouldBindToMain = isOwnerPrivateRoute(resolvedRoute) || Boolean(parsed.boundToMain);
    let agentId = typeof parsed.agentId === "string" && parsed.agentId.trim() ? parsed.agentId : routeToResidentAgentId(resolvedRoute);
    if (shouldBindToMain) agentId = OWNER_MAIN_AGENT_ID;
    return {
      agentId,
      route: resolvedRoute,
      accountId: String(parsed.accountId || DEFAULT_ACCOUNT_ID),
      createdAt: String(parsed.createdAt || new Date().toISOString()),
      updatedAt: String(parsed.updatedAt || new Date().toISOString()),
      boundToMain: shouldBindToMain || undefined,
      orchestrationMode: "dispatcher-first",
      dispatcherRules: {
        heavyTaskDelegation: parsed?.dispatcherRules?.heavyTaskDelegation !== false,
        ackThenAsyncResult: parsed?.dispatcherRules?.ackThenAsyncResult !== false,
        idempotencyRequired: parsed?.dispatcherRules?.idempotencyRequired !== false,
        strictRouteIsolation: parsed?.dispatcherRules?.strictRouteIsolation !== false,
      },
      capabilities: normalizeCapabilities(parsed.capabilities),
    };
  } catch {
    return null;
  }
}

export async function writeRouteAgentMetadata(workspace: string, route: string, meta: QQRouteAgentMetadata): Promise<void> {
  const dir = routeMetadataDir(workspace, route);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(routeMetadataPath(workspace, route), JSON.stringify(meta, null, 2), "utf8");
}

export async function readRouteCapabilityPolicy(workspace: string, route: string): Promise<QQRouteCapabilities> {
  const meta = await readRouteAgentMetadata(workspace, route);
  return meta?.capabilities || defaultRouteCapabilities();
}

export async function writeRouteCapabilityPolicy(workspace: string, route: string, capabilities: QQRouteCapabilities): Promise<QQRouteCapabilities> {
  const now = new Date().toISOString();
  const existing = await readRouteAgentMetadata(workspace, route);
  const ownerRoute = isOwnerPrivateRoute(route);
  const meta: QQRouteAgentMetadata = {
    agentId: ownerRoute ? OWNER_MAIN_AGENT_ID : (existing?.agentId || routeToResidentAgentId(route)),
    route,
    accountId: existing?.accountId || DEFAULT_ACCOUNT_ID,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    boundToMain: ownerRoute ? true : (existing?.boundToMain || undefined),
    orchestrationMode: "dispatcher-first",
    dispatcherRules: {
      heavyTaskDelegation: true,
      ackThenAsyncResult: true,
      idempotencyRequired: true,
      strictRouteIsolation: true,
    },
    capabilities: ownerRoute ? { sendText: true, sendMedia: true, sendVoice: true, skills: [], maxSendText: null, maxSendMedia: null, maxSendVoice: null } : normalizeCapabilities(capabilities),
  };
  await writeRouteAgentMetadata(workspace, route, meta);
  return meta.capabilities;
}

export async function ensureRouteAgentMetadata(workspace: string, route: string, accountId: string): Promise<QQRouteAgentMetadata> {
  const now = new Date().toISOString();
  const existing = await readRouteAgentMetadata(workspace, route);
  const ownerRoute = isOwnerPrivateRoute(route);
  const meta: QQRouteAgentMetadata = {
    agentId: ownerRoute ? OWNER_MAIN_AGENT_ID : (existing?.agentId || routeToResidentAgentId(route)),
    route,
    accountId: existing?.accountId || accountId || DEFAULT_ACCOUNT_ID,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    boundToMain: ownerRoute ? true : (existing?.boundToMain || undefined),
    orchestrationMode: "dispatcher-first",
    dispatcherRules: {
      heavyTaskDelegation: true,
      ackThenAsyncResult: true,
      idempotencyRequired: true,
      strictRouteIsolation: true,
    },
    capabilities: ownerRoute ? { sendText: true, sendMedia: true, sendVoice: true, skills: [], maxSendText: null, maxSendMedia: null, maxSendVoice: null } : (existing?.capabilities || defaultRouteCapabilities()),
  };
  await writeRouteAgentMetadata(workspace, route, meta);
  return meta;
}

function legacyQQSessionKeys(route: string, accountId: string): string[] {
  const keys = new Set<string>();
  const residentAgentId = routeToResidentAgentId(route);
  keys.add(`qq:${accountId}:${route}`);
  keys.add(`qq:${DEFAULT_ACCOUNT_ID}:${route}`);
  keys.add(`agent:main:qq:default:${route}`);
  keys.add(`agent:default:qq:default:${route}`);
  keys.add(`agent:main:qq:${route}`);
  keys.add(`agent:default:qq:${route}`);
  keys.add(`agent:${residentAgentId}:qq:default:${route}`);
  keys.add(`agent:${residentAgentId}:qq:${route}`);
  const userMatch = route.match(/^user:(\d{5,12})$/);
  if (userMatch) {
    keys.add(`agent:main:qq:${userMatch[1]}`);
    keys.add(`agent:main:qq:group:${userMatch[1]}`);
    keys.add(`agent:default:qq:group:${userMatch[1]}`);
  }
  if (isOwnerPrivateRoute(route)) {
    keys.add(`agent:qq-user-${currentOwnerQq()}:qq:default:${route}`);
    keys.add(`agent:qq-user-${currentOwnerQq()}:qq:${route}`);
    keys.add(`agent:qq-user-${currentOwnerQq()}:qq:${currentOwnerQq()}`);
    keys.add(`agent:qq-user-${currentOwnerQq()}:qq:user:${currentOwnerQq()}`);
    keys.add(`agent:main:qq:group:${currentOwnerQq()}`);
    keys.add(`agent:default:qq:group:${currentOwnerQq()}`);
  }
  return Array.from(keys);
}

async function readSessionsJson(filePath: string): Promise<Record<string, any>> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const json = JSON.parse(raw);
    if (json && typeof json === "object" && !Array.isArray(json)) return json;
  } catch (err: any) {
    if (String(err?.code || "") !== "ENOENT") {
      logStoreError("migration_io_failed", {
        file: filePath,
        reason: "read_sessions_json_failed",
        error: String(err?.message || err),
      });
    }
  }
  return {};
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw || "null") as T | null;
  } catch {
    return null;
  }
}

async function writeSessionsJson(filePath: string, data: Record<string, any>): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
}

function normalizeSessionStoreDir(storePath: string): string {
  const normalized = String(storePath || "").trim();
  if (!normalized) return normalized;
  if (path.basename(normalized) === "sessions.json") return path.dirname(normalized);
  return normalized;
}

function sessionsJsonPathFromStore(storePath: string): string {
  return path.join(normalizeSessionStoreDir(storePath), "sessions.json");
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function scrubQQLegacySessionKeys(runtime: ReturnType<typeof getQQRuntime>, cfg: any, keys: string[]) {
  if (!keys.length) return;
  const stores = [
    runtime.channel.session.resolveStorePath(cfg.session?.store, { agentId: "main" }),
    runtime.channel.session.resolveStorePath(cfg.session?.store, { agentId: "default" }),
  ];
  for (const storePath of Array.from(new Set(stores))) {
    const sessionsPath = sessionsJsonPathFromStore(storePath);
    const sessions = await readSessionsJson(sessionsPath);
    let changed = false;
    for (const k of keys) {
      if (k in sessions) {
        delete sessions[k];
        changed = true;
      }
    }
    if (changed) await writeSessionsJson(sessionsPath, sessions);
  }
}

async function hasAnyLegacySessionKey(
  runtime: ReturnType<typeof getQQRuntime>,
  cfg: any,
  route: string,
  accountId: string,
  agentId: string,
): Promise<boolean> {
  const stores = [
    runtime.channel.session.resolveStorePath(cfg.session?.store, { agentId }),
    runtime.channel.session.resolveStorePath(cfg.session?.store, { agentId: "default" }),
    runtime.channel.session.resolveStorePath(cfg.session?.store, { agentId: "main" }),
  ];
  if (isOwnerPrivateRoute(route)) {
    stores.push(runtime.channel.session.resolveStorePath(cfg.session?.store, { agentId: `qq-user-${currentOwnerQq()}` }));
  }
  const oldKeys = legacyQQSessionKeys(route, accountId);
  for (const storePath of Array.from(new Set(stores))) {
    const sessionsPath = sessionsJsonPathFromStore(storePath);
    const sessions = await readSessionsJson(sessionsPath);
    for (const oldKey of oldKeys) {
      if (oldKey in sessions) return true;
    }
  }
  return false;
}

export async function migrateLegacySessionIfNeeded(
  runtime: ReturnType<typeof getQQRuntime>,
  cfg: any,
  accountId: string,
  route: string,
  sessionKey: string,
  agentId: string
) {
  const newStorePath = runtime.channel.session.resolveStorePath(cfg.session?.store, { agentId });
  const newStore = normalizeSessionStoreDir(newStorePath);
  const markerDir = path.join(newStore, ".qq_route_migrations");
  const markerPath = path.join(markerDir, `${encodeURIComponent(route)}.json`);
  if (await pathExists(markerPath)) {
    const marker = await readJson<{ sessionKey?: string; agentId?: string }>(markerPath);
    if (marker?.sessionKey === sessionKey && marker?.agentId === agentId) {
      const hasLegacy = await hasAnyLegacySessionKey(runtime, cfg, route, accountId, agentId);
      if (!hasLegacy) return;
    }
  }
  const legacyStores = [
    runtime.channel.session.resolveStorePath(cfg.session?.store, { agentId: "default" }),
    runtime.channel.session.resolveStorePath(cfg.session?.store, { agentId: "main" }),
  ];
  if (isOwnerPrivateRoute(route)) {
    legacyStores.push(runtime.channel.session.resolveStorePath(cfg.session?.store, { agentId: `qq-user-${currentOwnerQq()}` }));
  }
  const stores = Array.from(new Set([newStore, ...legacyStores]));
  const oldKeys = legacyQQSessionKeys(route, accountId);
  logMigrationEvent("qq_session_migrate_start", {
    route,
    account_id: accountId,
    new_session_key: sessionKey,
    old_keys_found: oldKeys.length,
  });
  let migratedValue: any = null;
  let moved = 0;
  const backups = new Map<string, string>();

  const backupSessionsFile = async (sessionsPath: string, sessions: Record<string, any>): Promise<void> => {
    if (backups.has(sessionsPath)) return;
    const backupPath = `${sessionsPath}.bak-main-unify-${Date.now()}`;
    await fs.mkdir(path.dirname(sessionsPath), { recursive: true });
    await fs.writeFile(backupPath, JSON.stringify(sessions, null, 2), "utf8");
    backups.set(sessionsPath, backupPath);
  };

  const rollbackFromBackup = async (): Promise<void> => {
    for (const [sessionsPath, backupPath] of backups.entries()) {
      try {
        const raw = await fs.readFile(backupPath, "utf8");
        await fs.writeFile(sessionsPath, raw, "utf8");
      } catch (err: any) {
        logStoreError("migration_io_failed", {
          route,
          file: sessionsPath,
          reason: "rollback_failed",
          error: String(err?.message || err),
        });
      }
    }
  };

  for (const storePath of stores) {
    const sessionsPath = sessionsJsonPathFromStore(storePath);
    const sessions = await readSessionsJson(sessionsPath);
    const sessionsBefore = JSON.parse(JSON.stringify(sessions || {}));
    let changed = false;
    for (const oldKey of oldKeys) {
      if (!(oldKey in sessions)) continue;
      if (migratedValue === null) migratedValue = sessions[oldKey];
      delete sessions[oldKey];
      changed = true;
      moved += 1;
      logMigrationEvent("qq_session_migrate_move", {
        route,
        old_key: oldKey,
        new_session_key: sessionKey,
        store: sessionsPath,
      });
    }
    if (changed) {
      try {
        await backupSessionsFile(sessionsPath, sessionsBefore);
        await writeSessionsJson(sessionsPath, sessions);
      } catch (err: any) {
        logStoreError("migration_io_failed", {
          route,
          file: sessionsPath,
          reason: "write_store_failed",
          error: String(err?.message || err),
        });
        await rollbackFromBackup();
        return;
      }
    }
  }

  if (migratedValue !== null) {
    const newSessionsPath = sessionsJsonPathFromStore(newStore);
    const newSessions = await readSessionsJson(newSessionsPath);
    if (!newSessions[sessionKey]) {
      const before = JSON.parse(JSON.stringify(newSessions || {}));
      newSessions[sessionKey] = migratedValue;
      try {
        await backupSessionsFile(newSessionsPath, before);
        await writeSessionsJson(newSessionsPath, newSessions);
      } catch (err: any) {
        logStoreError("migration_io_failed", {
          route,
          file: newSessionsPath,
          reason: "write_target_failed",
          error: String(err?.message || err),
        });
        await rollbackFromBackup();
        return;
      }
    }
  }

  if (isOwnerPrivateRoute(route)) {
    await scrubQQLegacySessionKeys(runtime, cfg, [
      `agent:main:qq:group:${currentOwnerQq()}`,
      `agent:default:qq:group:${currentOwnerQq()}`,
    ]);
  }

  try {
    await fs.mkdir(markerDir, { recursive: true });
    await fs.writeFile(
      markerPath,
      JSON.stringify(
        {
          route,
          accountId,
          sessionKey,
          agentId,
          migratedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
  } catch {
    logStoreError("migration_io_failed", {
      route,
      file: markerPath,
      reason: "write_marker_failed",
    });
  }

  if (migratedValue !== null) {
    try {
      const newSessionsPath = sessionsJsonPathFromStore(newStore);
      const newSessions = await readSessionsJson(newSessionsPath);
      if (!(sessionKey in newSessions)) {
        await rollbackFromBackup();
        logMigrationEvent("qq_session_migrate_done", {
          route,
          moved,
          skipped_reason: "target_missing_after_migration_rollback",
          new_session_key: sessionKey,
        });
        return;
      }
    } catch (err: any) {
      await rollbackFromBackup();
      logStoreError("migration_io_failed", {
        route,
        reason: "post_migration_validation_failed",
        error: String(err?.message || err),
      });
      return;
    }
  }

  logMigrationEvent("qq_session_migrate_done", {
    route,
    moved,
    skipped_reason: moved > 0 ? "" : "no_legacy_keys_found",
    new_session_key: sessionKey,
  });
}
