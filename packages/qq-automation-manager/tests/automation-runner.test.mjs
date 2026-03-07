import test from "node:test";
import assert from "node:assert/strict";

import { buildAgentPrompt } from "../.test-dist/src/lib/automation-runner.js";

test("buildAgentPrompt keeps tasks on direct natural reply path", () => {
  const prompt = buildAgentPrompt({
    id: "t1",
    enabled: true,
    route: "user:123456789",
    executionMode: "agent-only",
    job: {
      type: "cron-agent-turn",
      schedule: { kind: "every", everyMs: 60000 },
      message: "自然聊一句。",
    },
  });
  assert.match(prompt, /只输出给用户的一条自然消息/);
  assert.doesNotMatch(prompt, /sessions_spawn/);
});
