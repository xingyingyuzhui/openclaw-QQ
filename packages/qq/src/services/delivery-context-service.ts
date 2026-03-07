import { promises as fs } from "node:fs";
import path from "node:path";
import { buildResidentSessionKey } from "../routing.js";

async function readSessionsJson(filePath: string): Promise<Record<string, any>> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const json = JSON.parse(raw);
    if (json && typeof json === "object" && !Array.isArray(json)) return json;
  } catch {}
  return {};
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

export async function repairRouteDeliveryContext(params: {
  resolveStorePath?: (storeCfg: any, scope: { agentId: string }) => string;
  sessionStoreCfg: any;
  route: string;
  agentId: string;
  accountId?: string;
}): Promise<boolean> {
  const { resolveStorePath, sessionStoreCfg, route, agentId } = params;
  if (typeof resolveStorePath !== "function") return false;
  const accountId = String(params.accountId || "default");
  const sessionKey = buildResidentSessionKey(route);
  const stores = [
    resolveStorePath(sessionStoreCfg, { agentId }),
    resolveStorePath(sessionStoreCfg, { agentId: "default" }),
    resolveStorePath(sessionStoreCfg, { agentId: "main" }),
  ];
  let updated = false;
  for (const storePath of Array.from(new Set(stores.filter(Boolean)))) {
    const sessionsPath = sessionsJsonPathFromStore(storePath);
    const sessions = await readSessionsJson(sessionsPath);
    const existing = sessions?.[sessionKey];
    if (!existing || typeof existing !== "object") continue;
    sessions[sessionKey] = {
      ...existing,
      deliveryContext: {
        channel: "qq",
        to: route,
        accountId,
      },
      lastChannel: "qq",
      lastTo: route,
    };
    await writeSessionsJson(sessionsPath, sessions);
    updated = true;
  }
  return updated;
}
