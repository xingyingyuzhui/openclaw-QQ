import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { QQConfig } from "../config.js";
import { buildRelaySignedUrl } from "../media-relay.js";
import { enforceMediaPathPolicy } from "./path-policy.js";
import {
  isBase64Like,
  isDataUriLike,
  isHttpLike,
  sleep,
} from "./common.js";

export async function buildMediaDedupKey(
  route: string,
  persistedPath: string,
  kind: "image" | "audio" | "video" | "file",
): Promise<string> {
  try {
    const st = await fs.stat(persistedPath);
    return `${route}|${kind}|${path.basename(persistedPath)}|${st.size}|${Math.floor(st.mtimeMs)}`;
  } catch {
    return `${route}|${kind}|${path.basename(persistedPath || "unknown")}`;
  }
}

function buildMediaProxyUrl(mediaUrl: string, config: QQConfig): string {
  const enabled = config.mediaProxyEnabled === true;
  const baseRaw = String((config as any).mediaProxyBaseUrl || config.publicBaseUrl || "").trim();
  const baseUrl = baseRaw.replace(/\/+$/, "");
  const proxyable = isHttpLike(mediaUrl) || /^file:\/\//i.test(String(mediaUrl || ""));
  if (!enabled || !baseUrl || !proxyable) return mediaUrl;
  const proxyPath = String(config.mediaProxyPath || "/qq/media").trim() || "/qq/media";
  const key = String(config.mediaProxyToken || "").trim() || "openclaw-qq-relay";
  return buildRelaySignedUrl(mediaUrl, baseUrl, proxyPath, key, Number((config as any).mediaProxyTtlSec || 300));
}

function resolveVoiceMediaUrl(mediaUrl: string, config: QQConfig): string {
  const raw = String(mediaUrl || "").trim();
  if (!raw) return raw;
  if (isHttpLike(raw) || isBase64Like(raw) || isDataUriLike(raw) || raw.startsWith("/")) return raw;
  const voiceBase = String(config.voiceBasePath || "").trim();
  if (!voiceBase) return raw;
  return path.join(voiceBase, raw.replace(/^\.\/?/, ""));
}

function normalizeLocalPathCandidate(raw: string): string {
  const v = String(raw || "").trim();
  if (!v) return "";
  if (v.startsWith("file:")) {
    try {
      return fileURLToPath(v);
    } catch {
      return "";
    }
  }
  if (isHttpLike(v) || isBase64Like(v) || isDataUriLike(v)) return "";
  return v;
}

function mediaLocalPathCandidates(workspaceRoot: string, route: string, localRaw: string): string[] {
  if (!localRaw) return [];
  if (path.isAbsolute(localRaw)) return [localRaw];
  const out = new Set<string>();
  out.add(path.join(workspaceRoot, localRaw));
  const workspaceParent = path.dirname(path.resolve(workspaceRoot));
  const routeSlug = String(route || "").replace(/[^\w-]+/g, "-");
  out.add(path.join(workspaceParent, `workspace-qq-${routeSlug}`, localRaw));
  return Array.from(out);
}

export async function persistOutboundLocalMedia(
  workspaceRoot: string,
  conversationBaseDir: (route: string) => string,
  route: string,
  mediaUrl: string,
  preferredName?: string,
): Promise<string> {
  const localRaw = normalizeLocalPathCandidate(mediaUrl);
  if (!localRaw) return mediaUrl;
  for (const candidate of mediaLocalPathCandidates(workspaceRoot, route, localRaw)) {
    try {
      const st = await fs.stat(candidate);
      if (!st.isFile() || st.size <= 0) continue;
      const outDir = path.join(conversationBaseDir(route), "out", "files");
      await fs.mkdir(outDir, { recursive: true });
      const name = (preferredName || path.basename(candidate) || "file.bin").replace(/[^\p{L}\p{N}._-]/gu, "_");
      const outPath = path.join(outDir, `${Date.now()}-${name}`);
      await fs.copyFile(candidate, outPath);
      return outPath;
    } catch (err: any) {
      console.warn(
        `[QQ][media] error_code=migration_io_failed route=${route} source=${mediaUrl} candidate=${candidate} action=persist_outbound_local_media error=${err?.message || err}`,
      );
    }
  }
  return mediaUrl;
}

function shouldCleanupGeneratedOutboundSource(workspaceRoot: string, candidate: string): boolean {
  const resolved = path.resolve(candidate);
  const workspaceResolved = path.resolve(workspaceRoot);
  const base = path.basename(resolved).toLowerCase();
  const isVoiceLike = /^voice-[^/]+\.(wav|mp3|m4a|ogg|amr)$/i.test(base);
  if (!isVoiceLike) return false;
  const inWorkspaceRoot = path.dirname(resolved) === workspaceResolved;
  const inWorkspaceTmp = resolved.startsWith(path.join(workspaceResolved, "tmp") + path.sep);
  return inWorkspaceRoot || inWorkspaceTmp;
}

export async function maybeCleanupOutboundSource(
  workspaceRoot: string,
  originalMediaUrl: string,
  persistedPath: string,
): Promise<void> {
  if (!persistedPath || persistedPath === originalMediaUrl) return;
  const localRaw = normalizeLocalPathCandidate(originalMediaUrl);
  if (!localRaw) return;
  const candidate = path.isAbsolute(localRaw) ? localRaw : path.join(workspaceRoot, localRaw);
  if (!shouldCleanupGeneratedOutboundSource(workspaceRoot, candidate)) return;
  try {
    await fs.unlink(candidate);
  } catch (err: any) {
    console.warn(
      `[QQ][media] error_code=migration_io_failed action=cleanup_outbound_source candidate=${candidate} error=${err?.message || err}`,
    );
  }
}

async function localFileToBase64(workspaceRoot: string, rawPath: string, config: QQConfig): Promise<string> {
  const candidates = new Set<string>();
  if (path.isAbsolute(rawPath)) candidates.add(rawPath);
  else {
    candidates.add(rawPath);
    candidates.add(path.join(workspaceRoot, rawPath));
    const voiceBase = String(config.voiceBasePath || "").trim();
    if (voiceBase) candidates.add(path.join(voiceBase, rawPath));
  }
  let lastErr: any = null;
  for (const localPath of candidates) {
    for (let i = 0; i < 8; i++) {
      try {
        const st = await fs.stat(localPath);
        if (!st.size) throw new Error("empty media file");
        const data = await fs.readFile(localPath);
        const base64 = data.toString("base64");
        if (!base64) throw new Error("empty media content");
        return `base64://${base64}`;
      } catch (e) {
        lastErr = e;
        await sleep(150 * (i + 1));
      }
    }
  }
  throw new Error(`Failed to resolve local media after retries: ${rawPath}; err=${lastErr}`);
}

async function httpToBase64(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`http fetch failed: ${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error("empty http media payload");
  return `base64://${buf.toString("base64")}`;
}

export async function resolveMediaCandidates(
  workspaceRoot: string,
  url: string,
  config: QQConfig,
  mediaKind?: "record" | "image" | "video" | "file",
): Promise<string[]> {
  const raw = String(url || "").trim();
  if (!raw) throw new Error("empty media url");
  if (isBase64Like(raw) || isDataUriLike(raw)) return [raw];
  if (isHttpLike(raw)) {
    const preferred = buildMediaProxyUrl(raw, config);
    const candidates = [preferred];
    if (preferred !== raw) candidates.push(raw);
    if (config.mediaHttpFallbackToBase64 !== false) {
      try {
        candidates.push(await httpToBase64(raw));
      } catch (err: any) {
        console.warn(
          `[QQ][media] error_code=materialize_http_failed action=http_to_base64 source=${raw} error=${err?.message || err}`,
        );
      }
    }
    return [...new Set(candidates)];
  }

  const maybeVoiceResolved = mediaKind === "record" ? resolveVoiceMediaUrl(raw, config) : raw;
  const rawPath = maybeVoiceResolved.startsWith("file:") ? fileURLToPath(maybeVoiceResolved) : maybeVoiceResolved;
  const policy = await enforceMediaPathPolicy(rawPath, workspaceRoot, config);
  if (!policy.allowed) {
    throw new Error(`MEDIA path rejected: ${rawPath} (${policy.denyReason || "unknown"})`);
  }

  if (mediaKind === "file") {
    const fileUrl = pathToFileURL(rawPath).toString();
    const proxyUrl = buildMediaProxyUrl(fileUrl, config);
    const out: string[] = [];
    if (proxyUrl && proxyUrl !== fileUrl) out.push(proxyUrl);
    out.push(fileUrl);
    out.push(rawPath);
    try {
      out.push(await localFileToBase64(workspaceRoot, rawPath, config));
    } catch (err: any) {
      console.warn(
        `[QQ][media] error_code=materialize_empty_payload action=local_file_to_base64 source=${rawPath} error=${err?.message || err}`,
      );
    }
    return Array.from(new Set(out.filter(Boolean)));
  }

  return [await localFileToBase64(workspaceRoot, rawPath, config)];
}
