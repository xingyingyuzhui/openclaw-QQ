import test from "node:test";
import assert from "node:assert/strict";

import {
  beginRouteInFlight,
  claimRoutePendingLatest,
  clearRouteInFlight,
  clearRoutePendingLatest,
  getRouteInFlight,
  getRoutePendingLatest,
  hasRouteInFlight,
  markRouteDispatchTimeout,
  routeDirName,
  routeHadRecentTimeout,
  upsertRoutePendingLatest,
} from "../.test-dist/src/core/runtime-context.js";

test("routeDirName canonicalizes route separators", () => {
  assert.equal(routeDirName("user:123456789"), "user__123456789");
  assert.equal(routeDirName("guild:g1:c9"), "guild__g1__c9");
});

test("beginRouteInFlight replaces previous inflight and clearRouteInFlight respects dispatch id", () => {
  const first = beginRouteInFlight({ route: "user:1", msgId: "m1", dispatchId: "d1" });
  assert.equal(hasRouteInFlight("user:1"), true);
  assert.equal(first.previous, undefined);

  const second = beginRouteInFlight({ route: "user:1", msgId: "m2", dispatchId: "d2" });
  assert.equal(second.previous?.dispatchId, "d1");
  assert.equal(getRouteInFlight("user:1")?.dispatchId, "d2");
  assert.equal(clearRouteInFlight("user:1", "wrong"), false);
  assert.equal(clearRouteInFlight("user:1", "d2"), true);
  assert.equal(hasRouteInFlight("user:1"), false);
});

test("pending latest state can be claimed only by matching inbound seq", () => {
  upsertRoutePendingLatest({ route: "user:2", msgId: "m3", inboundSeq: 7, hasInboundMediaLike: true });
  assert.equal(getRoutePendingLatest("user:2")?.inboundSeq, 7);
  assert.equal(claimRoutePendingLatest("user:2", 6), false);
  assert.equal(claimRoutePendingLatest("user:2", 7), true);
  assert.equal(getRoutePendingLatest("user:2"), undefined);
  clearRoutePendingLatest("user:2");
});

test("routeHadRecentTimeout becomes true after timeout mark", () => {
  const route = `user:timeout-${Date.now()}`;
  assert.equal(routeHadRecentTimeout(route, 60_000), false);
  markRouteDispatchTimeout(route);
  assert.equal(routeHadRecentTimeout(route, 60_000), true);
});
