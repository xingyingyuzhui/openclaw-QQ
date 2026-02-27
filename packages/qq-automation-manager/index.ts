import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createQqAutomationManagerService } from "./src/service.js";

const plugin = {
  id: "qq-automation-manager",
  name: "QQ Automation Manager",
  description: "Run route-scoped QQ automation scheduler and trigger agent turns",
  configSchema: {
    type: "object",
    additionalProperties: true,
    properties: {},
  },
  register(api: OpenClawPluginApi) {
    api.registerService(createQqAutomationManagerService(api));
  },
};

export default plugin;
