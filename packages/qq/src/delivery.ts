import type { QQConfig } from "./config.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function isRetriableSendError(err: any): boolean {
  const msg = String(err?.message || err || "").toLowerCase();
  if (!msg) return false;
  return (
    msg.includes("websocket not open") ||
    msg.includes("request timeout") ||
    msg.includes("econnreset") ||
    msg.includes("socket hang up") ||
    msg.includes("broken pipe") ||
    msg.includes("temporarily unavailable") ||
    msg.includes("timed out")
  );
}

function calcRetryDelayMs(config: QQConfig, attempt: number): number {
  const minDelay = Math.max(50, Number(config.sendRetryMinDelayMs ?? 500));
  const maxDelay = Math.max(minDelay, Number(config.sendRetryMaxDelayMs ?? 8000));
  const jitterRatio = Math.max(0, Math.min(1, Number(config.sendRetryJitterRatio ?? 0.15)));
  const base = Math.min(maxDelay, minDelay * Math.pow(2, Math.max(0, attempt - 1)));
  const jitter = base * jitterRatio * (Math.random() * 2 - 1);
  return Math.max(0, Math.floor(base + jitter));
}

export type SendTask = () => Promise<void>;

type QueueTask = {
  run: SendTask;
  requeueLeft: number;
  label?: string;
};

export type SendMeta = {
  accountId: string;
  route: string;
  targetKind: string;
  action: string;
  summary?: string;
  mediaDedupKey?: string;
  msgId?: string;
  dispatchId?: string;
  attemptId?: string;
  source?: "chat" | "automation";
  preflight?: () => void | Promise<void>;
};

const MEDIA_DEDUP_WINDOW_MS = 45_000;

export function createDeliveryManager(deps: {
  ensureReady: (accountId: string, config: QQConfig) => Promise<void>;
  onAttemptLog: (meta: SendMeta & { retryIndex: number }) => void;
}) {
  const sendQueue: QueueTask[] = [];
  let sendQueueRunning = false;
  const recentMediaSendAttempts = new Map<string, number>();

  function markMediaSendAttempt(key: string, now = Date.now()) {
    recentMediaSendAttempts.set(key, now);
    if (recentMediaSendAttempts.size > 500) {
      for (const [k, ts] of recentMediaSendAttempts) {
        if (now - ts > MEDIA_DEDUP_WINDOW_MS * 3) recentMediaSendAttempts.delete(k);
      }
    }
  }

  function shouldSuppressMediaRetry(key: string, now = Date.now()): boolean {
    const ts = recentMediaSendAttempts.get(key);
    return typeof ts === "number" && now - ts <= MEDIA_DEDUP_WINDOW_MS;
  }

  async function runSendQueue(config: QQConfig) {
    if (sendQueueRunning) return;
    sendQueueRunning = true;
    while (sendQueue.length > 0) {
      const task = sendQueue.shift();
      if (!task) break;
      try {
        await task.run();
      } catch (err: any) {
        const retriable = Boolean(err?.__qqRetriable || isRetriableSendError(err));
        if (retriable && task.requeueLeft > 0) {
          const next = { ...task, requeueLeft: task.requeueLeft - 1 };
          const backoffMs = Math.max(500, Number(config.sendWaitForReconnectMs ?? 5000));
          console.warn(`[QQ][queue] deferred task label=${task.label || "unknown"} requeueLeft=${next.requeueLeft} waitMs=${backoffMs} err=${err?.message || err}`);
          await sleep(backoffMs);
          sendQueue.push(next);
        } else {
          console.warn(`[QQ][queue] send_task_failed label=${task.label || "unknown"} err=${err?.message || err}`);
        }
      }
      const base = Math.max(0, config.sendQueueBaseDelayMs ?? config.rateLimitMs ?? 1000);
      const jitterMax = Math.max(0, config.sendQueueJitterMs ?? 400);
      const jitter = Math.floor(Math.random() * (jitterMax + 1));
      if (base + jitter > 0) await sleep(base + jitter);
    }
    sendQueueRunning = false;
  }

  async function enqueueSend(config: QQConfig, task: SendTask, opts?: { label?: string; requeueLeft?: number }) {
    sendQueue.push({ run: task, requeueLeft: Math.max(0, Number(opts?.requeueLeft ?? 2)), label: opts?.label });
    await runSendQueue(config);
  }

  async function sendWithRetry(config: QQConfig, meta: SendMeta, fn: () => Promise<any>) {
    const max = Math.max(1, config.sendQueueMaxRetries ?? 3);
    let lastErr: any;
    for (let i = 1; i <= max; i++) {
      try {
        if (meta.action === "send_media" && meta.mediaDedupKey) {
          if (i > 1 && shouldSuppressMediaRetry(meta.mediaDedupKey)) {
            console.warn(`[QQ][send] suppress duplicate media retry route=${meta.route} target=${meta.targetKind} retry=${i} key=${meta.mediaDedupKey}`);
            return { dedupSuppressed: true };
          }
          if (i === 1) markMediaSendAttempt(meta.mediaDedupKey);
        }
        await meta.preflight?.();
        await deps.ensureReady(meta.accountId, config);
        deps.onAttemptLog({ ...meta, retryIndex: i });
        return await fn();
      } catch (err: any) {
        lastErr = err;
        console.warn(
          `[QQ][send] failed action=${meta.action} route=${meta.route} msg_id=${meta.msgId || ""} dispatch_id=${meta.dispatchId || ""} attempt_id=${meta.attemptId || ""} target=${meta.targetKind} retry=${i} source=${meta.source || "chat"} err=${err?.message || err}`,
        );
        if (i < max && isRetriableSendError(err)) {
          await sleep(calcRetryDelayMs(config, i));
          continue;
        }
        if (i < max) break;
      }
    }
    if (isRetriableSendError(lastErr)) {
      (lastErr as any).__qqRetriable = true;
    }
    throw lastErr;
  }

  return { enqueueSend, sendWithRetry };
}
