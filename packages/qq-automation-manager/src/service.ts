import type { OpenClawPluginApi, OpenClawPluginService } from "openclaw/plugin-sdk";
import { createSchedulerService } from "./scheduler-service.js";

export function createQqAutomationManagerService(api: OpenClawPluginApi): OpenClawPluginService {
  return createSchedulerService(api);
}
