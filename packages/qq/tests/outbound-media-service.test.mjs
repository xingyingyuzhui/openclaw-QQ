import test from "node:test";
import assert from "node:assert/strict";

import { cleanStreamTemp, uploadFileStream } from "../.test-dist/src/services/outbound-media-service.js";
import { supportsStreamTransport, uploadFileStreamIfAvailable } from "../.test-dist/src/media/stream-adapter.js";

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

test("uploadFileStream and cleanStreamTemp attach stream context defaults", async () => {
  const { calls, client } = createClient();
  await uploadFileStream(client, { file: "/tmp/a.png" }, { route: "user:1", attemptId: "a1" });
  await cleanStreamTemp(client, { route: "user:1" });
  assert.deepEqual(calls[0], {
    action: "upload_file_stream",
    params: { file: "/tmp/a.png" },
    ctx: {
      route: "user:1",
      msgId: undefined,
      dispatchId: undefined,
      attemptId: "a1",
      source: "chat",
      stage: "stream-upload",
    },
  });
  assert.deepEqual(calls[1], {
    action: "clean_stream_temp_file",
    params: {},
    ctx: {
      route: "user:1",
      source: "chat",
      stage: "stream-clean",
    },
  });
});

test("supportsStreamTransport probes clean endpoint unless disabled", async () => {
  const { client } = createClient();
  assert.equal(await supportsStreamTransport(client, { streamTransportEnabled: true }, { route: "user:1" }), true);
  assert.equal(await supportsStreamTransport(client, { streamTransportEnabled: false }, { route: "user:1" }), false);
});

test("uploadFileStreamIfAvailable tries file/path/file_path until one succeeds", async () => {
  const { calls, client } = createClient({
    upload_file_stream: (() => {
      let count = 0;
      return (params) => {
        count += 1;
        if (count === 1) throw new Error("first failed");
        if (count === 2) return { path: "/tmp/stream-2" };
        return { file_path: "/tmp/stream-3" };
      };
    })(),
  });
  const result = await uploadFileStreamIfAvailable(client, "/tmp/demo.png", { streamTransportEnabled: true }, { route: "user:1" });
  assert.equal(result, "/tmp/stream-2");
  assert.deepEqual(calls.map((it) => it.params), [{ file: "/tmp/demo.png" }, { path: "/tmp/demo.png" }]);
});

test("uploadFileStreamIfAvailable returns null when disabled or all candidates fail", async () => {
  const disabled = createClient();
  assert.equal(await uploadFileStreamIfAvailable(disabled.client, "/tmp/demo.png", { streamTransportEnabled: false }, { route: "user:1" }), null);

  const failing = createClient({ upload_file_stream: new Error("nope") });
  assert.equal(await uploadFileStreamIfAvailable(failing.client, "/tmp/demo.png", { streamTransportEnabled: true }, { route: "user:1" }), null);
});
