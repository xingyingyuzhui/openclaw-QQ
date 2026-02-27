import { createReadStream } from "node:fs";
import { promises as fs } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHmac } from "node:crypto";

let relayServer: Server | null = null;
let relayKey = "";
let relayWorkspace = "";

function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function sign(url: string, exp: string, key: string): string {
  return createHmac("sha256", key).update(`${url}|${exp}`).digest("hex");
}

function isAllowedFile(absPath: string): boolean {
  const norm = path.resolve(absPath);
  const allowed = [
    path.resolve(relayWorkspace, "qq_sessions"),
    path.resolve(relayWorkspace, "qq_media"),
  ];
  return allowed.some((base) => norm.startsWith(base + path.sep));
}

function mimeByExt(filePath: string): string {
  const l = filePath.toLowerCase();
  if (l.endsWith(".html")) return "text/html; charset=utf-8";
  if (l.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (l.endsWith(".png")) return "image/png";
  if (l.endsWith(".jpg") || l.endsWith(".jpeg")) return "image/jpeg";
  if (l.endsWith(".webp")) return "image/webp";
  if (l.endsWith(".gif")) return "image/gif";
  if (l.endsWith(".mp3")) return "audio/mpeg";
  if (l.endsWith(".m4a")) return "audio/mp4";
  if (l.endsWith(".wav")) return "audio/wav";
  if (l.endsWith(".amr")) return "audio/amr";
  if (l.endsWith(".mp4")) return "video/mp4";
  return "application/octet-stream";
}

function asciiFallbackName(name: string): string {
  const base = String(name || "file").trim() || "file";
  const replaced = base.replace(/[\x00-\x1F\x7F-\uFFFF]/g, "_").replace(/["\\]/g, "_");
  return replaced || "file";
}

function encodeRFC5987ValueChars(str: string): string {
  return encodeURIComponent(str)
    .replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%(7C|60|5E)/g, (m) => m.toLowerCase());
}

function buildContentDisposition(fileName: string): string {
  const ascii = asciiFallbackName(fileName);
  const utf8 = encodeRFC5987ValueChars(String(fileName || "file"));
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export function buildRelaySignedUrl(rawUrl: string, baseUrl: string, proxyPath: string, key: string, ttlSec = 300): string {
  const exp = String(Math.floor(Date.now() / 1000) + Math.max(30, ttlSec));
  const sig = sign(rawUrl, exp, key);
  const q = new URLSearchParams({ url: rawUrl, exp, sig });
  return `${baseUrl}${proxyPath.startsWith("/") ? proxyPath : `/${proxyPath}`}?${q.toString()}`;
}

export async function ensureMediaRelayStarted(params: {
  workspaceRoot: string;
  enabled: boolean;
  host?: string;
  port?: number;
  proxyPath?: string;
  token?: string;
}) {
  const { workspaceRoot, enabled } = params;
  if (!enabled) return;
  const host = String(params.host || "0.0.0.0");
  const port = Number(params.port || 18890);
  relayWorkspace = workspaceRoot;
  relayKey = String(params.token || "").trim() || "openclaw-qq-relay";

  if (relayServer) return;

  relayServer = createServer(async (req, res) => {
    try {
      const u = new URL(String(req.url || ""), `http://${req.headers.host || "localhost"}`);
      const proxyPath = String(params.proxyPath || "/qq/media");
      if (u.pathname !== proxyPath) {
        res.writeHead(404).end("not found");
        return;
      }
      const rawUrl = String(u.searchParams.get("url") || "");
      const exp = String(u.searchParams.get("exp") || "");
      const sig = String(u.searchParams.get("sig") || "");
      if (!rawUrl || !exp || !sig) {
        res.writeHead(400).end("bad request");
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      if (!Number.isFinite(Number(exp)) || Number(exp) < now) {
        res.writeHead(410).end("expired");
        return;
      }
      const expected = sign(rawUrl, exp, relayKey);
      if (!safeEq(expected, sig)) {
        res.writeHead(403).end("forbidden");
        return;
      }
      if (!rawUrl.startsWith("file://")) {
        res.writeHead(400).end("url must be file://");
        return;
      }
      const localPath = fileURLToPath(rawUrl);
      if (!isAllowedFile(localPath)) {
        res.writeHead(403).end("path not allowed");
        return;
      }
      await fs.access(localPath);
      res.setHeader("Content-Type", mimeByExt(localPath));
      res.setHeader("Cache-Control", "private, max-age=30");
      res.setHeader("Content-Disposition", buildContentDisposition(path.basename(localPath)));
      createReadStream(localPath).pipe(res);
    } catch (e: any) {
      res.writeHead(500).end(`relay error: ${String(e?.message || e)}`);
    }
  });

  await new Promise<void>((resolve, reject) => {
    relayServer!.once("error", reject);
    relayServer!.listen(port, host, () => resolve());
  });

  console.log(`[QQ][relay] started http://${host}:${port}${String(params.proxyPath || "/qq/media")}`);
}
