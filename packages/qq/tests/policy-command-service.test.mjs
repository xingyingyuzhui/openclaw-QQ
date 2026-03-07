import test from "node:test";
import assert from "node:assert/strict";

import { handlePolicyCommand } from "../.test-dist/src/services/policy-command-service.js";

function createStore() {
  const policy = {
    sendText: true,
    sendMedia: true,
    sendVoice: true,
    skills: [],
    maxSendText: null,
    maxSendMedia: null,
    maxSendVoice: null,
  };
  let usageResetCount = 0;
  return {
    usageResetCount: () => usageResetCount,
    store: {
      async readRouteCapabilityPolicy() {
        return { ...policy, skills: [...policy.skills] };
      },
      async readRouteUsageStats() {
        return {
          dispatchCount: 1,
          sendTextCount: 2,
          sendMediaCount: 3,
          sendVoiceCount: 4,
          updatedAt: "2026-03-06T00:00:00.000Z",
        };
      },
      async writeRouteCapabilityPolicy(_route, next) {
        Object.assign(policy, next, { skills: [...(next.skills || [])] });
        return { ...policy, skills: [...policy.skills] };
      },
      async writeRouteUsageStats() {
        usageResetCount += 1;
      },
    },
  };
}

test("policy command toggles media capability", async () => {
  const sent = [];
  const state = createStore();
  const handled = await handlePolicyCommand({
    parts: ["/权限", "开关", "user:1", "媒体", "关"],
    routeNorm: "user:1",
    isValidRoute: true,
    send: (msg) => sent.push(msg),
    store: state.store,
  });
  assert.equal(handled, true);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /媒体=关/);
});

test("policy command sets skills with deduplication", async () => {
  const sent = [];
  const state = createStore();
  await handlePolicyCommand({
    parts: ["/权限", "技能", "user:1", "设置", "draw draw search"],
    routeNorm: "user:1",
    isValidRoute: true,
    send: (msg) => sent.push(msg),
    store: state.store,
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /draw,search/);
});

test("policy command resets usage", async () => {
  const sent = [];
  const state = createStore();
  await handlePolicyCommand({
    parts: ["/权限", "清零", "user:1"],
    routeNorm: "user:1",
    isValidRoute: true,
    send: (msg) => sent.push(msg),
    store: state.store,
  });
  assert.equal(state.usageResetCount(), 1);
  assert.match(sent[0], /用量已清零/);
});

test("policy command rejects invalid toggle syntax", async () => {
  const sent = [];
  const state = createStore();
  await handlePolicyCommand({
    parts: ["/权限", "开关", "user:1", "媒体", "maybe"],
    routeNorm: "user:1",
    isValidRoute: true,
    send: (msg) => sent.push(msg),
    store: state.store,
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0], /用法: \/权限 开关/);
});
