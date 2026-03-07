#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const srcDir = path.join(root, "src");
const servicesDir = path.join(srcDir, "services");

const actionsFile = path.join(root, "src", "napcat", "contracts", "generated", "actions.ts");
const actionText = fs.readFileSync(actionsFile, "utf8");
const requiredActions = [...actionText.matchAll(/"([^"]+)"[,]/g)]
  .map((m) => m[1])
  .filter((action) => action !== "unknown");

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const serviceFiles = walk(servicesDir).filter((file) => file.endsWith(".ts"));
const serviceText = serviceFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");

const missing = requiredActions.filter((action) => !serviceText.includes(`"${action}"`));
if (missing.length) {
  console.error(`service coverage failed: missing wrappers for ${missing.length} action(s)\n${missing.join("\n")}`);
  process.exit(1);
}

const nonServiceFiles = walk(srcDir).filter((file) => {
  if (!file.endsWith(".ts")) return false;
  if (file.startsWith(servicesDir)) return false;
  if (file.includes(`${path.sep}napcat${path.sep}`)) return false;
  if (file.endsWith(`${path.sep}client.ts`)) return false;
  if (file.endsWith(`${path.sep}send-target.ts`)) return false;
  return true;
});
const directActionViolations = [];
for (const file of nonServiceFiles) {
  const text = fs.readFileSync(file, "utf8");
  for (const action of requiredActions) {
    if (text.includes(`"${action}"`) && !file.endsWith(`${path.sep}media.ts`)) {
      directActionViolations.push(`${path.relative(root, file)} -> ${action}`);
    }
  }
}

if (directActionViolations.length) {
  console.error(`service coverage failed: direct action literals found outside services/client\n${directActionViolations.join("\n")}`);
  process.exit(1);
}

console.log(`service coverage ok: actions=${requiredActions.length}`);
