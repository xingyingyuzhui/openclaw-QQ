import { cleanCQCodes } from "./message-normalizer.js";

export function resolveInterruptCoalesceMs(config: any, aggregateWindowMs: number): number {
  const configuredInterruptWindowMs = Number((config as any).interruptWindowMs ?? 0);
  const legacyInterruptCoalesceMs = Number((config as any).interruptCoalesceMs ?? 0);
  return Math.max(
    100,
    configuredInterruptWindowMs > 0
      ? configuredInterruptWindowMs
      : legacyInterruptCoalesceMs > 0
        ? legacyInterruptCoalesceMs
        : aggregateWindowMs,
  );
}

export function shouldSendBusyFollowupHint(text: string): boolean {
  const followup = cleanCQCodes(text || "").trim();
  if (!followup) return false;
  return /可以吗|处理了吗|好了没|进度|怎么样|看下|现在可以|ok\??/i.test(followup);
}

export function classifyPostCoalesceDisposition(params: {
  hasExistingInFlight: boolean;
  routePreemptOldRun: boolean;
  interruptCoalesceEnabled: boolean;
  currentInboundSeq: number;
  expectedInboundSeq: number;
}): "continue" | "queued_superseded_by_newer_inbound" | "coalesce_superseded_after_preempt" | "merged_into_newer_inbound" {
  const {
    hasExistingInFlight,
    routePreemptOldRun,
    interruptCoalesceEnabled,
    currentInboundSeq,
    expectedInboundSeq,
  } = params;
  if (currentInboundSeq === expectedInboundSeq) return "continue";
  if (!interruptCoalesceEnabled) return "continue";
  if (hasExistingInFlight && routePreemptOldRun) return "coalesce_superseded_after_preempt";
  if (!hasExistingInFlight) return "merged_into_newer_inbound";
  return "queued_superseded_by_newer_inbound";
}
