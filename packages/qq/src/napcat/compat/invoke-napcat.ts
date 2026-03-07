import type { NapCatAction, NapCatRequestMap, NapCatResponseMap, NapCatVersionPolicy, NapCatRawEnvelope } from "../contracts/index.js";
import { invokeActionWithRetry, type NapCatTransport } from "../transport/action-invoker.js";
import { getFallbackActions } from "./fallback-map.js";
import { getActionSupportState, markActionSupported, markActionUnsupported } from "./capability-probe.js";
import type { NapCatInvokeContext } from "../../diagnostics/napcat-trace.js";
import { logNapCatTrace } from "../../diagnostics/napcat-trace.js";

export type NapCatInvokeOptions = {
  versionPolicy?: NapCatVersionPolicy;
  capabilityProbeEnabled?: boolean;
  actionTimeoutMs?: number;
  actionMaxRetries?: number;
  actionRetryBaseDelayMs?: number;
};

export class NapCatInvokeError extends Error {
  action: string;
  retcode?: number;
  errorCode: string;
  response?: NapCatRawEnvelope;

  constructor(action: string, errorCode: string, message: string, response?: NapCatRawEnvelope) {
    super(message);
    this.name = "NapCatInvokeError";
    this.action = action;
    this.errorCode = errorCode;
    this.response = response;
    this.retcode = typeof response?.retcode === "number" ? response.retcode : undefined;
  }
}

function isOkResponse(resp: NapCatRawEnvelope): boolean {
  return String(resp?.status || "").toLowerCase() === "ok";
}

function toErrorMessage(action: string, resp: NapCatRawEnvelope): string {
  const retcode = typeof resp?.retcode === "number" ? ` retcode=${resp.retcode}` : "";
  const msg = String(resp?.message || resp?.msg || resp?.wording || "request failed");
  return `[${action}]${retcode} ${msg}`.trim();
}

function isUnsupportedResponse(resp: NapCatRawEnvelope): boolean {
  const ret = Number(resp?.retcode || 0);
  const msg = String(resp?.message || resp?.msg || resp?.wording || "").toLowerCase();
  if (ret === 1404) return true;
  return msg.includes("unknown action") || msg.includes("not found") || msg.includes("unsupported");
}

function buildInvokeConfig(options?: NapCatInvokeOptions) {
  return {
    versionPolicy: options?.versionPolicy || "new-first-with-legacy-fallback",
    capabilityProbeEnabled: options?.capabilityProbeEnabled !== false,
    actionTimeoutMs: Math.max(200, Number(options?.actionTimeoutMs || 5000)),
    actionMaxRetries: Math.max(0, Number(options?.actionMaxRetries || 1)),
    actionRetryBaseDelayMs: Math.max(50, Number(options?.actionRetryBaseDelayMs || 300)),
  };
}

async function invokeRaw(
  transport: NapCatTransport,
  action: string,
  params: Record<string, unknown>,
  config: ReturnType<typeof buildInvokeConfig>,
): Promise<NapCatRawEnvelope> {
  return invokeActionWithRetry(transport, action, params, {
    timeoutMs: config.actionTimeoutMs,
    maxRetries: config.actionMaxRetries,
    retryBaseDelayMs: config.actionRetryBaseDelayMs,
  });
}

export async function invokeNapCat<A extends NapCatAction>(args: {
  transport: NapCatTransport;
  action: A;
  params: NapCatRequestMap[A];
  ctx: NapCatInvokeContext;
  options?: NapCatInvokeOptions;
}): Promise<NapCatResponseMap[A]> {
  const { transport, action, params, ctx } = args;
  const startedAt = Date.now();
  const cfg = buildInvokeConfig(args.options);
  const requestParams = (params || {}) as Record<string, unknown>;

  logNapCatTrace({
    event: "napcat_action_start",
    action,
    ctx,
    result: "ok",
  });

  const supportState = getActionSupportState(ctx.accountId, action);
  if (cfg.capabilityProbeEnabled && supportState === "unsupported" && cfg.versionPolicy === "strict-new") {
    logNapCatTrace({
      event: "napcat_action_unsupported",
      action,
      ctx,
      result: "unsupported",
      durationMs: Date.now() - startedAt,
      errorCode: "cached_unsupported",
      errorMessage: "action marked unsupported in capability cache",
    });
    throw new NapCatInvokeError(String(action), "cached_unsupported", `Action ${String(action)} unsupported by capability cache`);
  }

  const primary = await invokeRaw(transport, String(action), requestParams, cfg);
  if (isOkResponse(primary)) {
    markActionSupported(ctx.accountId, action);
    logNapCatTrace({
      event: "napcat_action_success",
      action,
      ctx,
      result: "ok",
      durationMs: Date.now() - startedAt,
    });
    return (primary.data ?? {}) as NapCatResponseMap[A];
  }

  const unsupported = isUnsupportedResponse(primary);
  if (unsupported) markActionUnsupported(ctx.accountId, action);

  if (cfg.versionPolicy !== "strict-new") {
    const fallbacks = getFallbackActions(action);
    for (const fb of fallbacks) {
      const fbStart = Date.now();
      logNapCatTrace({
        event: "napcat_action_fallback",
        action: String(action),
        ctx,
        result: "fallback",
        fallbackFrom: String(action),
        fallbackTo: fb,
        fallbackReason: unsupported ? "unsupported_primary_action" : "primary_action_failed",
      });
      const fallbackResp = await invokeRaw(transport, fb, requestParams, cfg);
      if (isOkResponse(fallbackResp)) {
        markActionSupported(ctx.accountId, fb);
        logNapCatTrace({
          event: "napcat_action_success",
          action: fb,
          ctx,
          result: "ok",
          durationMs: Date.now() - fbStart,
          fallbackFrom: String(action),
          fallbackTo: fb,
          fallbackReason: unsupported ? "unsupported_primary_action" : "primary_action_failed",
        });
        return (fallbackResp.data ?? {}) as NapCatResponseMap[A];
      }
    }
  }

  const errMsg = toErrorMessage(String(action), primary);
  logNapCatTrace({
    event: unsupported ? "napcat_action_unsupported" : "napcat_action_failed",
    action: String(action),
    ctx,
    result: unsupported ? "unsupported" : "failed",
    durationMs: Date.now() - startedAt,
    retcode: typeof primary.retcode === "number" ? primary.retcode : undefined,
    errorCode: unsupported ? "unsupported_action" : "action_failed",
    errorMessage: errMsg,
  });

  throw new NapCatInvokeError(String(action), unsupported ? "unsupported_action" : "action_failed", errMsg, primary);
}
