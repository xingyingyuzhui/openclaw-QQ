import test from "node:test";
import assert from "node:assert/strict";

import {
  markGroupMessageAsRead,
  markPrivateMessageAsRead,
} from "../.test-dist/src/services/message-read-service.js";

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

test("message read service maps group/private read actions", async () => {
  const { calls, client } = createClient();
  const ctx = { source: "chat", stage: "read" };
  await markGroupMessageAsRead(client, 42, ctx);
  await markPrivateMessageAsRead(client, 1001, ctx);
  assert.deepEqual(
    calls.map((it) => it.action),
    ["mark_group_msg_as_read", "mark_private_msg_as_read"],
  );
});
