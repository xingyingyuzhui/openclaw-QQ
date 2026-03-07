#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const actionsFile = path.join(root, "src", "napcat", "contracts", "generated", "actions.ts");
const mapsFile = path.join(root, "src", "napcat", "contracts", "generated", "maps.ts");

const actionsText = fs.readFileSync(actionsFile, "utf8");
const mapsText = fs.readFileSync(mapsFile, "utf8");

const actionMatches = [...actionsText.matchAll(/^\s*"([A-Za-z0-9_]+)",\s*$/gm)].map((m) => m[1]);
const actions = Array.from(new Set(actionMatches));

if (actions.length < 120) {
  console.error(`contracts verify failed: too few actions (${actions.length})`);
  process.exit(1);
}

const missingReq = actions.filter((a) => !mapsText.includes(`"${a}": Record<string, unknown>;`));
const missingResp = actions.filter((a) => !mapsText.includes(`"${a}": Record<string, unknown>;`));

if (missingReq.length || missingResp.length) {
  console.error(`contracts verify failed: missing req=${missingReq.length} resp=${missingResp.length}`);
  process.exit(1);
}

console.log(`contracts verify ok: actions=${actions.length}`);
