import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { AutomationRecord, RouteRecentTimes } from "./target-config.js";
import { routeToSessionKey } from "./target-config.js";
import { resolveWorkspaceForAgent } from "./route-agent-resolver.js";

export function routeMetaDir(workspaceRoot: string, route: string): string {
  const direct = path.join(workspaceRoot, "qq_sessions", route);
  const canonical = path.join(workspaceRoot, "qq_sessions", routeToSessionKey(route));
  const routeDir = existsSync(direct) ? direct : canonical;
  return path.join(routeDir, "meta");
}

export function routeLogsDir(workspaceRoot: string, route: string): string {
  const direct = path.join(workspaceRoot, "qq_sessions", route);
  const canonical = path.join(workspaceRoot, "qq_sessions", routeToSessionKey(route));
  return path.join(existsSync(direct) ? direct : canonical, "logs");
}

export function statePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, "qq_sessions", ".qq-automation", "reconcile-state.json");
}

export async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

export async function appendRouteState(workspaceRoot: string, route: string, record: AutomationRecord): Promise<void> {
  const metaDir = routeMetaDir(workspaceRoot, route);
  await fs.mkdir(metaDir, { recursive: true });
  await fs.writeFile(path.join(metaDir, "automation-latest.json"), JSON.stringify(record, null, 2), "utf8");
  await fs.appendFile(path.join(metaDir, "automation-state.ndjson"), `${JSON.stringify(record)}\n`, "utf8");
}

export async function readRecentRouteTimes(workspaceRoot: string, route: string): Promise<RouteRecentTimes> {
  let lastInboundAtMs = 0;
  let lastOutboundAtMs = 0;

  const directLogs = path.join(workspaceRoot, "qq_sessions", route, "logs");
  const canonicalLogs = path.join(workspaceRoot, "qq_sessions", routeToSessionKey(route), "logs");
  const candidates = Array.from(new Set([directLogs, canonicalLogs, routeLogsDir(workspaceRoot, route)]));

  for (const logsDir of candidates) {
    let files: string[] = [];
    try {
      files = (await fs.readdir(logsDir))
        .filter((f) => /^chat-\d{4}-\d{2}-\d{2}\.ndjson$/.test(f))
        .sort();
    } catch {
      continue;
    }
    if (files.length === 0) continue;
    const latest = files.slice(-2);
    for (const file of latest) {
      const raw = await fs.readFile(path.join(logsDir, file), "utf8").catch(() => "");
      if (!raw) continue;
      const lines = raw.trim().split("\n").slice(-400);
      for (const line of lines) {
        try {
          const rec = JSON.parse(line) as { ts?: number; direction?: string };
          const ts = Number(rec?.ts || 0);
          if (!ts) continue;
          if (rec.direction === "in") lastInboundAtMs = Math.max(lastInboundAtMs, ts);
          if (rec.direction === "out") lastOutboundAtMs = Math.max(lastOutboundAtMs, ts);
        } catch {
          continue;
        }
      }
    }
  }
  return { lastInboundAtMs, lastOutboundAtMs };
}

export async function bumpAutomationRelationshipState(params: {
  workspaceRoot: string;
  agentId: string;
  route: string;
}): Promise<void> {
  const agentWorkspace = resolveWorkspaceForAgent(params.workspaceRoot, params.agentId);
  const relationshipPath = path.join(agentWorkspace, "runtime", "relationship.json");
  let current: any = null;
  try {
    current = JSON.parse(await fs.readFile(relationshipPath, "utf8") || "{}");
  } catch {
    return;
  }
  const affinity = Math.max(0, Math.min(100, Number(current?.affinity || 50) + 1));
  const trust = Math.max(0, Math.min(100, Number(current?.trust || 50) + 1));
  const stage = affinity >= 85 ? "devoted" : affinity >= 65 ? "close" : affinity >= 40 ? "familiar" : "distant";
  const initiative =
    String(current?.initiative_level || "medium") === "low" && affinity >= 60 ? "medium" : String(current?.initiative_level || "medium");
  const next = {
    ...current,
    affinity,
    trust,
    affinity_stage: stage,
    initiative_level: initiative,
    updated_at: new Date().toISOString(),
  };
  await fs.mkdir(path.dirname(relationshipPath), { recursive: true });
  await fs.writeFile(relationshipPath, JSON.stringify(next, null, 2), "utf8");
}
