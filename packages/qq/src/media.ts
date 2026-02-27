import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { OneBotClient } from "./client.js";
import type { QQConfig } from "./config.js";
import { buildRelaySignedUrl } from "./media-relay.js";
import type { OneBotMessage } from "./types.js";
import type { MaterializeResult } from "./types/media.js";
import { enforceMediaPathPolicy } from "./media/path-policy.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function extractImageUrls(message: OneBotMessage | string | undefined, maxImages = 3): string[] {
  const urls: string[] = [];
  if (Array.isArray(message)) {
    for (const segment of message) {
      if (segment.type === "image") {
        const url = segment.data?.url || (typeof segment.data?.file === "string" && (segment.data.file.startsWith("http") || segment.data.file.startsWith("base64://")) ? segment.data.file : undefined);
        if (url) {
          urls.push(url);
          if (urls.length >= maxImages) break;
        }
      }
    }
  } else if (typeof message === "string") {
    const imageRegex = /\[CQ:image,[^\]]*(?:url|file)=([^,\]]+)[^\]]*\]/g;
    let match;
    while ((match = imageRegex.exec(message)) !== null) {
      const val = match[1].replace(/&amp;/g, "&");
      if (val.startsWith("http") || val.startsWith("base64://")) {
        urls.push(val);
        if (urls.length >= maxImages) break;
      }
    }
  }
  return urls;
}

export function normalizeInboundMediaSource(input: any): string {
  const v = String(input || "").trim().replace(/&amp;/g, "&");
  if (!v) return "";
  if (/^https?:\/\//i.test(v)) return v;
  if (/^base64:\/\//i.test(v)) return v;
  if (/^data:/i.test(v)) return v;
  if (/^file:\/\//i.test(v)) return v;
  if (v.startsWith("/")) return `file://${v}`;
  return "";
}

function pickMediaLocationFromApiResult(result: any): string {
  const d = result?.data ?? result ?? {};
  const candidates = [d?.url, d?.download_url, d?.downloadUrl, d?.src, d?.file, d?.path, d?.file_path, d?.local_path, d?.temp_file];
  for (const c of candidates) {
    const normalized = normalizeInboundMediaSource(c);
    if (normalized) return normalized;
  }
  const b64Candidates = [d?.base64, d?.b64, d?.file_data, d?.data];
  for (const c of b64Candidates) {
    const raw = String(c || "").trim();
    if (!raw) continue;
    if (/^base64:\/\//i.test(raw)) return raw;
    if (/^[A-Za-z0-9+/=\r\n]+$/.test(raw) && raw.length > 32) return `base64://${raw}`;
  }
  return "";
}

type InboundResolveOptions = {
  prefer?: "napcat-first" | "direct-first";
  useStream?: boolean;
};

export function collectInboundMediaCandidatesFromFields(segData: any): string[] {
  const direct = [
    segData?.url,
    segData?.src,
    segData?.download_url,
    segData?.downloadUrl,
    segData?.file,
    segData?.path,
    segData?.file_path,
    segData?.local_path,
    segData?.temp_file,
  ];
  return direct.map((it) => normalizeInboundMediaSource(it)).filter(Boolean);
}

async function resolveByActionSequence(client: OneBotClient, attempts: Array<{ action: string; params: any }>): Promise<string> {
  for (const it of attempts) {
    try {
      const info = await (client as any).sendWithResponse(it.action, it.params);
      const resolved = pickMediaLocationFromApiResult(info);
      if (resolved) {
        console.log(
          `[QQ][media-resolve] resolve_action=${it.action} resolve_result=ok source=${resolved.slice(0, 120)}`,
        );
        return resolved;
      }
      console.log(
        `[QQ][media-resolve] resolve_action=${it.action} resolve_result=empty`,
      );
    } catch (err: any) {
      console.warn(
        `[QQ][media-resolve] error_code=resolve_action_failed action=${it.action} error=${err?.message || err}`,
      );
    }
  }
  return "";
}

export async function resolveRecordMediaSource(client: OneBotClient, segData: any, opts?: InboundResolveOptions): Promise<string> {
  const directResolved = collectInboundMediaCandidatesFromFields(segData);
  const prefer = opts?.prefer || "napcat-first";
  const useStream = opts?.useStream !== false;
  const fileArg = segData?.file || segData?.file_id || segData?.id;
  if (prefer === "direct-first" && directResolved.length > 0) return directResolved[0];
  if (fileArg) {
    const attempts: Array<{ action: string; params: any }> = [
      { action: "get_file", params: { file: fileArg } },
      { action: "get_file", params: { file_id: fileArg } },
    ];
    if (useStream) attempts.push({ action: "download_file_record_stream", params: { file: fileArg } });
    if (useStream) attempts.push({ action: "download_file_stream", params: { file: fileArg } });
    attempts.push({ action: "get_record", params: { file: fileArg, out_format: "amr" } });
    attempts.push({ action: "get_record", params: { file_id: fileArg, out_format: "amr" } });
    const resolved = await resolveByActionSequence(client, attempts);
    if (resolved) return resolved;
  }
  return directResolved[0] || "";
}

export async function resolveImageMediaSource(client: OneBotClient, segData: any, opts?: InboundResolveOptions): Promise<string> {
  const fileArg = segData?.file_id || segData?.id || segData?.fid || segData?.file;
  const direct = collectInboundMediaCandidatesFromFields(segData);
  const prefer = opts?.prefer || "napcat-first";
  const useStream = opts?.useStream !== false;
  const directResolved = direct.filter(Boolean);
  if (prefer === "direct-first" && directResolved.length > 0) return directResolved[0];

  if (fileArg) {
    const attempts: Array<{ action: string; params: any }> = [
      { action: "get_image", params: { file: fileArg } },
      { action: "get_image", params: { file_id: fileArg } },
      { action: "get_file", params: { file: fileArg } },
      { action: "get_file", params: { file_id: fileArg } },
    ];
    if (useStream) attempts.push({ action: "download_file_image_stream", params: { file: fileArg } });
    if (useStream) attempts.push({ action: "download_file_stream", params: { file: fileArg } });
    attempts.push({ action: "download_file", params: { file: fileArg } });
    attempts.push({ action: "download_file", params: { file_id: fileArg } });
    const resolved = await resolveByActionSequence(client, attempts);
    if (resolved) return resolved;
  }

  return directResolved[0] || "";
}

export async function resolveVideoMediaSource(client: OneBotClient, segData: any, opts?: InboundResolveOptions): Promise<string> {
  const fileArg = segData?.file_id || segData?.id || segData?.fid || segData?.file;
  const directResolved = collectInboundMediaCandidatesFromFields(segData);
  const prefer = opts?.prefer || "napcat-first";
  const useStream = opts?.useStream !== false;
  if (prefer === "direct-first" && directResolved.length > 0) return directResolved[0];

  if (fileArg) {
    const attempts: Array<{ action: string; params: any }> = [
      { action: "get_file", params: { file: fileArg } },
      { action: "get_file", params: { file_id: fileArg } },
    ];
    if (useStream) attempts.push({ action: "download_file_stream", params: { file: fileArg } });
    attempts.push({ action: "download_file", params: { file: fileArg } });
    attempts.push({ action: "download_file", params: { file_id: fileArg } });
    const resolved = await resolveByActionSequence(client, attempts);
    if (resolved) return resolved;
  }

  return directResolved[0] || "";
}

export async function resolveFileMediaSource(client: OneBotClient, segData: any, isGroup: boolean, groupId?: number, opts?: InboundResolveOptions): Promise<string> {
  const directResolved = collectInboundMediaCandidatesFromFields(segData);
  const prefer = opts?.prefer || "napcat-first";
  const useStream = opts?.useStream !== false;
  if (prefer === "direct-first" && directResolved.length > 0) return directResolved[0];
  const attempts: Array<{ action: string; params: any }> = [];
  const fileArg = segData?.file_id || segData?.id || segData?.fid || segData?.file;
  if (isGroup && groupId) {
    if (segData?.file_id || segData?.id) {
      attempts.push({ action: "get_group_file_url", params: { group_id: groupId, file_id: segData?.file_id || segData?.id, busid: segData?.busid } });
    }
  }
  if (fileArg) {
    if (!isGroup) {
      attempts.push({ action: "get_private_file_url", params: { file_id: fileArg } });
      attempts.push({ action: "get_private_file_url", params: { file: fileArg } });
    }
    attempts.push({ action: "get_file", params: { file_id: fileArg } });
    attempts.push({ action: "get_file", params: { file: fileArg } });
    if (useStream) attempts.push({ action: "download_file_stream", params: { file: fileArg } });
    attempts.push({ action: "download_file", params: { file_id: fileArg } });
    attempts.push({ action: "download_file", params: { file: fileArg } });
  }
  const resolved = await resolveByActionSequence(client, attempts);
  if (resolved) return resolved;
  return directResolved[0] || "";
}

function inferInboundExtByUrl(url: string): string {
  const lower = String(url || "").toLowerCase();
  const known = [
    ".jpg", ".jpeg", ".png", ".webp", ".gif",
    ".mp3", ".wav", ".ogg", ".m4a", ".aac", ".amr", ".silk",
    ".mp4", ".mov", ".mkv", ".webm", ".avi",
    ".txt", ".md", ".markdown", ".csv", ".tsv", ".json", ".yaml", ".yml", ".toml", ".ini", ".log", ".xml", ".html",
  ];
  for (const ext of known) {
    if (lower.includes(ext)) return ext;
  }
  return ".bin";
}

function inferInboundExtByBuffer(buf: Buffer, fallback = ".bin"): string {
  if (!buf || !buf.length) return fallback;
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return ".png";
  if (buf.length >= 6) {
    const h6 = buf.subarray(0, 6).toString("ascii");
    if (h6 === "GIF87a" || h6 === "GIF89a") return ".gif";
  }
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WAVE") return ".wav";
  if (buf.length >= 5 && buf.subarray(0, 5).toString("ascii") === "#!AMR") return ".amr";
  if (buf.length >= 4 && buf.subarray(0, 4).toString("ascii") === "OggS") return ".ogg";
  if (buf.length >= 3 && buf.subarray(0, 3).toString("ascii") === "ID3") return ".mp3";
  if (buf.length >= 12 && buf.subarray(4, 8).toString("ascii") === "ftyp") return ".mp4";

  const head = buf.subarray(0, Math.min(2048, buf.length)).toString("utf8");
  if (head.length && !head.includes("\u0000")) {
    const trimmed = head.trim();
    if ((trimmed.startsWith("{") && trimmed.includes(":")) || (trimmed.startsWith("[") && trimmed.includes("]"))) return ".json";
    if (/^---\s*$/.test(trimmed.split("\n")[0] || "") || /^\s*[\w.-]+:\s+/m.test(trimmed)) return ".yaml";
    if (/^\s*#\s+/.test(trimmed) || /```/.test(trimmed) || /\n\s*-\s+/.test(trimmed)) return ".md";
    if (/^\s*[^,\n]+(,[^,\n]+){1,}/m.test(trimmed)) return ".csv";
    if (/^\s*[^\t\n]+(\t[^\t\n]+){1,}/m.test(trimmed)) return ".tsv";
    if (/^\s*<\?xml/.test(trimmed) || /^\s*<[^>]+>/.test(trimmed)) return ".xml";
    return ".txt";
  }
  return fallback;
}

function sanitizeInboundFileName(name: string): string {
  const n = String(name || "").trim();
  if (!n) return "media.bin";
  const base = path.basename(n).normalize("NFKC");
  return base.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_") || "media.bin";
}

function inferInboundOriginalFileName(src: string): string {
  const s = String(src || "").trim();
  if (!s) return "";
  if (/^file:\/\//i.test(s)) {
    try {
      return path.basename(fileURLToPath(s));
    } catch {
      return "";
    }
  }
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      const qp = [u.searchParams.get("filename"), u.searchParams.get("name"), u.searchParams.get("file")].find(Boolean);
      if (qp) return path.basename(decodeURIComponent(String(qp)));
      return path.basename(decodeURIComponent(u.pathname || ""));
    } catch {
      return "";
    }
  }
  return path.basename(s);
}

async function fetchInboundHttpBuffer(url: string, timeoutMs: number, retries: number): Promise<{ ok: boolean; buf?: Buffer; status?: number; retryCount: number; errorCode?: string; error?: string }> {
  let attempt = 0;
  while (attempt <= retries) {
    attempt += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(200, timeoutMs));
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        if (attempt <= retries) {
          await sleep(150 * attempt);
          continue;
        }
        return { ok: false, status: res.status, retryCount: attempt - 1, errorCode: "materialize_http_failed", error: `status=${res.status}` };
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (!buf.length) return { ok: false, retryCount: attempt - 1, errorCode: "materialize_empty_payload", error: "empty http body" };
      return { ok: true, buf, retryCount: attempt - 1, status: res.status };
    } catch (err: any) {
      const aborted = err?.name === "AbortError";
      if (attempt <= retries) {
        await sleep(150 * attempt);
        continue;
      }
      return {
        ok: false,
        retryCount: attempt - 1,
        errorCode: "materialize_http_failed",
        error: String(err?.message || err),
      };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, retryCount: retries, errorCode: "materialize_http_failed", error: "unknown http error" };
}

export async function materializeInboundMediaDetailed(
  conversationBaseDir: (route: string) => string,
  route: string,
  mediaUrls: string[],
  cfg?: Pick<QQConfig, "inboundMediaHttpTimeoutMs" | "inboundMediaHttpRetries"> & { inboundNameHints?: Record<string, string> },
): Promise<MaterializeResult[]> {
  if (!mediaUrls.length) return [];
  const inDir = path.join(conversationBaseDir(route), "in", "files");
  await fs.mkdir(inDir, { recursive: true });
  const out: MaterializeResult[] = [];
  const seenHash = new Set<string>();
  const timeoutMs = Math.max(1000, Number(cfg?.inboundMediaHttpTimeoutMs ?? 8000));
  const retries = Math.max(0, Number(cfg?.inboundMediaHttpRetries ?? 2));

  for (let i = 0; i < mediaUrls.length; i++) {
    const src = String(mediaUrls[i] || "").trim();
    if (!src) continue;
    const ts = Date.now();
    try {
      let buf: Buffer | null = null;
      const hintedName = String((cfg as any)?.inboundNameHints?.[src] || "").trim();
      const originalRawName = hintedName || inferInboundOriginalFileName(src);
      const originalName = sanitizeInboundFileName(originalRawName);
      const hasOriginalExt = !!path.extname(originalName);
      let preferredExt = path.extname(originalName) || inferInboundExtByUrl(src);
      let extSource: "original" | "url" | "buffer" | "fallback" = hasOriginalExt ? "original" : (preferredExt && preferredExt !== ".bin" ? "url" : "fallback");
      let nameSource: "hint" | "url" | "download" | "fallback" = hintedName
        ? "hint"
        : (originalRawName
            ? (String(originalRawName).toLowerCase().startsWith("qqdownload") ? "download" : "url")
            : "fallback");
      let httpStatus: number | undefined;
      let retryCount = 0;

      if (/^file:\/\//i.test(src)) {
        const fp = fileURLToPath(src);
        try {
          const st = await fs.stat(fp);
          if (!st.isFile() || st.size <= 0) {
            out.push({ url: src, materialized: false, errorCode: "file_not_found", error: "not file or empty" });
            continue;
          }
          buf = await fs.readFile(fp);
          if (!hasOriginalExt) {
            preferredExt = path.extname(fp) || preferredExt;
            if (preferredExt && preferredExt !== ".bin") extSource = "url";
          }
          if (!originalName) {
            const bn = path.basename(fp);
            if (bn) nameSource = bn.toLowerCase().startsWith("qqdownload") ? "download" : "url";
          }
        } catch (err: any) {
          const code = String(err?.code || "");
          const likelyContainerLocalPath =
            path.isAbsolute(fp) && (code === "ENOENT" || code === "EACCES" || code === "EPERM" || code === "ENOTDIR");
          out.push({
            url: src,
            materialized: false,
            errorCode: likelyContainerLocalPath ? "container_local_unreadable" : "file_not_found",
            error: String(err?.message || err),
          });
          continue;
        }
      } else if (/^base64:\/\//i.test(src) || /^data:/i.test(src)) {
        const raw = src.startsWith("base64://") ? src.slice("base64://".length) : src;
        const cleaned = raw.replace(/^data:[^,]+,/, "").replace(/\s+/g, "");
        buf = Buffer.from(cleaned, "base64");
      } else if (/^https?:\/\//i.test(src)) {
        const fetched = await fetchInboundHttpBuffer(src, timeoutMs, retries);
        retryCount = fetched.retryCount;
        if (!fetched.ok || !fetched.buf) {
          out.push({
            url: src,
            materialized: false,
            errorCode: fetched.errorCode || "http_fetch_error",
            httpStatus: fetched.status,
            retryCount,
            error: fetched.error,
          });
          continue;
        }
        httpStatus = fetched.status;
        buf = fetched.buf;
      } else {
        out.push({ url: src, materialized: false, errorCode: "unsupported_source", error: "source format unsupported" });
        continue;
      }

      if (!buf || !buf.length) {
            out.push({ url: src, materialized: false, errorCode: "materialize_empty_payload", error: "empty buffer" });
            continue;
          }

      const hash = createHash("sha1").update(buf).digest("hex");
      if (seenHash.has(hash)) {
        out.push({ url: src, materialized: false, errorCode: "duplicate_payload", error: "duplicate by content hash" });
        continue;
      }
      seenHash.add(hash);

      const ext = inferInboundExtByBuffer(buf, preferredExt || ".bin");
      if (!hasOriginalExt && ext && ext !== preferredExt && ext !== ".bin") extSource = "buffer";
      const baseName = sanitizeInboundFileName(originalName || `in-${i + 1}${ext}`);
      const finalName = path.extname(baseName) ? baseName : `${baseName}${ext}`;
      const name = sanitizeInboundFileName(finalName);
      const target = path.join(inDir, `${ts}-${i + 1}-${name}`);
      await fs.writeFile(target, buf);
      console.log(`[QQ][inbound-name-trace] route=${route} source=${src} original=${originalName || ""} final=${name} name_source=${nameSource} ext_source=${extSource}`);
      out.push({
        url: src,
        outputUrl: `file://${target}`,
        materialized: true,
        httpStatus,
        retryCount,
        originalFilename: originalName || undefined,
        finalFilename: name,
        nameSource,
        extSource,
      });
    } catch (err: any) {
      out.push({
        url: src,
        materialized: false,
        errorCode: "materialize_exception",
        error: String(err?.message || err),
      });
    }
  }
  return out;
}

export async function materializeInboundMedia(
  conversationBaseDir: (route: string) => string,
  route: string,
  mediaUrls: string[],
  cfg?: Pick<QQConfig, "inboundMediaHttpTimeoutMs" | "inboundMediaHttpRetries">,
): Promise<string[]> {
  const results = await materializeInboundMediaDetailed(conversationBaseDir, route, mediaUrls, cfg);
  return results.filter((it) => it.materialized && it.outputUrl).map((it) => String(it.outputUrl));
}

export function isImageFile(url: string): boolean { const l = url.toLowerCase(); return l.endsWith('.jpg') || l.endsWith('.jpeg') || l.endsWith('.png') || l.endsWith('.gif') || l.endsWith('.webp'); }
export function isAudioFile(url: string): boolean { const l = url.toLowerCase(); return l.endsWith('.mp3') || l.endsWith('.wav') || l.endsWith('.ogg') || l.endsWith('.m4a') || l.endsWith('.aac') || l.endsWith('.flac') || l.endsWith('.amr') || l.endsWith('.silk'); }
export function isVideoFile(url: string): boolean { const l = url.toLowerCase(); return l.endsWith('.mp4') || l.endsWith('.mov') || l.endsWith('.m4v') || l.endsWith('.webm') || l.endsWith('.mkv') || l.endsWith('.avi'); }
export function isHttpLike(url: string): boolean { return /^https?:\/\//i.test(String(url || "")); }
export function isBase64Like(url: string): boolean { return /^base64:\/\//i.test(String(url || "")); }
export function isDataUriLike(url: string): boolean { return /^data:/i.test(String(url || "")); }

export async function buildMediaDedupKey(route: string, persistedPath: string, kind: "image" | "audio" | "video" | "file"): Promise<string> {
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
    try { return fileURLToPath(v); } catch { return ""; }
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

export async function persistOutboundLocalMedia(workspaceRoot: string, conversationBaseDir: (route: string) => string, route: string, mediaUrl: string, preferredName?: string): Promise<string> {
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

export async function maybeCleanupOutboundSource(workspaceRoot: string, originalMediaUrl: string, persistedPath: string): Promise<void> {
  if (!persistedPath || persistedPath === originalMediaUrl) return;
  const localRaw = normalizeLocalPathCandidate(originalMediaUrl);
  if (!localRaw) return;
  const candidate = path.isAbsolute(localRaw) ? localRaw : path.join(workspaceRoot, localRaw);
  if (!shouldCleanupGeneratedOutboundSource(workspaceRoot, candidate)) return;
  try { await fs.unlink(candidate); } catch (err: any) {
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
      } catch (e) { lastErr = e; await sleep(150 * (i + 1)); }
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

export async function resolveMediaCandidates(workspaceRoot: string, url: string, config: QQConfig, mediaKind?: "record" | "image" | "video" | "file"): Promise<string[]> {
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

  // Prefer non-base64 for generic files, fallback to base64 for compatibility.
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
