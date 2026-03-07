import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { QQConfig } from "../config.js";
import type { MaterializeResult } from "../types/media.js";
import { normalizeInboundMediaSource, sleep } from "./common.js";

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
  return { ok: false, retryCount: retries, errorCode: "materialize_http_failed", error: "unreachable" };
}

export async function materializeInboundMediaDetailed(
  conversationBaseDir: (route: string) => string,
  route: string,
  mediaUrls: string[],
  cfg?: Pick<QQConfig, "inboundMediaHttpTimeoutMs" | "inboundMediaHttpRetries"> & { inboundNameHints?: Record<string, string> },
): Promise<MaterializeResult[]> {
  const inDir = path.join(conversationBaseDir(route), "in", "files");
  await fs.mkdir(inDir, { recursive: true });
  const ts = Date.now();
  const timeoutMs = Math.max(500, Number(cfg?.inboundMediaHttpTimeoutMs || 8000));
  const retries = Math.max(0, Number(cfg?.inboundMediaHttpRetries || 2));
  const nameHints = cfg?.inboundNameHints || {};
  const out: MaterializeResult[] = [];
  const seenHash = new Set<string>();

  for (let i = 0; i < mediaUrls.length; i++) {
    const src = String(mediaUrls[i] || "").trim();
    if (!src) continue;
    try {
      let buf: Buffer | null = null;
      const hintedName = String(nameHints[src] || "").trim();
      const originalRawName = inferInboundOriginalFileName(src);
      const originalName = sanitizeInboundFileName(hintedName || originalRawName || "");
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
