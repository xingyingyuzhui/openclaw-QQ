import type { ReplyPayload } from "openclaw/plugin-sdk";
import type { OneBotClient } from "../client.js";
import { logQQTrace } from "../diagnostics/logger.js";
import { checkConversationPolicyHook } from "../policy/capability-guard.js";
import { bumpRouteUsage } from "../session-store.js";
import { withTimeout } from "../utils/timeouts.js";
import { setInputStatus } from "../services/message-service.js";
import {
  classifyPostCoalesceDisposition,
  resolveInterruptCoalesceMs,
  shouldSendBusyFollowupHint,
} from "./dispatch-policy.js";
import { handleBusyRouteQueue, handleDispatchFailure } from "./dispatch-flow.js";
import {
  beginRouteInFlight,
  claimRoutePendingLatest,
  clearRouteInFlight,
  clearRoutePendingLatest,
  getRouteInFlight,
  getRoutePendingLatest,
  hasRouteInFlight,
  markRouteDispatchTimeout,
  upsertRoutePendingLatest,
} from "../core/runtime-context.js";
import { getRouteInboundSeq } from "../state/route-runtime-registry.js";

export async function runInboundDispatchCycle(params: {
  route: string;
  routeGen: number;
  msgIdText: string;
  inboundSeq: number;
  hasInboundMediaLike: boolean;
  mediaItemsTotal: number;
  text: string;
  userId: number;
  isGroup: boolean;
  isGuild: boolean;
  aggregateWindowMs: number;
  routePreemptOldRun: boolean;
  replyRunTimeoutMs: number;
  replyAbortOnTimeout: boolean;
  config: any;
  runtime: any;
  cfg: any;
  ctxPayload: any;
  dispatcher: any;
  replyOptions: any;
  accountId: string;
  accountWorkspaceRoot: string;
  residentAgentId: string;
  residentSessionKey: string;
  sleep: (ms: number) => Promise<void>;
  client: OneBotClient;
  isRouteGenerationCurrent: (route: string, generation: number) => boolean;
  deliver: (payload: ReplyPayload) => Promise<void>;
  persistTaskState: (
    state: "queued" | "running" | "succeeded" | "failed" | "timeout",
    extra?: Record<string, unknown>,
  ) => Promise<void>;
  state: {
    getDispatchId: () => string;
    setDispatchId: (dispatchId: string) => void;
    getRouteHadDelivered: () => boolean;
    setRouteHadDelivered: (value: boolean) => void;
    getRouteHadMediaDelivered: () => boolean;
    setRouteHadMediaDelivered: (value: boolean) => void;
    getRouteHadFallbackEligibleDrop: () => boolean;
  };
  canSendFallbackNow: () => boolean;
  recordFallbackSent: () => void;
  sendFallbackAfterDispatchError: (args: {
    dispatchId: string;
    fallbackText: string;
  }) => Promise<boolean>;
}): Promise<void> {
  const {
    route,
    routeGen,
    msgIdText,
    inboundSeq,
    hasInboundMediaLike,
    mediaItemsTotal,
    text,
    userId,
    isGroup,
    isGuild,
    aggregateWindowMs,
    routePreemptOldRun,
    replyRunTimeoutMs,
    replyAbortOnTimeout,
    config,
    runtime,
    cfg,
    ctxPayload,
    dispatcher,
    replyOptions,
    accountId,
    accountWorkspaceRoot,
    residentAgentId,
    residentSessionKey,
    sleep,
    client,
    isRouteGenerationCurrent,
    deliver,
    persistTaskState,
    state,
    canSendFallbackNow,
    recordFallbackSent,
    sendFallbackAfterDispatchError,
  } = params;

  let inputStatusOpened = false;
  let runTimedOut = false;
  let runSuperseded = false;

  try {
    if (route.startsWith("user:") && !isRouteGenerationCurrent(route, routeGen)) {
      console.warn(
        `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=none run_timeout=false superseded=true drop_reason=route_generation_stale`,
      );
      return;
    }

    const interruptCoalesceEnabled = (config as any).interruptCoalesceEnabled !== false;
    const interruptCoalesceMs = resolveInterruptCoalesceMs(config, aggregateWindowMs);

    const existingInFlight = getRouteInFlight(route);
    if (existingInFlight && !routePreemptOldRun) {
      const queueResult = await handleBusyRouteQueue({
        route,
        msgIdText,
        inboundSeq,
        hasInboundMediaLike,
        text,
        replyRunTimeoutMs,
        interruptCoalesceEnabled,
        persistTaskState,
        deliver,
        sleep,
        upsertRoutePendingLatest,
        hasRouteInFlight,
        claimRoutePendingLatest,
        getRoutePendingLatest,
      });
      if (queueResult !== "continue") {
        return;
      }
    }

    if (existingInFlight && routePreemptOldRun && interruptCoalesceEnabled) {
      try {
        existingInFlight.abortController.abort(new Error("preempted_by_new_inbound_coalesce"));
      } catch {}
      await sleep(interruptCoalesceMs);
      const disposition = classifyPostCoalesceDisposition({
        hasExistingInFlight: true,
        routePreemptOldRun: true,
        interruptCoalesceEnabled,
        currentInboundSeq: getRouteInboundSeq(route),
        expectedInboundSeq: inboundSeq,
      });
      if (disposition !== "continue") {
        console.warn(
          `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=none run_timeout=false superseded=true drop_reason=${disposition}`,
        );
        return;
      }
    }

    if (!existingInFlight && interruptCoalesceEnabled) {
      await sleep(interruptCoalesceMs);
      const disposition = classifyPostCoalesceDisposition({
        hasExistingInFlight: false,
        routePreemptOldRun,
        interruptCoalesceEnabled,
        currentInboundSeq: getRouteInboundSeq(route),
        expectedInboundSeq: inboundSeq,
      });
      if (disposition !== "continue") {
        console.warn(
          `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=none run_timeout=false superseded=true drop_reason=${disposition}`,
        );
        return;
      }
    }

    const inflightBegin = beginRouteInFlight({ route, msgId: msgIdText });
    state.setDispatchId(inflightBegin.current.dispatchId);
    if (inflightBegin.previous && inflightBegin.previous.dispatchId !== state.getDispatchId()) {
      try {
        inflightBegin.previous.abortController.abort(new Error("preempted_by_new_inbound"));
      } catch {}
      console.warn(
        `[QQ][dispatch-trace] route=${route} msg_id=${inflightBegin.previous.msgId || ""} dispatch_id=${inflightBegin.previous.dispatchId} run_timeout=false superseded=true drop_reason=preempted_by_new_inbound`,
      );
    }

    // Fast acknowledgement for heavy tasks to keep chat responsive.
    if (mediaItemsTotal > 0 && !state.getRouteHadDelivered()) {
      try {
        await deliver({ text: "收到，正在处理你刚发的文件/图片，我先开工，稍后给你结果。" });
        state.setRouteHadDelivered(true);
      } catch {}
    }

    if (!isGroup && !isGuild) {
      try {
        await setInputStatus(client, userId, 1, {
          route,
          msgId: msgIdText,
          dispatchId: state.getDispatchId() || undefined,
          source: "chat",
          stage: "typing_open",
        });
        inputStatusOpened = true;
      } catch (e: any) {
        console.warn(`[QQ][typing] open failed user=${userId} err=${e?.message || e}`);
      }
    }

    await checkConversationPolicyHook(config, accountWorkspaceRoot, "beforeDispatch", route);
    await bumpRouteUsage(accountWorkspaceRoot, route, "dispatch");
    console.log(`[QQ][inbound] route=${route} msgId=${msgIdText} dispatch_id=${state.getDispatchId()} stage=dispatch_start`);
    logQQTrace({
      event: "qq_dispatch_start",
      route,
      msg_id: msgIdText,
      dispatch_id: state.getDispatchId(),
      source: "chat",
      agent_id: residentAgentId,
      session_key: residentSessionKey,
      account_id: accountId,
      workspace_root: accountWorkspaceRoot,
    });

    await persistTaskState("running", { dispatchId: state.getDispatchId(), inboundSeq });
    const dispatchStartedAt = Date.now();
    const replyOptionsWithAbort = {
      ...replyOptions,
      abortSignal: inflightBegin.current.abortController.signal,
    } as typeof replyOptions;

    await withTimeout(
      runtime.channel.reply.dispatchReplyFromConfig({ ctx: ctxPayload, cfg, dispatcher, replyOptions: replyOptionsWithAbort }),
      replyRunTimeoutMs,
      "qq_dispatch_run",
      {
        onTimeout: async () => {
          runTimedOut = true;
          markRouteDispatchTimeout(route);
          if (replyAbortOnTimeout) {
            try {
              inflightBegin.current.abortController.abort(new Error("qq_dispatch_run_timeout_abort"));
            } catch {}
          }
        },
      },
    );

    const dispatchDurationMs = Date.now() - dispatchStartedAt;
    runSuperseded = (getRouteInFlight(route)?.dispatchId || "") !== state.getDispatchId();
    console.log(
      `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=${state.getDispatchId()} dispatch_duration_ms=${dispatchDurationMs} run_timeout=false superseded=${runSuperseded} drop_reason=${runSuperseded ? "dispatch_id_mismatch" : ""}`,
    );
    logQQTrace({
      event: runSuperseded ? "qq_dispatch_drop" : "qq_dispatch_done",
      route,
      msg_id: msgIdText,
      dispatch_id: state.getDispatchId(),
      source: "chat",
      drop_reason: runSuperseded ? "dispatch_id_mismatch" : "",
      duration_ms: dispatchDurationMs,
      agent_id: residentAgentId,
      session_key: residentSessionKey,
      account_id: accountId,
      workspace_root: accountWorkspaceRoot,
    });

    if (!runSuperseded) {
      console.log(`[QQ][inbound] route=${route} msgId=${msgIdText} dispatch_id=${state.getDispatchId()} stage=dispatch_done`);
      await persistTaskState("succeeded", { dispatchId: state.getDispatchId(), dispatchDurationMs });
    }
  } catch (error) {
    console.error(`[QQ][dispatch] route=${route} msgId=${msgIdText} dispatch_id=${state.getDispatchId() || "none"} error=`, error);
    const dispatchDropReason = (error as any)?.name === "DispatchDropError" ? String((error as any)?.reason || "") : "";
    if (!runTimedOut) runTimedOut = String((error as any)?.message || "").includes("qq_dispatch_run timeout");
    runSuperseded = (getRouteInFlight(route)?.dispatchId || "") !== state.getDispatchId();
    const dropReason = dispatchDropReason || (runTimedOut ? "dispatch_timeout" : runSuperseded ? "dispatch_id_mismatch" : "dispatch_error");
    console.warn(
      `[QQ][dispatch-trace] route=${route} msg_id=${msgIdText} dispatch_id=${state.getDispatchId() || "none"} run_timeout=${runTimedOut} superseded=${runSuperseded} drop_reason=${dropReason}`,
    );
    logQQTrace({
      event: runTimedOut ? "qq_dispatch_timeout" : "qq_dispatch_error",
      route,
      msg_id: msgIdText,
      dispatch_id: state.getDispatchId() || "none",
      source: "chat",
      drop_reason: dropReason,
      error: String((error as any)?.message || error || ""),
      agent_id: residentAgentId,
      session_key: residentSessionKey,
      account_id: accountId,
      workspace_root: accountWorkspaceRoot,
    });

    if (runTimedOut) {
      markRouteDispatchTimeout(route);
    }
    await handleDispatchFailure({
      route,
      msgIdText,
      dispatchId: state.getDispatchId() || "none",
      runTimedOut,
      runSuperseded,
      dropReason,
      enableErrorNotify: (config as any).enableErrorNotify === true,
      hadDelivered: state.getRouteHadDelivered(),
      hadFallbackEligibleDrop: state.getRouteHadFallbackEligibleDrop(),
      canSendFallbackNow,
      recordFallbackSent,
      setRouteHadDelivered: (value) => state.setRouteHadDelivered(value),
      deliver,
      persistTaskState,
      sendFallbackAfterDispatchError,
    });
  } finally {
    const finalDispatchId = state.getDispatchId();
    if (finalDispatchId) clearRouteInFlight(route, finalDispatchId);
    const latestPending = getRoutePendingLatest(route);
    if (latestPending && latestPending.inboundSeq <= inboundSeq) {
      clearRoutePendingLatest(route);
    }
    // no explicit close: NapCat set_input_status is edge-version dependent; indicator is client-side ephemeral.
    void inputStatusOpened;
  }
}
