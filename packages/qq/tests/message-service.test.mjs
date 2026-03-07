import test from "node:test";
import assert from "node:assert/strict";

import {
  canSendImage,
  canSendRecord,
  deleteMessage,
  getGroupMemberInfo,
  getMessage,
  sendGroupMessage,
  sendGuildChannelMessage,
  sendPrivateMessage,
  setInputStatus,
} from "../.test-dist/src/services/message-service.js";

function createClient(impl = {}) {
  const calls = [];
  return {
    calls,
    client: {
      async invokeNapCatAction(action, params, ctx) {
        calls.push({ action, params, ctx });
        if (typeof impl[action] === "function") return impl[action](params, ctx);
        if (impl[action] instanceof Error) throw impl[action];
        return impl[action] ?? { ok: true };
      },
    },
  };
}

test("message service send actions map to NapCat actions", async () => {
  const { calls, client } = createClient();
  const ctx = { route: "user:1", source: "chat", stage: "unit" };

  await sendPrivateMessage(client, 1001, "hello", ctx);
  await sendGroupMessage(client, 2002, "hi group", ctx);
  await sendGuildChannelMessage(client, "g1", "c9", "hi guild", ctx);
  await deleteMessage(client, 321, ctx);
  await getMessage(client, 123, ctx);
  await getGroupMemberInfo(client, 42, 99, ctx);
  await setInputStatus(client, 1001, 2, ctx);

  assert.deepEqual(
    calls.map((it) => it.action),
    [
      "send_private_msg",
      "send_group_msg",
      "send_guild_channel_msg",
      "delete_msg",
      "get_msg",
      "get_group_member_info",
      "set_input_status",
    ],
  );
  assert.deepEqual(calls[6].params, { user_id: "1001", event_type: 2 });
});

test("canSendRecord returns false on action failure", async () => {
  const { client } = createClient({ can_send_record: new Error("transport fail") });
  const ok = await canSendRecord(client, { route: "user:1" });
  assert.equal(ok, false);
});

test("canSendImage defaults true on action failure", async () => {
  const { client } = createClient({ can_send_image: new Error("transport fail") });
  const ok = await canSendImage(client, { route: "user:1" });
  assert.equal(ok, true);
});

test("canSendRecord/canSendImage read yes flag", async () => {
  const { client } = createClient({
    can_send_record: { yes: 1 },
    can_send_image: { yes: 0 },
  });
  assert.equal(await canSendRecord(client, { route: "user:1" }), true);
  assert.equal(await canSendImage(client, { route: "user:1" }), false);
});
