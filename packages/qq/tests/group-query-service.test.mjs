import test from "node:test";
import assert from "node:assert/strict";

import {
  getGroupFileSystemInfo,
  getGroupFilesByFolder,
  getGroupInfo,
  getGroupMemberList,
  getGroupRootFiles,
  getGroupSystemMessages,
} from "../.test-dist/src/services/group-query-service.js";

function createClient() {
  const calls = [];
  return {
    calls,
    client: {
      async invokeNapCatAction(action, params, ctx) {
        calls.push({ action, params, ctx });
        return { ok: true, action, params, ctx };
      },
    },
  };
}

test("group query services call expected NapCat actions", async () => {
  const { calls, client } = createClient();
  const ctx = { route: "group:42", source: "chat", stage: "test" };

  await getGroupInfo(client, 42, ctx);
  await getGroupMemberList(client, 42, ctx);
  await getGroupSystemMessages(client, ctx);
  await getGroupFileSystemInfo(client, 42, ctx);
  await getGroupRootFiles(client, 42, ctx);
  await getGroupFilesByFolder(client, 42, "folder-1", ctx);

  assert.deepEqual(
    calls.map((it) => it.action),
    [
      "get_group_info",
      "get_group_member_list",
      "get_group_system_msg",
      "get_group_file_system_info",
      "get_group_root_files",
      "get_group_files_by_folder",
    ],
  );
  assert.deepEqual(calls[5].params, { group_id: 42, folder_id: "folder-1" });
});
