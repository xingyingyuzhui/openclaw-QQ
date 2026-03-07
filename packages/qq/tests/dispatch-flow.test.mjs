import test from "node:test";
import assert from "node:assert/strict";

import { handleBusyRouteQueue, handleDispatchFailure } from "../.test-dist/src/inbound/dispatch-flow.js";

test("handleBusyRouteQueue sends followup hint and resumes when pending claim succeeds", async () => {
  const delivered = [];
  const persisted = [];
  const result = await handleBusyRouteQueue({
    route: "user:1",
    msgIdText: "m1",
    inboundSeq: 3,
    hasInboundMediaLike: true,
    text: "现在可以吗",
    replyRunTimeoutMs: 1000,
    interruptCoalesceEnabled: true,
    persistTaskState: async (state, extra) => persisted.push({ state, extra }),
    deliver: async (payload) => delivered.push(payload),
    sleep: async () => {},
    upsertRoutePendingLatest: () => ({ inboundSeq: 3 }),
    hasRouteInFlight: () => false,
    claimRoutePendingLatest: () => true,
    getRoutePendingLatest: () => ({ inboundSeq: 3 }),
  });
  assert.equal(result, "continue");
  assert.equal(persisted[0].state, "queued");
  assert.equal(delivered[0].text, "正在处理你刚发的文件，马上给你结果。");
});

test("handleBusyRouteQueue returns superseded when pending claim fails", async () => {
  const result = await handleBusyRouteQueue({
    route: "user:1",
    msgIdText: "m1",
    inboundSeq: 3,
    hasInboundMediaLike: false,
    text: "普通消息",
    replyRunTimeoutMs: 1000,
    interruptCoalesceEnabled: true,
    persistTaskState: async () => {},
    deliver: async () => {},
    sleep: async () => {},
    upsertRoutePendingLatest: () => ({ inboundSeq: 3 }),
    hasRouteInFlight: () => false,
    claimRoutePendingLatest: () => false,
    getRoutePendingLatest: () => ({ inboundSeq: 4 }),
  });
  assert.equal(result, "queued_superseded_by_newer_inbound");
});

test("handleDispatchFailure persists timeout and sends fallback once eligible", async () => {
  const persisted = [];
  const delivered = [];
  let fallbackRecorded = 0;
  let hadDelivered = false;
  const result = await handleDispatchFailure({
    route: "user:1",
    msgIdText: "m2",
    dispatchId: "d1",
    runTimedOut: true,
    runSuperseded: false,
    dropReason: "dispatch_timeout",
    enableErrorNotify: true,
    hadDelivered: false,
    hadFallbackEligibleDrop: false,
    canSendFallbackNow: () => true,
    recordFallbackSent: () => {
      fallbackRecorded += 1;
    },
    setRouteHadDelivered: (value) => {
      hadDelivered = value;
    },
    deliver: async (payload) => delivered.push(payload),
    persistTaskState: async (state, extra) => persisted.push({ state, extra }),
    sendFallbackAfterDispatchError: async () => true,
  });
  assert.equal(persisted[0].state, "timeout");
  assert.equal(delivered[0].text, "处理中超时，请稍后重试。");
  assert.equal(result.sentFallback, true);
  assert.equal(fallbackRecorded, 1);
  assert.equal(hadDelivered, true);
});

test("handleDispatchFailure avoids notify/fallback on superseded run", async () => {
  const delivered = [];
  const result = await handleDispatchFailure({
    route: "user:1",
    msgIdText: "m2",
    dispatchId: "d1",
    runTimedOut: false,
    runSuperseded: true,
    dropReason: "dispatch_id_mismatch",
    enableErrorNotify: true,
    hadDelivered: false,
    hadFallbackEligibleDrop: true,
    canSendFallbackNow: () => true,
    recordFallbackSent: () => {},
    setRouteHadDelivered: () => {},
    deliver: async (payload) => delivered.push(payload),
    persistTaskState: async () => {},
    sendFallbackAfterDispatchError: async () => true,
  });
  assert.equal(result.sentFallback, false);
  assert.equal(delivered.length, 0);
});
