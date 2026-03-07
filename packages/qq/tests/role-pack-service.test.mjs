import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

import {
  applyRoleTemplateForRoute,
  ensureRolePackForRoute,
  importRolePackForRoute,
  readRolePackForRoute,
  renderRolePackSummary,
  upsertRelationshipForRoute,
} from "../.test-dist/src/services/role-pack-service.js";

async function makeWorkspace() {
  return await fs.mkdtemp(path.join(os.tmpdir(), "qq-role-pack-"));
}

function makeRoute(kind = "user") {
  const id = 123450000 + Math.floor(Math.random() * 10000);
  return `${kind}:${id}`;
}

test("ensureRolePackForRoute seeds default companion role pack for private route", async () => {
  const root = await makeWorkspace();
  const route = makeRoute("user");
  await ensureRolePackForRoute(root, route);
  const role = await readRolePackForRoute(root, route);
  assert.ok(role);
  assert.equal(role.meta.templateId, "default-companion");
  assert.equal(role.relationship.affinity, 50);
  assert.equal(role.relationship.affinity_stage, "familiar");
  assert.match(renderRolePackSummary(role), /好感度: 50/);
});

test("applyRoleTemplateForRoute switches to assistant template", async () => {
  const root = await makeWorkspace();
  const route = makeRoute("group");
  const role = await applyRoleTemplateForRoute(root, route, "助手型");
  assert.equal(role.meta.templateId, "default-assistant");
  assert.match(role.persona.identity, /助理/);
});

test("importRolePackForRoute imports inline text and resets relationship baseline", async () => {
  const root = await makeWorkspace();
  const route = makeRoute("user");
  const role = await importRolePackForRoute({
    accountWorkspaceRoot: root,
    route,
    sourceType: "text",
    source: "角色名：小秦。身份：温柔但克制。关系：以亲近陪伴方式交流。风格：短句、自然、有温度。",
  });
  assert.ok(role.persona.identity.includes("温柔"));
  assert.equal(role.relationship.affinity, 50);
});

test("upsertRelationshipForRoute updates affinity and stage", async () => {
  const root = await makeWorkspace();
  const route = makeRoute("user");
  await ensureRolePackForRoute(root, route);
  const relationship = await upsertRelationshipForRoute(root, route, { affinity: 90 });
  assert.equal(relationship.affinity, 90);
  assert.equal(relationship.affinity_stage, "devoted");
});
