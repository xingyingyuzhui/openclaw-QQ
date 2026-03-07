import test from "node:test";
import assert from "node:assert/strict";

import { buildBaseState, evaluateSmartSkip } from "../.test-dist/src/reconcile-target.js";

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

test("buildBaseState preserves previous run metadata and recomputes hash", () => {
  const target = createTarget();
  const prev = {
    hash: "old",
    route: "user:123456789",
    agentId: "qq-user-123456789",
    lastTriggeredAtMs: 1,
    lastSentAtMs: 2,
    nextEligibleAtMs: 3,
    lastInboundAtMs: 4,
    lastOutboundAtMs: 5,
    lastRunResult: "skipped",
    lastSkipReason: "interval_not_reached",
    lastError: "none",
    atDone: true,
    lastCronBucket: "bucket-1",
    updatedAt: "2026-03-07T00:00:00.000Z",
  };
  const next = buildBaseState(target, "qq-user-123456789", prev);
  assert.equal(next.route, target.route);
  assert.equal(next.lastTriggeredAtMs, 1);
  assert.equal(next.lastRunResult, "skipped");
  assert.equal(next.lastCronBucket, "bucket-1");
  assert.notEqual(next.hash, "old");
});

test("evaluateSmartSkip returns no_inbound_yet without inbound history", () => {
  const target = createTarget();
  const base = buildBaseState(target, "qq-user-123456789");
  const reason = evaluateSmartSkip(target, base, { lastInboundAtMs: 0, lastOutboundAtMs: 0 }, Date.now());
  assert.equal(reason, "no_inbound_yet");
});

test("evaluateSmartSkip returns silence_not_reached inside silence window", () => {
  const target = createTarget();
  const nowMs = Date.now();
  const base = buildBaseState(target, "qq-user-123456789");
  const reason = evaluateSmartSkip(
    target,
    base,
    { lastInboundAtMs: nowMs - 5 * 60_000, lastOutboundAtMs: 0 },
    nowMs,
  );
  assert.equal(reason, "silence_not_reached");
});

test("evaluateSmartSkip returns active_conversation when recent in/out activity exists", () => {
  const target = createTarget();
  const nowMs = Date.now();
  const base = buildBaseState(target, "qq-user-123456789");
  const reason = evaluateSmartSkip(
    target,
    base,
    { lastInboundAtMs: nowMs - 40 * 60_000, lastOutboundAtMs: nowMs - 5 * 60_000 },
    nowMs,
  );
  assert.equal(reason, "active_conversation");
});

test("evaluateSmartSkip returns interval_not_reached when nextEligibleAtMs is in future", () => {
  const target = createTarget();
  const nowMs = Date.now();
  const base = buildBaseState(target, "qq-user-123456789", {
    lastSentAtMs: nowMs - 10 * 60_000,
    nextEligibleAtMs: nowMs + 20 * 60_000,
  });
  const reason = evaluateSmartSkip(
    target,
    base,
    { lastInboundAtMs: nowMs - 50 * 60_000, lastOutboundAtMs: nowMs - 50 * 60_000 },
    nowMs,
  );
  assert.equal(reason, "interval_not_reached");
});

test("evaluateSmartSkip returns empty when target is eligible", () => {
  const target = createTarget();
  const nowMs = Date.now();
  const base = buildBaseState(target, "qq-user-123456789", {
    lastSentAtMs: nowMs - 3 * 60 * 60_000,
    nextEligibleAtMs: nowMs - 1,
  });
  const reason = evaluateSmartSkip(
    target,
    base,
    { lastInboundAtMs: nowMs - 2 * 60 * 60_000, lastOutboundAtMs: nowMs - 90 * 60_000 },
    nowMs,
  );
  assert.equal(reason, "");
});

test("evaluateSmartSkip returns relationship_guarded for distant low-initiative context", () => {
  const target = createTarget();
  const nowMs = Date.now();
  const base = buildBaseState(target, "qq-user-123456789");
  const reason = evaluateSmartSkip(
    target,
    base,
    { lastInboundAtMs: nowMs - 2 * 60 * 60_000, lastOutboundAtMs: nowMs - 2 * 60 * 60_000 },
    nowMs,
    {
      templateId: "default-companion",
      roleName: "小秦",
      roleIdentity: "陪伴型角色",
      roleRelationship: "像熟人一样聊天",
      styleSummary: "自然、短句、有温度",
      affinity: 20,
      affinityStage: "distant",
      trust: 30,
      initiativeLevel: "low",
    },
  );
  assert.equal(reason, "relationship_guarded");
});
