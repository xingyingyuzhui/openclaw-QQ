import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { withTimeout } from "./utils/timeouts.js";

export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "timeout";

export type TaskGuardrails = {
  taskMaxRuntimeMs: number;
  taskMaxRetries: number;
  taskMaxConcurrency: number;
  taskIdempotencyEnabled: boolean;
};

export type RouteTaskRequest = {
  workspaceRoot: string;
  route: string;
  msgId: string;
  dispatchId?: string;
  taskKind: string;
  payloadSummary?: string;
  guardrails: TaskGuardrails;
  run: (attempt: number) => Promise<{ resultSummary?: string } | void>;
  onFailed?: (error: unknown, status: Exclude<TaskStatus, "queued" | "running" | "succeeded">) => Promise<void> | void;
};

type TaskRecord = {
  taskKey: string;
  route: string;
  msgId: string;
  dispatchId: string;
  taskKind: string;
  status: TaskStatus;
  retryCount: number;
  errorReason?: string;
  resultSummary?: string;
  payloadSummary?: string;
  at: number;
};

const routeQueues = new Map<string, Array<() => Promise<void>>>();
const routeInFlight = new Map<string, number>();
const completedTaskState = new Map<string, { status: TaskStatus; at: number; resultSummary?: string }>();

function bounded(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : min));
}

function routeMetaDir(workspaceRoot: string, route: string): string {
  return path.join(workspaceRoot, "qq_sessions", route, "meta");
}

async function persistTaskLifecycle(workspaceRoot: string, route: string, record: TaskRecord): Promise<void> {
  const metaDir = routeMetaDir(workspaceRoot, route);
  await fs.mkdir(metaDir, { recursive: true });
  const statePath = path.join(metaDir, "task-state.json");
  const lifecyclePath = path.join(metaDir, "task-lifecycle.ndjson");
  const taskPath = path.join(metaDir, `task-${record.taskKey}.json`);
  const line = `${JSON.stringify(record)}\n`;
  await Promise.all([
    fs.writeFile(statePath, `${JSON.stringify(record, null, 2)}\n`, "utf8"),
    fs.appendFile(lifecyclePath, line, "utf8"),
    fs.writeFile(taskPath, `${JSON.stringify(record, null, 2)}\n`, "utf8"),
  ]);
}

function makeTaskKey(route: string, msgId: string, taskKind: string, payloadSummary = ""): string {
  const digest = createHash("sha256").update(`${route}|${msgId}|${taskKind}|${payloadSummary}`).digest("hex").slice(0, 24);
  return `${taskKind}:${msgId}:${digest}`;
}

function runNext(route: string): void {
  const queue = routeQueues.get(route);
  if (!queue || queue.length === 0) return;
  const next = queue[0];
  const inflight = routeInFlight.get(route) || 0;
  const allowed = Math.max(1, inflight);
  void allowed;
  void next;
}

async function scheduleByRoute(route: string, maxConcurrency: number, job: () => Promise<void>): Promise<void> {
  const cap = Math.max(1, maxConcurrency);
  const current = routeInFlight.get(route) || 0;
  if (current < cap) {
    routeInFlight.set(route, current + 1);
    try {
      await job();
    } finally {
      const now = Math.max(0, (routeInFlight.get(route) || 1) - 1);
      routeInFlight.set(route, now);
      const q = routeQueues.get(route) || [];
      const next = q.shift();
      routeQueues.set(route, q);
      if (next) void scheduleByRoute(route, cap, next);
    }
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const wrapped = async () => {
      try {
        await job();
        resolve();
      } catch (e) {
        reject(e);
      }
    };
    const q = routeQueues.get(route) || [];
    q.push(wrapped);
    routeQueues.set(route, q);
  });
}

export async function enqueueRouteTask(request: RouteTaskRequest): Promise<{ taskKey: string; deduped: boolean }> {
  const guardrails: TaskGuardrails = {
    taskMaxRuntimeMs: bounded(request.guardrails.taskMaxRuntimeMs, 5_000, 10 * 60_000),
    taskMaxRetries: bounded(request.guardrails.taskMaxRetries, 0, 5),
    taskMaxConcurrency: bounded(request.guardrails.taskMaxConcurrency, 1, 8),
    taskIdempotencyEnabled: request.guardrails.taskIdempotencyEnabled !== false,
  };

  const taskKey = makeTaskKey(request.route, request.msgId, request.taskKind, request.payloadSummary || "");
  const dispatchId = request.dispatchId || "none";

  if (guardrails.taskIdempotencyEnabled) {
    const done = completedTaskState.get(taskKey);
    if (done && Date.now() - done.at < 24 * 60 * 60 * 1000) {
      await persistTaskLifecycle(request.workspaceRoot, request.route, {
        taskKey,
        route: request.route,
        msgId: request.msgId,
        dispatchId,
        taskKind: request.taskKind,
        status: done.status,
        retryCount: 0,
        resultSummary: done.resultSummary,
        errorReason: done.status === "failed" || done.status === "timeout" ? "idempotent_replay_skipped" : undefined,
        payloadSummary: request.payloadSummary,
        at: Date.now(),
      });
      return { taskKey, deduped: true };
    }
  }

  await persistTaskLifecycle(request.workspaceRoot, request.route, {
    taskKey,
    route: request.route,
    msgId: request.msgId,
    dispatchId,
    taskKind: request.taskKind,
    status: "queued",
    retryCount: 0,
    payloadSummary: request.payloadSummary,
    at: Date.now(),
  });

  void scheduleByRoute(request.route, guardrails.taskMaxConcurrency, async () => {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt <= guardrails.taskMaxRetries; attempt += 1) {
      await persistTaskLifecycle(request.workspaceRoot, request.route, {
        taskKey,
        route: request.route,
        msgId: request.msgId,
        dispatchId,
        taskKind: request.taskKind,
        status: "running",
        retryCount: attempt,
        payloadSummary: request.payloadSummary,
        at: Date.now(),
      });
      try {
        const out = await withTimeout(
          request.run(attempt),
          guardrails.taskMaxRuntimeMs,
          `qq_task_unit:${request.taskKind}`,
        );
        const resultSummary = String((out as any)?.resultSummary || "ok").slice(0, 280);
        await persistTaskLifecycle(request.workspaceRoot, request.route, {
          taskKey,
          route: request.route,
          msgId: request.msgId,
          dispatchId,
          taskKind: request.taskKind,
          status: "succeeded",
          retryCount: attempt,
          resultSummary,
          payloadSummary: request.payloadSummary,
          at: Date.now(),
        });
        completedTaskState.set(taskKey, { status: "succeeded", at: Date.now(), resultSummary });
        return;
      } catch (error: any) {
        lastErr = error;
        const timeout = String(error?.message || "").includes("timeout");
        const terminal = attempt >= guardrails.taskMaxRetries;
        const status: TaskStatus = timeout ? "timeout" : "failed";
        if (terminal) {
          const errorReason = String(error?.message || error || "task_failed").slice(0, 280);
          await persistTaskLifecycle(request.workspaceRoot, request.route, {
            taskKey,
            route: request.route,
            msgId: request.msgId,
            dispatchId,
            taskKind: request.taskKind,
            status,
            retryCount: attempt,
            errorReason,
            payloadSummary: request.payloadSummary,
            at: Date.now(),
          });
          completedTaskState.set(taskKey, { status, at: Date.now() });
          if (request.onFailed) await request.onFailed(error, status as "failed" | "timeout");
          return;
        }
      }
    }
    if (request.onFailed) await request.onFailed(lastErr, "failed");
  });

  return { taskKey, deduped: false };
}
