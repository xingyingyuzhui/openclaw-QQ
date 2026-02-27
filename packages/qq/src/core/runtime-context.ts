import { promises as fs } from "node:fs";
import path from "node:path";
import type { RouteInFlightState } from "../types/media.js";

export type QQRuntimeContext = {
  workspaceRoot: string;
  accountId: string;
  route?: string;
};

export type ConversationLogData = {
  messageId?: string | number | null;
  text?: string;
  mediaCount?: number;
  filePath?: string;
  mediaItemsTotal?: number;
  mediaItemsMaterialized?: number;
  mediaItemsUnresolved?: number;
  unresolvedReasons?: string[];
};

export type RoutePendingLatestState = {
  route: string;
  msgId: string;
  inboundSeq: number;
  hasInboundMediaLike: boolean;
  updatedAt: number;
};

const routeInflightMap = new Map<string, RouteInFlightState>();
const routeDispatchSeq = new Map<string, number>();
const routeLastTimeoutAt = new Map<string, number>();
const routePendingLatestMap = new Map<string, RoutePendingLatestState>();

export function routeDirName(route: string): string {
  return route.replace(/[^a-zA-Z0-9:_-]/g, "_").replace(/:/g, "__");
}

export function conversationBaseDir(workspaceRoot: string, route: string): string {
  return path.join(workspaceRoot, "qq_sessions", routeDirName(route));
}

export function nextDispatchId(route: string): string {
  const next = (routeDispatchSeq.get(route) || 0) + 1;
  routeDispatchSeq.set(route, next);
  return `${route}:${next}:${Date.now()}`;
}

export function beginRouteInFlight(params: {
  route: string;
  msgId: string;
  dispatchId?: string;
}): {
  current: RouteInFlightState;
  previous?: RouteInFlightState;
} {
  const dispatchId = params.dispatchId || nextDispatchId(params.route);
  const current: RouteInFlightState = {
    route: params.route,
    dispatchId,
    msgId: params.msgId,
    startedAt: Date.now(),
    abortController: new AbortController(),
  };
  const previous = routeInflightMap.get(params.route);
  routeInflightMap.set(params.route, current);
  return previous ? { current, previous } : { current };
}

export function getRouteInFlight(route: string): RouteInFlightState | undefined {
  return routeInflightMap.get(route);
}

export function clearRouteInFlight(route: string, dispatchId?: string): boolean {
  if (!dispatchId) return routeInflightMap.delete(route);
  const current = routeInflightMap.get(route);
  if (!current || current.dispatchId !== dispatchId) return false;
  routeInflightMap.delete(route);
  return true;
}

export function hasRouteInFlight(route: string): boolean {
  return routeInflightMap.has(route);
}

export function upsertRoutePendingLatest(params: {
  route: string;
  msgId: string;
  inboundSeq: number;
  hasInboundMediaLike: boolean;
}): RoutePendingLatestState {
  const state: RoutePendingLatestState = {
    route: params.route,
    msgId: params.msgId,
    inboundSeq: params.inboundSeq,
    hasInboundMediaLike: params.hasInboundMediaLike,
    updatedAt: Date.now(),
  };
  routePendingLatestMap.set(params.route, state);
  return state;
}

export function getRoutePendingLatest(route: string): RoutePendingLatestState | undefined {
  return routePendingLatestMap.get(route);
}

export function claimRoutePendingLatest(route: string, inboundSeq: number): boolean {
  const state = routePendingLatestMap.get(route);
  if (!state) return false;
  if (state.inboundSeq !== inboundSeq) return false;
  routePendingLatestMap.delete(route);
  return true;
}

export function clearRoutePendingLatest(route: string): boolean {
  return routePendingLatestMap.delete(route);
}

export function markRouteDispatchTimeout(route: string): void {
  routeLastTimeoutAt.set(route, Date.now());
}

export function routeHadRecentTimeout(route: string, windowMs = 120000): boolean {
  const ts = routeLastTimeoutAt.get(route);
  return typeof ts === "number" && Date.now() - ts <= Math.max(1000, windowMs);
}

export async function appendConversationLog(params: {
  workspaceRoot: string;
  route: string;
  accountId: string;
  direction: "in" | "out";
  data: ConversationLogData;
  summarizeText: (text?: string) => string;
}) {
  const { workspaceRoot, route, accountId, direction, data, summarizeText } = params;
  try {
    const base = conversationBaseDir(workspaceRoot, route);
    await fs.mkdir(path.join(base, "in"), { recursive: true });
    await fs.mkdir(path.join(base, "out"), { recursive: true });
    await fs.mkdir(path.join(base, "logs"), { recursive: true });
    await fs.mkdir(path.join(base, "memory"), { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const line = JSON.stringify({
      ts: Date.now(),
      direction,
      accountId,
      route,
      messageId: data.messageId ?? null,
      textSummary: summarizeText(data.text),
      mediaCount: data.mediaCount ?? 0,
      filePath: data.filePath || null,
      mediaItemsTotal: data.mediaItemsTotal ?? 0,
      mediaItemsMaterialized: data.mediaItemsMaterialized ?? 0,
      mediaItemsUnresolved: data.mediaItemsUnresolved ?? 0,
      unresolvedReasons: data.unresolvedReasons ?? [],
    }) + "\n";
    await fs.appendFile(path.join(base, "logs", `chat-${day}.ndjson`), line, "utf8");
  } catch (err) {
    console.warn("[QQ] appendConversationLog failed:", err);
  }
}
