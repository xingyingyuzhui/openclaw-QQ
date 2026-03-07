import test from "node:test";
import assert from "node:assert/strict";

import {
  deleteEssenceMessage,
  getEssenceMessageList,
  markMessageAsRead,
  sendLike,
  setEssenceMessage,
} from "../.test-dist/src/services/message-extension-service.js";

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

test("message extension service maps NapCat actions", async () => {
  const { calls, client } = createClient();
  const ctx = { route: "group:42", source: "chat", stage: "extension" };
  await markMessageAsRead(client, 11, ctx);
  await sendLike(client, 1001, 3, ctx);
  await setEssenceMessage(client, 22, ctx);
  await deleteEssenceMessage(client, 22, ctx);
  await getEssenceMessageList(client, 42, ctx);
  assert.deepEqual(
    calls.map((it) => it.action),
    ["mark_msg_as_read", "send_like", "set_essence_msg", "delete_essence_msg", "get_essence_msg_list"],
  );
  assert.deepEqual(calls[1].params, { user_id: 1001, times: 3 });
});
