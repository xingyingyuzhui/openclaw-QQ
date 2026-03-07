import test from "node:test";
import assert from "node:assert/strict";

import { reconcileTarget } from "../.test-dist/src/reconcile-target.js";

function createApi() {
  const logs = { info: [], warn: [] };
  return {
    logs,
    api: {
      logger: {
        info: (msg) => logs.info.push(String(msg)),
        warn: (msg) => logs.warn.push(String(msg)),
      },
    },
  };
}

function createTarget(overrides = {}) {
  return {
    id: "t1",
    enabled: true,
    route: "user:123456789",
    executionMode: "agent-only",
    job: {
      type: "cron-agent-turn",
      schedule: { kind: "every", everyMs: 60000 },
      message: "hello",
      smart: {
        minSilenceMinutes: 30,
        activeConversationMinutes: 25,
        randomIntervalMinMinutes: 30,
        randomIntervalMaxMinutes: 60,
      },
    },
    ...overrides,
  };
}

function createDeps(overrides = {}) {
  const records = [];
  return {
    records,
    deps: {
      async resolveAgentId() {
        return "qq-user-123456789";
      },
      async ensureAgentRegistered() {},
      async readRecentRouteTimes() {
        return { lastInboundAtMs: Date.now() - 2 * 60 * 60_000, lastOutboundAtMs: Date.now() - 90 * 60_000 };
      },
      shouldRunNow() {
        return { due: true };
      },
      async triggerAgentTurn() {
        return { ok: true, summary: "sent ok" };
      },
      async readAutomationRoleContext() {
        return {
          templateId: "default-companion",
          roleName: "小秦",
          roleIdentity: "陪伴型角色",
          roleRelationship: "像熟人一样聊天",
          styleSummary: "自然、短句、有温度",
          affinity: 72,
          affinityStage: "close",
          trust: 66,
          initiativeLevel: "high",
        };
      },
      async bumpAutomationRelationshipState() {},
      async appendRouteState(_workspaceRoot, _route, rec) {
        records.push(rec);
      },
      buildAutomationRecord(params) {
        return { ...params };
      },
      ...overrides,
    },
  };
}

test("reconcileTarget marks failed when ensureAgentRegistered throws", async () => {
  const { api, logs } = createApi();
  const { deps, records } = createDeps({
    async ensureAgentRegistered() {
      throw new Error("register failed");
    },
  });
  const state = await reconcileTarget({
    api,
    workspaceRoot: "/tmp/workspace",
    target: createTarget(),
    nowMs: Date.now(),
    deps,
  });
  assert.equal(state.lastRunResult, "failed");
  assert.match(state.lastError, /ensure_agent_registered_failed/);
  assert.equal(records.length, 1);
  assert.equal(records[0].triggered, false);
  assert.ok(logs.warn.some((it) => it.includes("ensure agent registered failed")));
});

test("reconcileTarget returns idle for disabled target without appending record", async () => {
  const { api } = createApi();
  const { deps, records } = createDeps();
  const state = await reconcileTarget({
    api,
    workspaceRoot: "/tmp/workspace",
    target: createTarget({ enabled: false }),
    nowMs: Date.now(),
    deps,
  });
  assert.equal(state.lastRunResult, "idle");
  assert.equal(records.length, 0);
});

test("reconcileTarget skips and appends skip record", async () => {
  const { api, logs } = createApi();
  const { deps, records } = createDeps({
    async readRecentRouteTimes() {
      return { lastInboundAtMs: 0, lastOutboundAtMs: 0 };
    },
  });
  const state = await reconcileTarget({
    api,
    workspaceRoot: "/tmp/workspace",
    target: createTarget(),
    nowMs: Date.now(),
    deps,
  });
  assert.equal(state.lastRunResult, "skipped");
  assert.equal(state.lastSkipReason, "no_inbound_yet");
  assert.equal(records.length, 1);
  assert.equal(records[0].skipped, true);
  assert.ok(logs.info.some((it) => it.includes("reason=no_inbound_yet")));
});

test("reconcileTarget marks sent and updates nextEligibleAtMs on successful trigger", async () => {
  const { api, logs } = createApi();
  const nowMs = Date.now();
  let bumpCount = 0;
  const { deps, records } = createDeps();
  deps.bumpAutomationRelationshipState = async () => {
    bumpCount += 1;
  };
  const state = await reconcileTarget({
    api,
    workspaceRoot: "/tmp/workspace",
    target: createTarget(),
    nowMs,
    deps,
  });
  assert.equal(state.lastRunResult, "sent");
  assert.equal(state.lastSentAtMs, nowMs);
  assert.ok(state.nextEligibleAtMs > nowMs);
  assert.equal(records.length, 1);
  assert.equal(records[0].produced, true);
  assert.equal(records[0].roleContext.templateId, "default-companion");
  assert.equal(records[0].roleContext.affinity, 72);
  assert.equal(bumpCount, 1);
  assert.ok(logs.info.some((it) => it.includes("result=sent")));
});

test("reconcileTarget marks failed when triggerAgentTurn fails", async () => {
  const { api, logs } = createApi();
  const { deps, records } = createDeps({
    async triggerAgentTurn() {
      return { ok: false, error: "dispatch failed" };
    },
  });
  const state = await reconcileTarget({
    api,
    workspaceRoot: "/tmp/workspace",
    target: createTarget(),
    nowMs: Date.now(),
    deps,
  });
  assert.equal(state.lastRunResult, "failed");
  assert.equal(state.lastError, "dispatch failed");
  assert.equal(records.length, 1);
  assert.equal(records[0].produced, false);
  assert.ok(logs.warn.some((it) => it.includes("trigger failed")));
});
