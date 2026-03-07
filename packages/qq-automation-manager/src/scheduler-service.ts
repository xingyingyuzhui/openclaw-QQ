import type { OpenClawPluginApi, OpenClawPluginService } from "openclaw/plugin-sdk";
import { resolveWorkspaceRoot, normalizeManagerConfig } from "./lib/target-config.js";
import { reconcileOnce } from "./reconcile.js";

export function createSchedulerService(api: OpenClawPluginApi): OpenClawPluginService {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const tick = async (workspaceDir?: string) => {
    if (running) return;
    running = true;
    try {
      const cfg = api.runtime.config.loadConfig();
      const workspaceRoot = resolveWorkspaceRoot(cfg, workspaceDir);
      await reconcileOnce(api, workspaceRoot);
    } catch (err) {
      api.logger.warn(`qq-automation-manager: reconcile failed: ${String(err)}`);
    } finally {
      running = false;
    }
  };

  return {
    id: "qq-automation-manager",
    start: async (ctx) => {
      const cfg = api.runtime.config.loadConfig();
      const manager = normalizeManagerConfig(cfg, api.logger);
      if (manager.reconcileOnStartup !== false) {
        await tick(ctx.workspaceDir);
      }
      const intervalMs = Math.max(15_000, Number(manager.reconcileIntervalMs || 120_000));
      timer = setInterval(() => {
        void tick(ctx.workspaceDir);
      }, intervalMs);
      timer.unref?.();
      api.logger.info(`qq-automation-manager: internal scheduler started (intervalMs=${intervalMs})`);
    },
    stop: async () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      api.logger.info("qq-automation-manager: service stopped");
    },
  };
}
