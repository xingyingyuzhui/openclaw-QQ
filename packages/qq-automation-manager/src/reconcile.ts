import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { readJson, statePath, writeJson } from "./lib/state-store.js";
import {
  type ReconcileState,
  isValidRoute,
  normalizeManagerConfig,
} from "./lib/target-config.js";
import { reconcileTarget } from "./reconcile-target.js";

export async function reconcileOnce(api: OpenClawPluginApi, workspaceRoot: string): Promise<void> {
  const cfg = api.runtime.config.loadConfig();
  const manager = normalizeManagerConfig(cfg, api.logger);
  if (!manager.enabled) return;

  const file = statePath(workspaceRoot);
  const prev = (await readJson<ReconcileState>(file)) || { version: 2, targets: {}, updatedAt: new Date().toISOString() };
  const next: ReconcileState = { version: 2, targets: {}, updatedAt: new Date().toISOString() };
  const nowMs = Date.now();

  for (const target of manager.targets) {
    if (!isValidRoute(target.route)) {
      api.logger.warn(`qq-automation-manager: invalid route target=${target.id} route=${target.route}`);
      continue;
    }
    if (manager.strictAgentOnly !== false && target.executionMode !== "agent-only") {
      api.logger.warn(`qq-automation-manager: target=${target.id} blocked by strictAgentOnly (executionMode=${target.executionMode})`);
      continue;
    }
    next.targets[target.id] = await reconcileTarget({
      api,
      workspaceRoot,
      target,
      previousState: prev.targets[target.id],
      nowMs,
    });
  }

  next.updatedAt = new Date().toISOString();
  await writeJson(file, next);
}
