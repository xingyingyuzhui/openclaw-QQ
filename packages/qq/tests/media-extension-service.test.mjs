import test from "node:test";
import assert from "node:assert/strict";

import {
  fetchCustomFace,
  getRKey,
  ocrImage,
} from "../.test-dist/src/services/media-extension-service.js";

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

test("media extension service maps face, OCR and rkey actions", async () => {
  const { calls, client } = createClient();
  const ctx = { route: "user:1", source: "chat", stage: "media-ext" };
  await fetchCustomFace(client, "face-id", ctx);
  await ocrImage(client, "https://example.com/a.png", ctx);
  await getRKey(client, ctx);
  assert.deepEqual(
    calls.map((it) => it.action),
    ["fetch_custom_face", "ocr_image", "nc_get_rkey"],
  );
});
