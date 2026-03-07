import test from "node:test";
import assert from "node:assert/strict";

import {
  setFriendRemark,
  setGroupAdmin,
  setGroupCard,
  setGroupLeave,
  setGroupName,
  setGroupPortrait,
  setGroupRemark,
  setGroupSign,
  setGroupSpecialTitle,
  setGroupWholeBan,
} from "../.test-dist/src/services/group-profile-service.js";

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

test("group profile service maps friend/group profile actions", async () => {
  const { calls, client } = createClient();
  const ctx = { route: "group:42", source: "chat", stage: "profile" };
  await setFriendRemark(client, 1001, "朋友", ctx);
  await setGroupAdmin(client, 42, 1001, true, ctx);
  await setGroupCard(client, 42, 1001, "新名片", ctx);
  await setGroupName(client, 42, "新群名", ctx);
  await setGroupSpecialTitle(client, 42, 1001, "头衔", 3600, ctx);
  await setGroupWholeBan(client, 42, true, ctx);
  await setGroupPortrait(client, 42, "/tmp/group.png", ctx);
  await setGroupRemark(client, 42, "备注", ctx);
  await setGroupSign(client, 42, ctx);
  await setGroupLeave(client, 42, false, ctx);
  assert.deepEqual(
    calls.map((it) => it.action),
    [
      "set_friend_remark",
      "set_group_admin",
      "set_group_card",
      "set_group_name",
      "set_group_special_title",
      "set_group_whole_ban",
      "set_group_portrait",
      "set_group_remark",
      "set_group_sign",
      "set_group_leave",
    ],
  );
  assert.deepEqual(calls[4].params, { group_id: 42, user_id: 1001, special_title: "头衔", duration: 3600 });
  assert.deepEqual(calls[6].params, { group_id: 42, file: "/tmp/group.png" });
  assert.deepEqual(calls[9].params, { group_id: 42, is_dismiss: false });
});
