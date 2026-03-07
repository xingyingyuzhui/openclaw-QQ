import test from "node:test";
import assert from "node:assert/strict";

import {
  invokeInboundMediaAction,
  resolveInboundMediaByActionSequence,
} from "../.test-dist/src/services/inbound-media-service.js";

function createClient(responses) {
  const calls = [];
  return {
    calls,
    client: {
      async invokeNapCatAction(action, params, ctx) {
        calls.push({ action, params, ctx });
        const next = responses[action];
        if (next instanceof Error) throw next;
        return next;
      },
    },
  };
}

test("invokeInboundMediaAction fills inbound defaults", async () => {
  const { calls, client } = createClient({ get_file: { url: "https://x" } });
  await invokeInboundMediaAction(client, "get_file", { file_id: "abc" }, { route: "user:1", msgId: "m1" });
  assert.deepEqual(calls[0], {
    action: "get_file",
    params: { file_id: "abc" },
    ctx: {
      route: "user:1",
      msgId: "m1",
      source: "inbound",
      stage: "media-resolve",
    },
  });
});

test("resolveInboundMediaByActionSequence falls through until resolved", async () => {
  const { calls, client } = createClient({
    get_image: { url: "" },
    get_file: { url: "https://resolved.example/test.png" },
  });
  const resolved = await resolveInboundMediaByActionSequence(
    client,
    [
      { action: "get_image", params: { file: "img1" } },
      { action: "get_file", params: { file_id: "file1" } },
    ],
    (result) => result?.url || "",
    { route: "user:1", msgId: "m2" },
  );
  assert.equal(resolved, "https://resolved.example/test.png");
  assert.deepEqual(
    calls.map((it) => it.action),
    ["get_image", "get_file"],
  );
});

test("resolveInboundMediaByActionSequence ignores action errors and returns empty when unresolved", async () => {
  const { client } = createClient({
    get_image: new Error("boom"),
    get_file: { url: "" },
  });
  const resolved = await resolveInboundMediaByActionSequence(
    client,
    [
      { action: "get_image", params: { file: "img1" } },
      { action: "get_file", params: { file_id: "file1" } },
    ],
    (result) => result?.url || "",
    { route: "user:1", msgId: "m3" },
  );
  assert.equal(resolved, "");
});
