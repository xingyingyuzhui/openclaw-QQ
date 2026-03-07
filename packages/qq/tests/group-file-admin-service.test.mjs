import test from "node:test";
import assert from "node:assert/strict";

import {
  createGroupFileFolder,
  deleteGroupFile,
  deleteGroupFolder,
  moveGroupFile,
  renameGroupFile,
} from "../.test-dist/src/services/group-file-admin-service.js";

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

test("group file admin service maps folder and file management actions", async () => {
  const { calls, client } = createClient();
  const ctx = { route: "group:42", source: "chat", stage: "group-file-admin" };
  await createGroupFileFolder(client, 42, "资料", "/", ctx);
  await deleteGroupFile(client, 42, "file-1", 7, ctx);
  await deleteGroupFolder(client, 42, "folder-1", ctx);
  await renameGroupFile(client, 42, "file-1", 7, "new.txt", ctx);
  await moveGroupFile(client, 42, "file-1", 7, "/", "/target", ctx);
  assert.deepEqual(
    calls.map((it) => it.action),
    [
      "create_group_file_folder",
      "delete_group_file",
      "delete_group_folder",
      "rename_group_file",
      "move_group_file",
    ],
  );
  assert.deepEqual(calls[4].params, {
    group_id: 42,
    file_id: "file-1",
    busid: 7,
    parent_directory: "/",
    target_directory: "/target",
  });
});
