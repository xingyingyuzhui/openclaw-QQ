#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const pathArg = args.find((a) => !a.startsWith("--"));
const sessionsPath =
  pathArg || path.join(process.env.HOME || "", ".openclaw", "agents", "main", "sessions", "sessions.json");
const OWNER_QQ = String(process.env.OPENCLAW_QQ_OWNER_ID || "").trim();
const OWNER_ROUTE = OWNER_QQ ? `user:${OWNER_QQ}` : "";

function isOwnerRoute(route) {
  return !!OWNER_ROUTE && String(route || "").trim() === OWNER_ROUTE;
}

function routeToAgentId(route) {
  if (isOwnerRoute(route)) return "main";
  let m = route.match(/^user:(\d{5,12})$/);
  if (m) return `qq-user-${m[1]}`;
  m = route.match(/^group:(\d{5,12})$/);
  if (m) return `qq-group-${m[1]}`;
  m = route.match(/^guild:([^:]+):([^:]+)$/);
  if (m) return `qq-guild-${m[1]}-${m[2]}`;
  return null;
}

function toResidentKey(route) {
  const agentId = routeToAgentId(route);
  if (!agentId) return null;
  return `agent:${agentId}:main`;
}

function parseRouteFromKey(key, obj) {
  let m = key.match(/^agent:(?:main|default):qq:default:(user:\d{5,12}|group:\d{5,12}|guild:[^:]+:[^:]+)$/);
  if (m) return m[1];
  m = key.match(/^agent:(?:main|default):qq:(group:\d{5,12})$/);
  if (m) return m[1];
  m = key.match(/^agent:(?:main|default):qq:user:(\d{5,12})$/);
  if (m) return `user:${m[1]}`;
  m = key.match(/^agent:(?:main|default):qq:(\d{5,12})$/);
  if (m) return `user:${m[1]}`;
  m = key.match(/^qq:[^:]+:(user:\d{5,12}|group:\d{5,12}|guild:[^:]+:[^:]+)$/);
  if (m) return m[1];
  if (obj?.deliveryContext?.channel === "qq") {
    const to = String(obj.deliveryContext.to || "");
    if (/^(group:\d{5,12}|user:\d{5,12}|guild:[^:]+:[^:]+)$/.test(to)) return to;
  }
  return null;
}

function toNewKey(key, obj) {
  const route = parseRouteFromKey(key, obj);
  if (!route) return null;
  const next = toResidentKey(route);
  if (!next || next === key) return null;
  return next;
}

async function main() {
  const raw = await fs.readFile(sessionsPath, "utf8");
  const json = JSON.parse(raw);
  const mappings = [];
  for (const [k, v] of Object.entries(json)) {
    const nk = toNewKey(k, v);
    if (nk && nk !== k) mappings.push([k, nk]);
  }

  if (!mappings.length) {
    console.log("No legacy QQ session keys found.");
    return;
  }

  console.log("Planned mappings:");
  for (const [oldK, newK] of mappings) console.log(`- ${oldK} -> ${newK}`);

  if (!APPLY) {
    console.log("\nDry run only. Re-run with --apply to write changes.");
    return;
  }

  for (const [oldK, newK] of mappings) {
    if (!json[newK]) json[newK] = json[oldK];
    delete json[oldK];
  }

  const backup = `${sessionsPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  await fs.copyFile(sessionsPath, backup);
  await fs.writeFile(sessionsPath, JSON.stringify(json, null, 2), "utf8");
  console.log(`\nApplied. Backup: ${backup}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
