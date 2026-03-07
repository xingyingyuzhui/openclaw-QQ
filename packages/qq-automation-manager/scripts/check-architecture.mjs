#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const srcRoot = path.join(root, "src");

function walkTsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkTsFiles(full));
      continue;
    }
    if (entry.isFile() && full.endsWith(".ts")) out.push(full);
  }
  return out;
}

function rel(file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function readImports(file) {
  const text = fs.readFileSync(file, "utf8");
  const imports = [];
  const re = /from\s+["']([^"']+)["']/g;
  for (const m of text.matchAll(re)) imports.push(m[1]);
  return { text, imports };
}

const violations = [];
for (const file of walkTsFiles(srcRoot)) {
  const relative = rel(file);
  const { text, imports } = readImports(file);
  const lineCount = text.split(/\r?\n/).length;

  if (relative === "src/service.ts" && lineCount > 300) {
    violations.push(`service.ts exceeds cap (>300): ${lineCount}`);
  }
  if (relative.startsWith("src/lib/") && lineCount > 350) {
    violations.push(`lib file too large (>350): ${relative} (${lineCount} lines)`);
  }

  if (relative.startsWith("src/lib/")) {
    for (const imp of imports) {
      if (/\/service(\.js)?$/.test(imp)) {
        violations.push(`lib layer must not import root service: ${relative} -> ${imp}`);
      }
    }
  }
}

if (violations.length) {
  console.error(violations.join("\n\n"));
  process.exit(1);
}

console.log("automation architecture check ok");
