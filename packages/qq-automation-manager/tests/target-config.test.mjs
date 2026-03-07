import test from "node:test";
import assert from "node:assert/strict";

import {
  isValidRoute,
  normalizeManagerConfig,
  resolveWorkspaceRoot,
  routeToSessionKey,
} from "../.test-dist/src/lib/target-config.js";

test("route validation accepts supported QQ routes", () => {
  assert.equal(isValidRoute("user:123456789"), true);
  assert.equal(isValidRoute("group:123456789"), true);
  assert.equal(isValidRoute("guild:g1:c9"), true);
  assert.equal(isValidRoute("user:abc"), false);
});

test("routeToSessionKey canonicalizes route separators", () => {
  assert.equal(routeToSessionKey("user:123456789"), "user__123456789");
});

test("resolveWorkspaceRoot prefers config then fallback", () => {
  assert.equal(resolveWorkspaceRoot({ agents: { defaults: { workspace: "/x/workspace" } } }), "/x/workspace");
  assert.equal(resolveWorkspaceRoot({}, "/fallback/workspace"), "/fallback/workspace");
});

test("normalizeManagerConfig parses defaults and target config", () => {
  const warnings = [];
  const cfg = {
    plugins: {
      entries: {
        "qq-automation-manager": {
          config: {
            enabled: true,
            targets: [
              {
                id: "t1",
                route: "user:123456789",
                job: {
                  schedule: { kind: "every", everyMs: 60000 },
                  message: "hello",
                },
              },
            ],
          },
        },
      },
    },
  };
  const parsed = normalizeManagerConfig(cfg, { warn: (msg) => warnings.push(msg) });
  assert.equal(parsed.enabled, true);
  assert.equal(parsed.targets.length, 1);
  assert.equal(parsed.targets[0].executionMode, "agent-only");
  assert.equal(warnings.length, 0);
});
