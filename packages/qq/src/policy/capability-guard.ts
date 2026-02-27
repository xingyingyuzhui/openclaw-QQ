import type { QQConfig } from "../config.js";
import { isOwnerPrivateRoute, isValidQQRoute } from "../routing.js";
import { readRouteCapabilityPolicy } from "../session-store.js";

export type PolicyStage = "beforeDispatch" | "beforeOutbound";
export type PolicyAction = "sendText" | "sendMedia" | "sendTTS" | "useSkill";

export async function checkConversationPolicyHook(
  config: QQConfig,
  workspaceRoot: string,
  stage: PolicyStage,
  route: string,
  action?: PolicyAction,
): Promise<void> {
  void config;
  if (!isValidQQRoute(route)) throw new Error(`Invalid policy route: ${route}`);
  if (isOwnerPrivateRoute(route)) return;
  const capabilities = await readRouteCapabilityPolicy(workspaceRoot, route);
  if (stage === "beforeDispatch" && !capabilities.sendText) {
    throw new Error(`Route policy blocks dispatch for ${route}`);
  }
  if (!action) return;
  if (action === "sendText" && !capabilities.sendText) throw new Error(`Route policy blocks text send for ${route}`);
  if (action === "sendMedia" && !capabilities.sendMedia) throw new Error(`Route policy blocks media send for ${route}`);
  if (action === "sendTTS" && !capabilities.sendVoice) throw new Error(`Route policy blocks voice send for ${route}`);
}
