import test from "node:test";
import assert from "node:assert/strict";

import {
  getCookies,
  getCredentials,
  getCsrfToken,
  getStatus,
  getStrangerInfo,
  getVersionInfo,
} from "../.test-dist/src/services/account-capability-service.js";

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

test("account capability service maps NapCat actions", async () => {
  const { calls, client } = createClient();
  const ctx = { route: "system", source: "chat", stage: "capability" };
  await getStatus(client, ctx);
  await getVersionInfo(client, ctx);
  await getStrangerInfo(client, 1001, true, ctx);
  await getCookies(client, "qq.com", ctx);
  await getCsrfToken(client, ctx);
  await getCredentials(client, "qq.com", ctx);
  assert.deepEqual(
    calls.map((it) => it.action),
    ["get_status", "get_version_info", "get_stranger_info", "get_cookies", "get_csrf_token", "get_credentials"],
  );
  assert.deepEqual(calls[2].params, { user_id: 1001, no_cache: true });
});
