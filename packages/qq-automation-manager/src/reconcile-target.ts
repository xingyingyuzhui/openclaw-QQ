import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { buildAutomationRecord, triggerAgentTurn } from "./lib/automation-runner.js";
import { readAutomationRoleContext, type AutomationRoleContext } from "./lib/role-context.js";
import { ensureAgentRegistered, resolveAgentId } from "./lib/route-agent-resolver.js";
import { randomMinutes, shouldRunNow } from "./lib/schedule-evaluator.js";
import { appendRouteState, bumpAutomationRelationshipState, readRecentRouteTimes } from "./lib/state-store.js";
import {
  type CronSchedule,
  type TargetConfig,
  type TargetSmartConfig,
  type TargetState,
  stableHash,
} from "./lib/target-config.js";

export type ReconcileTargetDeps = {
  resolveAgentId: typeof resolveAgentId;
  ensureAgentRegistered: typeof ensureAgentRegistered;
  readRecentRouteTimes: typeof readRecentRouteTimes;
  shouldRunNow: typeof shouldRunNow;
  triggerAgentTurn: typeof triggerAgentTurn;
  readAutomationRoleContext: typeof readAutomationRoleContext;
  bumpAutomationRelationshipState: typeof bumpAutomationRelationshipState;
  appendRouteState: typeof appendRouteState;
  buildAutomationRecord: typeof buildAutomationRecord;
};

function defaultReconcileTargetDeps(): ReconcileTargetDeps {
  return {
    resolveAgentId,
    ensureAgentRegistered,
    readRecentRouteTimes,
    shouldRunNow,
    triggerAgentTurn,
    readAutomationRoleContext,
    bumpAutomationRelationshipState,
    appendRouteState,
    buildAutomationRecord,
  };
}

export function buildBaseState(target: TargetConfig, agentId: string, prev: TargetState | undefined): TargetState {
  const desiredHash = stableHash({
    route: target.route,
    agentId,
    schedule: target.job.schedule,
    message: target.job.message,
    thinking: target.job.thinking || "",
    model: target.job.model || "",
    smart: target.job.smart || {},
    executionMode: target.executionMode,
  });
  return {
    hash: desiredHash,
    route: target.route,
    agentId,
    lastTriggeredAtMs: Number(prev?.lastTriggeredAtMs || 0),
    lastSentAtMs: Number(prev?.lastSentAtMs || 0),
    nextEligibleAtMs: Number(prev?.nextEligibleAtMs || 0),
    lastInboundAtMs: Number(prev?.lastInboundAtMs || 0),
    lastOutboundAtMs: Number(prev?.lastOutboundAtMs || 0),
    lastRunResult: prev?.lastRunResult || "idle",
    lastSkipReason: prev?.lastSkipReason,
    lastError: prev?.lastError,
    atDone: Boolean(prev?.atDone),
    lastCronBucket: prev?.lastCronBucket,
    updatedAt: new Date().toISOString(),
  };
}

export function evaluateSmartSkip(
  target: TargetConfig,
  base: TargetState,
  times: { lastInboundAtMs: number; lastOutboundAtMs: number },
  nowMs: number,
  roleContext?: AutomationRoleContext | null,
): string {
  const smart = (target.job.smart || {}) as TargetSmartConfig;
  if (smart.enabled === false) return "";

  let minSilenceMinutes = Math.max(1, Number(smart.minSilenceMinutes || 30));
  const activeConversationMinutes = Math.max(1, Number(smart.activeConversationMinutes || 25));
  const randomMin = Math.max(1, Number(smart.randomIntervalMinMinutes || 30));
  const randomMax = Math.max(randomMin, Number(smart.randomIntervalMaxMinutes || 60));
  if (roleContext?.initiativeLevel === "low") {
    minSilenceMinutes += Math.max(0, Number(smart.lowInitiativeExtraSilenceMinutes || 15));
  }
  if ((roleContext?.affinity ?? 50) < 40) {
    minSilenceMinutes += Math.max(0, Number(smart.lowAffinityExtraSilenceMinutes || 15));
  }
  if (smart.coldStageSkip !== false && roleContext?.affinityStage === "distant" && roleContext?.initiativeLevel === "low") {
    return "relationship_guarded";
  }
  const minSilenceMs = minSilenceMinutes * 60_000;
  const activeMs = activeConversationMinutes * 60_000;

  if (!times.lastInboundAtMs) return "no_inbound_yet";
  if (nowMs - times.lastInboundAtMs < minSilenceMs) return "silence_not_reached";
  if (
    times.lastInboundAtMs > 0 &&
    times.lastOutboundAtMs > 0 &&
    Math.max(times.lastInboundAtMs, times.lastOutboundAtMs) >= nowMs - activeMs
  ) {
    return "active_conversation";
  }
  if (!base.nextEligibleAtMs && base.lastSentAtMs > 0) {
    base.nextEligibleAtMs = base.lastSentAtMs + randomMinutes(randomMin, randomMax) * 60_000;
  }
  if (base.nextEligibleAtMs > nowMs) return "interval_not_reached";
  return "";
}

async function appendRecord(
  api: OpenClawPluginApi,
  workspaceRoot: string,
  deps: ReconcileTargetDeps,
  params: {
    targetId: string;
    route: string;
    scheduleKind: CronSchedule["kind"];
    agentId: string;
    triggered: boolean;
    produced: boolean;
    skipped: boolean;
    sentByChannel: boolean | null;
    runMs: number;
    note: string;
    roleContext?: AutomationRoleContext | null;
  },
): Promise<void> {
  const rec = deps.buildAutomationRecord(params);
  await deps.appendRouteState(workspaceRoot, params.route, rec).catch((err) => {
    api.logger.warn(`qq-automation-manager: append route state failed target=${params.targetId}: ${String(err)}`);
  });
}

export async function reconcileTarget(params: {
  api: OpenClawPluginApi;
  workspaceRoot: string;
  target: TargetConfig;
  previousState?: TargetState;
  nowMs: number;
  deps?: Partial<ReconcileTargetDeps>;
}): Promise<TargetState> {
  const { api, workspaceRoot, target, previousState, nowMs } = params;
  const deps = { ...defaultReconcileTargetDeps(), ...(params.deps || {}) };
  const agentId = await deps.resolveAgentId(workspaceRoot, target.route);
  const schedule = target.job.schedule as CronSchedule;
  const base = buildBaseState(target, agentId, previousState);
  const roleContext = await deps.readAutomationRoleContext({ workspaceRoot, route: target.route, agentId }).catch(() => null);

  try {
    await deps.ensureAgentRegistered(api, workspaceRoot, agentId);
  } catch (err) {
    const ensureRegisterError = String(err);
    api.logger.warn(
      `qq-automation-manager: ensure agent registered failed target=${target.id} route=${target.route} agent=${agentId} error=${ensureRegisterError}`,
    );
    base.lastRunResult = "failed";
    base.lastError = `ensure_agent_registered_failed: ${ensureRegisterError}`;
    base.updatedAt = new Date().toISOString();
    await appendRecord(api, workspaceRoot, deps, {
      targetId: target.id,
      route: target.route,
      scheduleKind: schedule.kind,
      agentId,
      triggered: false,
      produced: false,
      skipped: false,
      sentByChannel: null,
      runMs: 0,
      note: "error:ensure_agent_registered_failed",
    });
    return base;
  }

  const times = await deps.readRecentRouteTimes(workspaceRoot, target.route);
  base.lastInboundAtMs = times.lastInboundAtMs;
  base.lastOutboundAtMs = times.lastOutboundAtMs;

  if (!target.enabled) {
    base.lastRunResult = "idle";
    base.updatedAt = new Date().toISOString();
    return base;
  }

  const due = deps.shouldRunNow(schedule, base, nowMs);
  if (due.nextStatePatch) Object.assign(base, due.nextStatePatch);
  if (!due.due) {
    base.updatedAt = new Date().toISOString();
    return base;
  }

  const skipReason = evaluateSmartSkip(target, base, times, nowMs, roleContext);
  if (skipReason) {
    base.lastTriggeredAtMs = nowMs;
    base.lastRunResult = "skipped";
    base.lastSkipReason = skipReason;
    base.lastError = "";
    base.updatedAt = new Date().toISOString();
    api.logger.info(
      `qq-automation-manager: skip target=${target.id} route=${target.route} reason=${skipReason} last_inbound_ms_ago=${times.lastInboundAtMs ? nowMs - times.lastInboundAtMs : -1}`,
    );
    await appendRecord(api, workspaceRoot, deps, {
      targetId: target.id,
      route: target.route,
      scheduleKind: schedule.kind,
      agentId,
      triggered: true,
      produced: false,
      skipped: true,
      sentByChannel: null,
      runMs: 0,
      note: `skip:${skipReason}`,
      roleContext,
    });
    return base;
  }

  const started = Date.now();
  const sendResult = await deps.triggerAgentTurn(api, target, agentId, workspaceRoot);
  const duration = Date.now() - started;
  base.lastTriggeredAtMs = nowMs;
  if (sendResult.ok) {
    const randomMin = Math.max(1, Number((target.job.smart || {}).randomIntervalMinMinutes || 30));
    const randomMax = Math.max(randomMin, Number((target.job.smart || {}).randomIntervalMaxMinutes || 60));
    base.lastSentAtMs = nowMs;
    base.nextEligibleAtMs = nowMs + randomMinutes(randomMin, randomMax) * 60_000;
    base.lastRunResult = "sent";
    base.lastSkipReason = "";
    base.lastError = "";
    api.logger.info(
      `qq-automation-manager: triggered target=${target.id} route=${target.route} result=sent durationMs=${duration} summary=${JSON.stringify(
        String(sendResult.summary || "").slice(0, 180),
      )}`,
    );
    await deps.bumpAutomationRelationshipState({
      workspaceRoot,
      agentId,
      route: target.route,
    }).catch(() => null);
  } else {
    base.lastRunResult = "failed";
    base.lastError = String(sendResult.error || "trigger_failed");
    api.logger.warn(
      `qq-automation-manager: trigger failed target=${target.id} route=${target.route} durationMs=${duration} error=${base.lastError}`,
    );
  }

  base.updatedAt = new Date().toISOString();
  await appendRecord(api, workspaceRoot, deps, {
    targetId: target.id,
    route: target.route,
    scheduleKind: schedule.kind,
    agentId,
    triggered: true,
    produced: Boolean(sendResult.ok),
    skipped: false,
    sentByChannel: sendResult.ok ? true : null,
    runMs: duration,
    note: sendResult.ok ? "sent" : `error:${sendResult.error || "trigger_failed"}`,
    roleContext,
  });
  return base;
}
