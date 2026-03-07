import test from "node:test";
import assert from "node:assert/strict";

import { randomMinutes, shouldRunNow } from "../.test-dist/src/lib/schedule-evaluator.js";

test("every schedule fires on first run and after interval", () => {
  const schedule = { kind: "every", everyMs: 60_000 };
  assert.equal(shouldRunNow(schedule, { lastTriggeredAtMs: 0 }, Date.now()).due, true);
  assert.equal(shouldRunNow(schedule, { lastTriggeredAtMs: 1000 }, 30_000).due, false);
  assert.equal(shouldRunNow(schedule, { lastTriggeredAtMs: 1000 }, 61_500).due, true);
});

test("at schedule only fires once and patches state", () => {
  const at = "2026-03-06T12:00:00.000Z";
  const first = shouldRunNow({ kind: "at", at }, { atDone: false }, Date.parse(at) + 1);
  assert.equal(first.due, true);
  assert.equal(first.nextStatePatch.atDone, true);
  const second = shouldRunNow({ kind: "at", at }, { atDone: true }, Date.parse(at) + 5_000);
  assert.equal(second.due, false);
});

test("cron schedule dedups same bucket", () => {
  const schedule = { kind: "cron", expr: "0 9 * * *", tz: "Asia/Shanghai" };
  const due = shouldRunNow(schedule, { lastCronBucket: "" }, Date.parse("2026-03-07T01:00:00.000Z"));
  assert.equal(due.due, true);
  assert.ok(due.nextStatePatch?.lastCronBucket);
  const repeated = shouldRunNow(schedule, { lastCronBucket: due.nextStatePatch.lastCronBucket }, Date.parse("2026-03-07T01:00:20.000Z"));
  assert.equal(repeated.due, false);
});

test("randomMinutes returns inclusive bounded value", () => {
  for (let i = 0; i < 100; i += 1) {
    const n = randomMinutes(30, 60);
    assert.ok(n >= 30 && n <= 60);
  }
});
