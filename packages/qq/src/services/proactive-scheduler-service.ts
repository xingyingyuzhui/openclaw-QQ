import { buildResidentSessionKey, parseTarget, routeToResidentAgentId } from "../routing.js";
import { checkConversationPolicyHook } from "../policy/capability-guard.js";
import { checkRouteUsageQuota } from "../policy/quota-guard.js";
import { resolveAccountWorkspaceRoot } from "../state/account-runtime-registry.js";
import { getRouteLastInboundAt, getRouteLastProactiveAt, setRouteLastProactiveAt } from "../state/route-runtime-registry.js";
import { hydrateProactiveStateOnce, persistProactiveState, shouldLogProactiveSkip } from "./proactive-state-service.js";
import type { ResolvedQQAccount } from "../types/channel.js";

export function shouldEnableProactiveScheduler(account: ResolvedQQAccount): boolean {
  const config = account.config as any;
  return config?.proactiveUseCoreScheduler !== false;
}

export async function evaluateProactiveTick(params: {
  accountId: string;
  account: ResolvedQQAccount;
  nowMs: number;
  nudges: readonly string[];
}): Promise<any> {
  const { accountId, account, nowMs, nudges } = params;
  const config = account.config as any;
  const proactiveVerbose = config.proactiveDmLogVerbose === true;
  const accountWorkspaceRoot = resolveAccountWorkspaceRoot(accountId);

  if (config.proactiveDmEnabled !== true) {
    if (shouldLogProactiveSkip(proactiveVerbose, "disabled")) {
      console.log(`[QQ][qq_proactive_skip] account_id=${accountId} route= skip_reason=disabled`);
    }
    return { route: "", allowed: false, skipReason: "disabled" };
  }

  const route = String(config.proactiveDmRoute || "user:123456789").trim();
  if (!/^user:\d{5,12}$/.test(route)) {
    if (shouldLogProactiveSkip(proactiveVerbose, "invalid_route")) {
      console.log(`[QQ][qq_proactive_skip] account_id=${accountId} route=${route} skip_reason=invalid_route`);
    }
    return { route, allowed: false, skipReason: "invalid_route" };
  }

  await hydrateProactiveStateOnce(accountWorkspaceRoot, accountId, route, proactiveVerbose);
  const target = parseTarget(route);
  if (!target || target.kind !== "user") {
    if (shouldLogProactiveSkip(proactiveVerbose, "invalid_route")) {
      console.log(`[QQ][qq_proactive_skip] account_id=${accountId} route=${route} skip_reason=invalid_route`);
    }
    return { route, allowed: false, skipReason: "invalid_route" };
  }

  const lastInbound = getRouteLastInboundAt(accountId, route);
  const lastProactive = getRouteLastProactiveAt(accountId, route);
  const lastInboundAgo = lastInbound > 0 ? Math.max(0, nowMs - lastInbound) : -1;
  const lastProactiveAgo = lastProactive > 0 ? Math.max(0, nowMs - lastProactive) : -1;
  if (proactiveVerbose) {
    console.log(
      `[QQ][qq_proactive_tick] account_id=${accountId} route=${route} now=${nowMs} last_inbound_ms_ago=${lastInboundAgo} last_proactive_ms_ago=${lastProactiveAgo}`,
    );
  }

  if (!lastInbound) {
    if (shouldLogProactiveSkip(proactiveVerbose, "no_inbound_yet")) {
      console.log(`[QQ][qq_proactive_skip] account_id=${accountId} route=${route} skip_reason=no_inbound_yet`);
    }
    return {
      route,
      allowed: false,
      skipReason: "no_inbound_yet",
      sessionKey: buildResidentSessionKey(route),
      agentId: routeToResidentAgentId(route),
      stateBefore: { lastInboundAt: lastInbound, lastProactiveAt: lastProactive },
      stateAfter: { lastInboundAt: lastInbound, lastProactiveAt: lastProactive },
    };
  }

  const minSilence = Math.max(60_000, Number(config.proactiveDmMinSilenceMs ?? 90 * 60 * 1000));
  const minInterval = Math.max(60_000, Number(config.proactiveDmMinIntervalMs ?? 2 * 60 * 60 * 1000));
  if (nowMs - lastInbound < minSilence) {
    if (shouldLogProactiveSkip(proactiveVerbose, "silence_not_reached")) {
      console.log(
        `[QQ][qq_proactive_skip] account_id=${accountId} route=${route} skip_reason=silence_not_reached last_inbound_ms_ago=${lastInboundAgo} threshold_ms=${minSilence}`,
      );
    }
    return {
      route,
      allowed: false,
      skipReason: "silence_not_reached",
      sessionKey: buildResidentSessionKey(route),
      agentId: routeToResidentAgentId(route),
      stateBefore: { lastInboundAt: lastInbound, lastProactiveAt: lastProactive },
      stateAfter: { lastInboundAt: lastInbound, lastProactiveAt: lastProactive },
    };
  }

  if (nowMs - lastProactive < minInterval) {
    if (shouldLogProactiveSkip(proactiveVerbose, "interval_not_reached")) {
      console.log(
        `[QQ][qq_proactive_skip] account_id=${accountId} route=${route} skip_reason=interval_not_reached last_proactive_ms_ago=${lastProactiveAgo} threshold_ms=${minInterval}`,
      );
    }
    return {
      route,
      allowed: false,
      skipReason: "interval_not_reached",
      sessionKey: buildResidentSessionKey(route),
      agentId: routeToResidentAgentId(route),
      stateBefore: { lastInboundAt: lastInbound, lastProactiveAt: lastProactive },
      stateAfter: { lastInboundAt: lastInbound, lastProactiveAt: lastProactive },
    };
  }

  try {
    await checkConversationPolicyHook(config, accountWorkspaceRoot, "beforeOutbound", route, "sendText");
  } catch (err: any) {
    console.warn(
      `[QQ][qq_proactive_skip] account_id=${accountId} route=${route} skip_reason=policy_blocked error=${err?.message || err}`,
    );
    return {
      route,
      allowed: false,
      skipReason: "policy_blocked",
      sessionKey: buildResidentSessionKey(route),
      agentId: routeToResidentAgentId(route),
    };
  }

  try {
    await checkRouteUsageQuota(accountWorkspaceRoot, route, "sendText");
  } catch (err: any) {
    console.warn(
      `[QQ][qq_proactive_skip] account_id=${accountId} route=${route} skip_reason=quota_exceeded error=${err?.message || err}`,
    );
    return {
      route,
      allowed: false,
      skipReason: "quota_exceeded",
      sessionKey: buildResidentSessionKey(route),
      agentId: routeToResidentAgentId(route),
    };
  }

  const messageText = nudges[Math.floor(Math.random() * nudges.length)] || nudges[0];
  return {
    route,
    allowed: true,
    messageText,
    sessionKey: buildResidentSessionKey(route),
    agentId: routeToResidentAgentId(route),
    stateBefore: { lastInboundAt: lastInbound, lastProactiveAt: lastProactive },
    stateAfter: { lastInboundAt: lastInbound, lastProactiveAt: nowMs },
  };
}

export async function markProactiveSent(params: {
  accountId: string;
  account: ResolvedQQAccount;
  resultRoute: string;
  nowMs: number;
}): Promise<void> {
  const { accountId, account, resultRoute, nowMs } = params;
  const route = String(resultRoute || "").trim();
  if (!route) return;
  const config = account.config as any;
  const verbose = config.proactiveDmLogVerbose === true;
  setRouteLastProactiveAt(accountId, route, nowMs);
  await persistProactiveState(resolveAccountWorkspaceRoot(accountId), accountId, route, verbose);
  console.log(`[QQ][qq_proactive_send] account_id=${accountId} route=${route} result=success dispatch_ms=0 retry_count=0`);
}

export function markProactiveFailed(params: { accountId: string; resultRoute: string; error: string }): void {
  const route = String(params.resultRoute || "").trim();
  console.warn(
    `[QQ][qq_proactive_send] account_id=${params.accountId} route=${route} result=failed dispatch_ms=0 retry_count=0 error=${params.error}`,
  );
}
