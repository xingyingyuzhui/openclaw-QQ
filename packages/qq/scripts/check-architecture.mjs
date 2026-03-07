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

function readImports(file) {
  const text = fs.readFileSync(file, "utf8");
  const imports = [];
  const re = /from\s+["']([^"']+)["']/g;
  for (const m of text.matchAll(re)) imports.push(m[1]);
  return { text, imports };
}

function rel(file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function matchesAny(input, patterns) {
  return patterns.some((p) => p.test(input));
}

const violations = [];
const files = walkTsFiles(srcRoot);

for (const file of files) {
  const relative = rel(file);
  const { text, imports } = readImports(file);

  const lineCount = text.split(/\r?\n/).length;
  const lineChecked =
    relative.startsWith("src/services/") ||
    relative.startsWith("src/napcat/transport/") ||
    relative.startsWith("src/napcat/compat/") ||
    relative.startsWith("src/napcat/contracts/manual/") ||
    relative === "src/diagnostics/napcat-trace.ts";
  if (lineChecked && lineCount > 350) {
    violations.push(`file too large (>350): ${relative} (${lineCount} lines)`);
  }

  if (relative === "src/channel.ts" && lineCount > 800) {
    violations.push(`channel.ts exceeds cap (>800): ${lineCount}`);
  }

  for (const imp of imports) {
    if (relative.startsWith("src/napcat/contracts/")) {
      if (matchesAny(imp, [/\/services\//, /\/inbound\//, /\/outbound\//, /\/core\//, /\/state\//, /\/channel(\.js)?$/])) {
        violations.push(`contracts layer imports forbidden dependency: ${relative} -> ${imp}`);
      }
    }

    if (relative.startsWith("src/napcat/transport/")) {
      if (matchesAny(imp, [/\/services\//, /\/inbound\//, /\/outbound\//, /\/core\//, /\/state\//, /\/channel(\.js)?$/])) {
        violations.push(`transport layer imports forbidden dependency: ${relative} -> ${imp}`);
      }
    }

    if (relative.startsWith("src/napcat/compat/")) {
      if (matchesAny(imp, [/\/services\//, /\/inbound\//, /\/outbound\//, /\/core\//, /\/state\//, /\/channel(\.js)?$/])) {
        violations.push(`compat layer imports forbidden dependency: ${relative} -> ${imp}`);
      }
    }

    if (relative.startsWith("src/services/")) {
      const importsChannelAdapter =
        imp === "../channel.js" ||
        imp === "./channel.js" ||
        (imp.endsWith("/channel.js") && !imp.endsWith("/types/channel.js"));
      if (importsChannelAdapter) {
        violations.push(`services layer must not import channel adapter: ${relative} -> ${imp}`);
      }
    }
  }
}

if (violations.length) {
  console.error(violations.join("\n\n"));
  process.exit(1);
}

console.log("architecture check ok");
