import test from "node:test";
import assert from "node:assert/strict";

import {
  getFriendMessageHistory,
  getOnlineClients,
  getProfileLike,
  getRecentContacts,
} from "../.test-dist/src/services/account-social-service.js";

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

test("account social service maps recent/online/history/profile actions", async () => {
  const { calls, client } = createClient();
  const ctx = { route: "system", source: "chat", stage: "social" };
  await getRecentContacts(client, ctx);
  await getOnlineClients(client, true, ctx);
  await getFriendMessageHistory(client, 1001, 12, ctx);
  await getProfileLike(client, 1001, ctx);
  assert.deepEqual(
    calls.map((it) => it.action),
    ["get_recent_contact", "get_online_clients", "get_friend_msg_history", "get_profile_like"],
  );
  assert.deepEqual(calls[1].params, { no_cache: true });
  assert.deepEqual(calls[2].params, { user_id: 1001, message_seq: 12 });
});
