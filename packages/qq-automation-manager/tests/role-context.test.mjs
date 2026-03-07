import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import { buildAutomationRoleBlock, readAutomationRoleContext } from "../.test-dist/src/lib/role-context.js";
import { buildAgentPrompt } from "../.test-dist/src/lib/automation-runner.js";

async function makeRoot() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "qq-auto-role-"));
}

test("readAutomationRoleContext reads route agent role pack files", async () => {
  const root = await makeRoot();
  const workspaceRoot = path.join(root, "workspace");
  const ws = path.join(root, "workspace-qq-user-123456789");
  await fs.mkdir(path.join(ws, "character"), { recursive: true });
  await fs.mkdir(path.join(ws, "runtime"), { recursive: true });
  await fs.writeFile(path.join(ws, "runtime", "role-pack.meta.json"), JSON.stringify({ templateId: "default-companion" }), "utf8");
  await fs.writeFile(path.join(ws, "character", "persona-core.json"), JSON.stringify({ name: "小秦", identity: "陪伴型角色", relationship: "像熟人一样聊天" }), "utf8");
  await fs.writeFile(path.join(ws, "runtime", "relationship.json"), JSON.stringify({ affinity: 72, affinity_stage: "close", trust: 66, initiative_level: "high" }), "utf8");
  await fs.writeFile(path.join(ws, "character", "style.md"), "自然、短句、有温度，不要模板腔。", "utf8");

  const ctx = await readAutomationRoleContext({
    workspaceRoot,
    route: "user:123456789",
    agentId: "qq-user-123456789",
  });
  assert.ok(ctx);
  assert.equal(ctx.templateId, "default-companion");
  assert.equal(ctx.affinity, 72);
  assert.equal(ctx.initiativeLevel, "high");
  assert.match(ctx.styleSummary, /自然/);
});

test("buildAutomationRoleBlock includes relationship and style summary", () => {
  const block = buildAutomationRoleBlock({
    templateId: "default-companion",
    roleName: "小秦",
    roleIdentity: "陪伴型角色",
    roleRelationship: "像熟人一样聊天",
    styleSummary: "自然、短句、有温度",
    affinity: 72,
    affinityStage: "close",
    trust: 66,
    initiativeLevel: "high",
  });
  assert.match(block, /relationship\.json|当前关系/);
  assert.match(block, /风格摘要/);
  assert.match(block, /72/);
});

test("buildAgentPrompt embeds role block and explicit skip guidance", () => {
  const prompt = buildAgentPrompt(
    {
      id: "t1",
      enabled: true,
      route: "user:123456789",
      executionMode: "agent-only",
      job: {
        type: "cron-agent-turn",
        schedule: { kind: "every", everyMs: 60000 },
        message: "自然发一句关心",
        smart: { maxChars: 32 },
      },
    },
    "角色与关系约束：\n- 当前关系: 好感度=72 (close)，信任=66，主动性=high",
  );
  assert.match(prompt, /relationship\.json/);
  assert.match(prompt, /角色与关系约束/);
  assert.match(prompt, /不适合打扰，就直接沉默/);
});
