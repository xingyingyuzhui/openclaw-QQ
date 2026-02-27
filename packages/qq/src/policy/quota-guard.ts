import { isOwnerPrivateRoute, isValidQQRoute } from "../routing.js";
import { readRouteCapabilityPolicy, readRouteUsageStats } from "../session-store.js";

export async function checkRouteUsageQuota(
  workspaceRoot: string,
  route: string,
  kind: "sendText" | "sendMedia" | "sendVoice",
): Promise<void> {
  if (!isValidQQRoute(route) || isOwnerPrivateRoute(route)) return;
  const caps = await readRouteCapabilityPolicy(workspaceRoot, route);
  const usage = await readRouteUsageStats(workspaceRoot, route);
  const limit = kind === "sendText" ? caps.maxSendText : kind === "sendMedia" ? caps.maxSendMedia : caps.maxSendVoice;
  if (limit === null || limit === undefined) return;
  const used = kind === "sendText" ? usage.sendTextCount : kind === "sendMedia" ? usage.sendMediaCount : usage.sendVoiceCount;
  if (used >= limit) throw new Error(`Route policy quota exceeded for ${route}: ${kind} ${used}/${limit}`);
}

export async function getRouteSendBudget(workspaceRoot: string, route: string) {
  const caps = await readRouteCapabilityPolicy(workspaceRoot, route);
  const usage = await readRouteUsageStats(workspaceRoot, route);
  const mediaRemaining = caps.sendMedia
    ? caps.maxSendMedia == null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, caps.maxSendMedia - usage.sendMediaCount)
    : 0;
  const voiceRemaining = caps.sendVoice
    ? caps.maxSendVoice == null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, caps.maxSendVoice - usage.sendVoiceCount)
    : 0;
  return { caps, usage, mediaRemaining, voiceRemaining };
}
