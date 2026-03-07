import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import {
  handleAffinityCommand,
  handleAgentAdminCommand,
  handleRelationshipCommand,
  handleRoleCommand,
} from "../.test-dist/src/services/role-command-service.js";

async function makeWorkspace() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "qq-role-command-"));
}

test("/角色 模板 applies assistant template on explicit route", async () => {
  const root = await makeWorkspace();
  const sent = [];
  await handleRoleCommand({
    parts: ["/角色", "模板", "group:123456", "助手型"],
    currentRoute: "user:1",
    accountWorkspaceRoot: root,
    allowCrossRoute: true,
    send: (msg) => sent.push(msg),
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /default-assistant/);
});

test("/好感度 设置 updates current route affinity", async () => {
  const root = await makeWorkspace();
  const sent = [];
  await handleAffinityCommand({
    parts: ["/好感度", "设置", "88"],
    currentRoute: "user:123456",
    accountWorkspaceRoot: root,
    allowCrossRoute: false,
    send: (msg) => sent.push(msg),
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /88/);
});

test("/关系 重置 resets relationship state", async () => {
  const root = await makeWorkspace();
  const sent = [];
  await handleRelationshipCommand({
    parts: ["/关系", "重置", "user:123456"],
    currentRoute: "user:1",
    accountWorkspaceRoot: root,
    allowCrossRoute: true,
    send: (msg) => sent.push(msg),
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /已重置/);
});

test("/代理 修复 ensures metadata and role pack", async () => {
  const root = await makeWorkspace();
  const sent = [];
  await handleAgentAdminCommand({
    parts: ["/代理", "修复", "user:123456"],
    currentRoute: "user:1",
    accountWorkspaceRoot: root,
    accountId: "default",
    runtime: {
      system: {
        async runCommandWithTimeout(args) {
          if (args.includes("list")) return { code: 0, stdout: "[]", stderr: "" };
          return { code: 0, stdout: "{}", stderr: "" };
        },
      },
    },
    allowCrossRoute: true,
    send: (msg) => sent.push(msg),
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /已完成修复/);
});
