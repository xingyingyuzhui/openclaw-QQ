import test from "node:test";
import assert from "node:assert/strict";

import {
  groupPoke,
  setFriendAddRequest,
  setGroupAddRequest,
  setGroupBan,
  setGroupKick,
} from "../.test-dist/src/services/group-admin-service.js";

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

test("group admin service maps actions and defaults correctly", async () => {
  const { calls, client } = createClient();
  const ctx = { route: "group:42", source: "chat", stage: "admin" };

  await setGroupBan(client, 42, 99, undefined, ctx);
  await setGroupKick(client, 42, 99, true, ctx);
  await setGroupAddRequest(client, "flag-1", "invite", false, "no", ctx);
  await setFriendAddRequest(client, "flag-2", true, "hi", ctx);
  await groupPoke(client, 42, 99, ctx);

  assert.deepEqual(
    calls.map((it) => it.action),
    [
      "set_group_ban",
      "set_group_kick",
      "set_group_add_request",
      "set_friend_add_request",
      "group_poke",
    ],
  );
  assert.deepEqual(calls[0].params, { group_id: 42, user_id: 99, duration: 1800 });
  assert.deepEqual(calls[1].params, { group_id: 42, user_id: 99, reject_add_request: true });
});
