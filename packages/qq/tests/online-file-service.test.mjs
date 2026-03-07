import test from "node:test";
import assert from "node:assert/strict";

import {
  cancelOnlineFile,
  getOnlineFileMessage,
  receiveOnlineFile,
  refuseOnlineFile,
} from "../.test-dist/src/services/online-file-service.js";

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

test("online file service maps inspect/receive/refuse/cancel actions", async () => {
  const { calls, client } = createClient();
  const ctx = { route: "user:1", source: "chat", stage: "online-file" };
  await getOnlineFileMessage(client, 11, ctx);
  await receiveOnlineFile(client, 1001, "file-1", "/tmp/a.zip", ctx);
  await refuseOnlineFile(client, 1001, "file-1", ctx);
  await cancelOnlineFile(client, 1001, "file-1", ctx);
  assert.deepEqual(
    calls.map((it) => it.action),
    ["get_online_file_msg", "receive_online_file", "refuse_online_file", "cancel_online_file"],
  );
  assert.deepEqual(calls[1].params, { user_id: 1001, file_id: "file-1", file_path: "/tmp/a.zip" });
});
