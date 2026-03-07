import test from "node:test";
import assert from "node:assert/strict";

import {
  friendPoke,
  getFriendsWithCategory,
  getUnidirectionalFriendList,
  sendPoke,
} from "../.test-dist/src/services/social-extension-service.js";

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

test("social extension service maps poke and friend listing actions", async () => {
  const { calls, client } = createClient();
  const ctx = { route: "user:1", source: "chat", stage: "social-ext" };
  await friendPoke(client, 1001, ctx);
  await sendPoke(client, 1001, 42, ctx);
  await getFriendsWithCategory(client, ctx);
  await getUnidirectionalFriendList(client, ctx);
  assert.deepEqual(
    calls.map((it) => it.action),
    ["friend_poke", "send_poke", "get_friends_with_category", "get_unidirectional_friend_list"],
  );
  assert.deepEqual(calls[1].params, { user_id: 1001, group_id: 42 });
});
