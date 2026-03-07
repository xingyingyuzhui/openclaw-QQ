import { readProactiveState, writeProactiveState } from "../session-store.js";
import {
  getRouteLastInboundAt,
  getRouteLastProactiveAt,
  isProactiveStateHydrated,
  markProactiveStateHydrated,
  setRouteLastInboundAt,
  setRouteLastProactiveAt,
} from "../state/route-runtime-registry.js";

export function shouldLogProactiveSkip(verbose: boolean, reason: string): boolean {
  if (verbose) return true;
  return (
    reason === "tick_busy" ||
    reason === "invalid_route" ||
    reason === "policy_blocked" ||
    reason === "quota_exceeded"
  );
}

export async function hydrateProactiveStateOnce(
  workspaceRoot: string,
  accountId: string,
  route: string,
  verbose: boolean,
): Promise<void> {
  if (isProactiveStateHydrated(accountId, route)) return;
  markProactiveStateHydrated(accountId, route);
  try {
    const state = await readProactiveState(workspaceRoot, route);
    if (state) {
      setRouteLastInboundAt(accountId, route, Number(state.lastInboundAt || 0));
      setRouteLastProactiveAt(accountId, route, Number(state.lastProactiveAt || 0));
      if (verbose) {
        console.log(
          `[QQ][qq_proactive_state] account_id=${accountId} route=${route} action=load result=success last_inbound_at=${Number(state.lastInboundAt || 0)} last_proactive_at=${Number(state.lastProactiveAt || 0)}`,
        );
      }
    } else if (verbose) {
      console.log(`[QQ][qq_proactive_state] account_id=${accountId} route=${route} action=load result=empty`);
    }
  } catch (err: any) {
    console.warn(
      `[QQ][qq_proactive_state] account_id=${accountId} route=${route} action=load result=failed error=${err?.message || err}`,
    );
  }
}

export async function persistProactiveState(
  workspaceRoot: string,
  accountId: string,
  route: string,
  verbose: boolean,
): Promise<void> {
  const state = {
    lastInboundAt: getRouteLastInboundAt(accountId, route),
    lastProactiveAt: getRouteLastProactiveAt(accountId, route),
    updatedAt: new Date().toISOString(),
  };
  try {
    await writeProactiveState(workspaceRoot, route, state);
    if (verbose) {
      console.log(
        `[QQ][qq_proactive_state] account_id=${accountId} route=${route} action=save result=success last_inbound_at=${state.lastInboundAt} last_proactive_at=${state.lastProactiveAt}`,
      );
    }
  } catch (err: any) {
    console.warn(
      `[QQ][qq_proactive_state] account_id=${accountId} route=${route} action=save result=failed error=${err?.message || err}`,
    );
  }
}
