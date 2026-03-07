import type { NapCatAction } from "../contracts/index.js";

type ActionSupportState = "unknown" | "supported" | "unsupported";

type AccountCapabilityMap = Map<string, ActionSupportState>;

const state = new Map<string, AccountCapabilityMap>();

function getAccountMap(accountId: string): AccountCapabilityMap {
  const key = String(accountId || "default").trim() || "default";
  if (!state.has(key)) state.set(key, new Map());
  return state.get(key)!;
}

export function getActionSupportState(accountId: string, action: NapCatAction | string): ActionSupportState {
  return getAccountMap(accountId).get(String(action)) || "unknown";
}

export function markActionSupported(accountId: string, action: NapCatAction | string): void {
  getAccountMap(accountId).set(String(action), "supported");
}

export function markActionUnsupported(accountId: string, action: NapCatAction | string): void {
  getAccountMap(accountId).set(String(action), "unsupported");
}

export function resetAccountCapability(accountId: string): void {
  state.delete(String(accountId || "default").trim() || "default");
}
