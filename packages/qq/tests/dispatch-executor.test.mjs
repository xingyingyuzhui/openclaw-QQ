import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyPostCoalesceDisposition,
  resolveInterruptCoalesceMs,
  shouldSendBusyFollowupHint,
} from "../.test-dist/src/inbound/dispatch-policy.js";

test("resolveInterruptCoalesceMs prefers explicit interruptWindowMs", () => {
  assert.equal(resolveInterruptCoalesceMs({ interruptWindowMs: 900 }, 300), 900);
  assert.equal(resolveInterruptCoalesceMs({ interruptCoalesceMs: 750 }, 300), 750);
  assert.equal(resolveInterruptCoalesceMs({}, 50), 100);
  assert.equal(resolveInterruptCoalesceMs({}, 900), 900);
});

test("shouldSendBusyFollowupHint detects progress-followup messages", () => {
  assert.equal(shouldSendBusyFollowupHint("现在可以吗"), true);
  assert.equal(shouldSendBusyFollowupHint("[CQ:at,qq=1] 好了没"), true);
  assert.equal(shouldSendBusyFollowupHint("普通新问题"), false);
  assert.equal(shouldSendBusyFollowupHint(""), false);
});

test("classifyPostCoalesceDisposition returns expected drop reasons", () => {
  assert.equal(
    classifyPostCoalesceDisposition({
      hasExistingInFlight: true,
      routePreemptOldRun: false,
      interruptCoalesceEnabled: true,
      currentInboundSeq: 2,
      expectedInboundSeq: 1,
    }),
    "queued_superseded_by_newer_inbound",
  );
  assert.equal(
    classifyPostCoalesceDisposition({
      hasExistingInFlight: true,
      routePreemptOldRun: true,
      interruptCoalesceEnabled: true,
      currentInboundSeq: 2,
      expectedInboundSeq: 1,
    }),
    "coalesce_superseded_after_preempt",
  );
  assert.equal(
    classifyPostCoalesceDisposition({
      hasExistingInFlight: false,
      routePreemptOldRun: true,
      interruptCoalesceEnabled: true,
      currentInboundSeq: 2,
      expectedInboundSeq: 1,
    }),
    "merged_into_newer_inbound",
  );
  assert.equal(
    classifyPostCoalesceDisposition({
      hasExistingInFlight: false,
      routePreemptOldRun: false,
      interruptCoalesceEnabled: false,
      currentInboundSeq: 2,
      expectedInboundSeq: 1,
    }),
    "continue",
  );
  assert.equal(
    classifyPostCoalesceDisposition({
      hasExistingInFlight: false,
      routePreemptOldRun: false,
      interruptCoalesceEnabled: true,
      currentInboundSeq: 1,
      expectedInboundSeq: 1,
    }),
    "continue",
  );
});
