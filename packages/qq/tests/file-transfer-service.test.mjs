import test from "node:test";
import assert from "node:assert/strict";

import {
  sendOnlineFile,
  uploadGroupFile,
  uploadPrivateFile,
} from "../.test-dist/src/services/file-transfer-service.js";

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

test("file transfer services invoke correct actions and payloads", async () => {
  const { calls, client } = createClient();
  const ctx = { route: "user:1", source: "chat", stage: "send-file" };

  await uploadGroupFile(client, 42, "/tmp/demo.png", "demo.png", "folder-9", ctx);
  await uploadPrivateFile(client, 1001, "/tmp/a.txt", "a.txt", ctx);
  await sendOnlineFile(client, 1001, "/tmp/big.zip", "big.zip", ctx);

  assert.deepEqual(
    calls.map((it) => it.action),
    ["upload_group_file", "upload_private_file", "send_online_file"],
  );
  assert.deepEqual(calls[0].params, {
    group_id: 42,
    file: "/tmp/demo.png",
    name: "demo.png",
    folder_id: "folder-9",
  });
  assert.deepEqual(calls[2].params, {
    user_id: 1001,
    file_path: "/tmp/big.zip",
    file_name: "big.zip",
  });
});
