import { promises as fs } from "node:fs";
import path from "node:path";
import type { QQConfig } from "../config.js";

function normalizePathPrefix(input: string): string {
  const p = path.resolve(String(input || "").trim());
  return p.endsWith(path.sep) ? p : `${p}${path.sep}`;
}

export function computeMediaPathAllowlist(workspaceRoot: string, config: QQConfig): string[] {
  const configured = Array.isArray(config.mediaPathAllowlist)
    ? config.mediaPathAllowlist.map((v) => String(v || "").trim()).filter(Boolean)
    : [];
  const defaults = [
    workspaceRoot,
    path.join(workspaceRoot, "skills"),
    path.join(workspaceRoot, "qq_sessions"),
  ];
  const voiceBase = String(config.voiceBasePath || "").trim();
  if (voiceBase) defaults.push(voiceBase);
  const out = new Set<string>();
  for (const item of [...defaults, ...configured]) out.add(normalizePathPrefix(item));
  return Array.from(out);
}

export async function enforceMediaPathPolicy(filePath: string, workspaceRoot: string, config: QQConfig): Promise<{ allowed: boolean; realPath?: string; denyReason?: string; }> {
  try {
    const real = await fs.realpath(filePath);
    const normalized = normalizePathPrefix(real).slice(0, -1);
    const allowedPrefixes = computeMediaPathAllowlist(workspaceRoot, config);
    const ok = allowedPrefixes.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix));
    if (!ok) return { allowed: false, realPath: real, denyReason: "path_outside_allowlist" };
    return { allowed: true, realPath: real };
  } catch (err: any) {
    return { allowed: false, denyReason: `path_policy_error:${err?.message || err}` };
  }
}
