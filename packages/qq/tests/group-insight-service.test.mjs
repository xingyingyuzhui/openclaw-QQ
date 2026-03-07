import test from "node:test";
import assert from "node:assert/strict";

import {
  getGroupAtAllRemain,
  getGroupHonorInfo,
} from "../.test-dist/src/services/group-insight-service.js";

function createClient() {
  const calls = [];
  return {
    calls,
    client: {
      async invokeNapCatAction(action, params, ctx) {
        calls.push({ action, params, ctx });
        return { ok: true };
      },
    },
  };
}

test("group insight service maps honor and at-all actions", async () => {
  const { calls, client } = createClient();
  const ctx = { route: "group:42", source: "chat", stage: "insight" };
  await getGroupHonorInfo(client, 42, "all", ctx);
  await getGroupAtAllRemain(client, 42, ctx);
  assert.deepEqual(
    calls.map((it) => it.action),
    ["get_group_honor_info", "get_group_at_all_remain"],
  );
  assert.deepEqual(calls[0].params, { group_id: 42, type: "all" });
});
