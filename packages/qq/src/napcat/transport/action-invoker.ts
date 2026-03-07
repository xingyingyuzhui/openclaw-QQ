import type { NapCatAction } from "../contracts/index.js";
import type { NapCatRawEnvelope } from "../contracts/index.js";

export type NapCatTransport = {
  callActionEnvelope: (action: string, params: Record<string, unknown>, timeoutMs: number) => Promise<NapCatRawEnvelope>;
};

export type ActionInvokerOptions = {
  timeoutMs: number;
  maxRetries: number;
  retryBaseDelayMs: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetriableError(err: unknown): boolean {
  const msg = String((err as any)?.message || err || "").toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("websocket not open") ||
    msg.includes("request timeout") ||
    msg.includes("timed out") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up")
  );
}

export async function invokeActionWithRetry(
  transport: NapCatTransport,
  action: NapCatAction | string,
  params: Record<string, unknown>,
  opts: ActionInvokerOptions,
): Promise<NapCatRawEnvelope> {
  const retries = Math.max(0, Number(opts.maxRetries || 0));
  const timeoutMs = Math.max(100, Number(opts.timeoutMs || 5000));
  const baseDelay = Math.max(50, Number(opts.retryBaseDelayMs || 300));

  let lastErr: unknown = null;
  for (let i = 0; i <= retries; i += 1) {
    try {
      return await transport.callActionEnvelope(String(action), params, timeoutMs);
    } catch (err) {
      lastErr = err;
      const retriable = isRetriableError(err);
      if (!retriable || i >= retries) break;
      const jitter = Math.floor(Math.random() * 120);
      await sleep(baseDelay * (i + 1) + jitter);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr || "invoke_action_failed"));
}
