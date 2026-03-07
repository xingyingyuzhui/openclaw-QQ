import test from "node:test";
import assert from "node:assert/strict";

import {
  sendForwardMessage,
  sendGroupForwardMessage,
  sendPrivateForwardMessage,
} from "../.test-dist/src/services/forward-message-service.js";

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

test("forward message service maps generic and scoped forward actions", async () => {
  const { calls, client } = createClient();
  const ctx = { source: "chat", stage: "forward" };
  const messages = [{ type: "node", data: { name: "A", uin: "1", content: "hi" } }];
  await sendForwardMessage(client, "private", 1001, messages, ctx);
  await sendGroupForwardMessage(client, 42, messages, ctx);
  await sendPrivateForwardMessage(client, 1001, messages, ctx);
  assert.deepEqual(
    calls.map((it) => it.action),
    ["send_forward_msg", "send_group_forward_msg", "send_private_forward_msg"],
  );
  assert.deepEqual(calls[0].params, {
    message_type: "private",
    user_id: 1001,
    group_id: undefined,
    messages,
  });
});
