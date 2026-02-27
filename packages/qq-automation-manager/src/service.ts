import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { OpenClawConfig, OpenClawPluginApi, OpenClawPluginService } from "openclaw/plugin-sdk";
import { z } from "zod";

const OWNER_QQ = String(process.env.OPENCLAW_QQ_OWNER_ID || "").trim();
const OWNER_ROUTE = OWNER_QQ ? `user:` : "";
const OWNER_AGENT = "main";

type CronSchedule =
  | { kind: "cron"; expr: string; tz?: string }
  | { kind: "every"; everyMs: number }
  | { kind: "at"; at: string };

type TargetSmartConfig = {
  enabled?: boolean;
  minSilenceMinutes?: number;
  activeConversationMinutes?: number;
  randomIntervalMinMinutes?: number;
  randomIntervalMaxMinutes?: number;
  maxChars?: number;
};

const ScheduleSchema = z.union([
  z.object({ kind: z.literal("cron"), expr: z.string().min(1), tz: z.string().optional() }),
  z.object({ kind: z.literal("every"), everyMs: z.number().int().min(60_000) }),
  z.object({ kind: z.literal("at"), at: z.string().min(1) }),
]);

const TargetSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean().optional().default(true),
  route: z.string().min(1),
  executionMode: z.enum(["agent-only", "legacy-deliver"]).optional().default("agent-only"),
  job: z.object({
    type: z.literal("cron-agent-turn").optional().default("cron-agent-turn"),
    schedule: ScheduleSchema,
    message: z.string().min(1),
    thinking: z.string().optional(),
    model: z.string().optional(),
    timeoutSeconds: z.number().int().positive().optional(),
    smart: z
      .object({
        enabled: z.boolean().optional(),
        minSilenceMinutes: z.number().int().min(1).optional(),
        activeConversationMinutes: z.number().int().min(1).optional(),
        randomIntervalMinMinutes: z.number().int().min(1).optional(),
        randomIntervalMaxMinutes: z.number().int().min(1).optional(),
        maxChars: z.number().int().min(8).max(200).optional(),
      })
      .optional(),
  }),
  delivery: z.object({ channel: z.literal("qq"), to: z.string().min(1), accountId: z.string().optional() }).optional(),
});

const ManagerSchema = z.object({
  enabled: z.boolean().optional().default(false),
  configVersion: z.number().int().optional().default(1),
  reconcileOnStartup: z.boolean().optional().default(true),
  reconcileIntervalMs: z.number().int().min(15_000).optional().default(120_000),
  pruneOrphans: z.boolean().optional().default(false),
  strictAgentOnly: z.boolean().optional().default(true),
  targets: z.array(TargetSchema).optional().default([]),
});

type TargetConfig = z.infer<typeof TargetSchema>;
type ManagerConfig = z.infer<typeof ManagerSchema>;

type TargetState = {
  hash: string;
  route: string;
  agentId: string;
  lastTriggeredAtMs: number;
  lastSentAtMs: number;
  nextEligibleAtMs: number;
  lastInboundAtMs: number;
  lastOutboundAtMs: number;
  lastRunResult: "sent" | "skipped" | "failed" | "idle";
  lastSkipReason?: string;
  lastError?: string;
  atDone?: boolean;
  lastCronBucket?: string;
  updatedAt: string;
};

type ReconcileState = {
  version: 2;
  targets: Record<string, TargetState>;
  updatedAt: string;
};

type AutomationRecord = {
  ts: string;
  target_id: string;
  route: string;
  triggered: boolean;
  produced: boolean;
  skipped: boolean;
  sent_by_channel: boolean | null;
  run_ms: number;
  note?: string;
  trace: {
    service: "qq-automation-manager";
    source: "automation";
    execution_mode: "agent-only";
    scheduler: "internal";
    schedule_kind: "cron" | "every" | "at";
    agent_id: string;
  };
};

type RouteRecentTimes = {
  lastInboundAtMs: number;
  lastOutboundAtMs: number;
};

function resolveWorkspaceRoot(cfg: OpenClawConfig, fallback?: string): string {
  const fromCfg = cfg?.agents?.defaults?.workspace;
  if (typeof fromCfg === "string" && fromCfg.trim()) return fromCfg.trim();
  if (typeof fallback === "string" && fallback.trim()) return fallback.trim();
  return path.join(process.env.HOME || "", ".openclaw", "workspace");
}

function normalizeManagerConfig(cfg: OpenClawConfig, logger: OpenClawPluginApi["logger"]): ManagerConfig {
  const raw = (cfg?.plugins?.entries as Record<string, unknown> | undefined)?.["qq-automation-manager"] as
    | { config?: unknown }
    | undefined;
  const parsed = ManagerSchema.safeParse(raw?.config ?? {});
  if (!parsed.success) {
    logger.warn(
      `qq-automation-manager: invalid config, disabled (${parsed.error.issues
        .map((i) => `${i.path.join(".")}:${i.message}`)
        .join(",")})`,
    );
    return ManagerSchema.parse({ enabled: false, targets: [] });
  }
  return parsed.data;
}

function isValidRoute(route: string): boolean {
  if (/^user:\d{5,}$/.test(route)) return true;
  if (/^group:\d{5,}$/.test(route)) return true;
  if (/^guild:[^:/\\.]+:[^:/\\.]+$/.test(route)) return true;
  return false;
}

function routeToSessionKey(route: string): string {
  return route.replaceAll(":", "__");
}

function routeMetaDir(workspaceRoot: string, route: string): string {
  const direct = path.join(workspaceRoot, "qq_sessions", route);
  const canonical = path.join(workspaceRoot, "qq_sessions", routeToSessionKey(route));
  const routeDir = existsSync(direct) ? direct : canonical;
  return path.join(routeDir, "meta");
}

function routeLogsDir(workspaceRoot: string, route: string): string {
  const direct = path.join(workspaceRoot, "qq_sessions", route);
  const canonical = path.join(workspaceRoot, "qq_sessions", routeToSessionKey(route));
  return path.join(existsSync(direct) ? direct : canonical, "logs");
}

function statePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, "qq_sessions", ".qq-automation", "reconcile-state.json");
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function stableHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function fallbackAgentIdByRoute(route: string): string {
  if (route === OWNER_ROUTE) return OWNER_AGENT;
  const user = route.match(/^user:(\d{5,})$/)?.[1];
  if (user) return `qq-user-${user}`;
  const group = route.match(/^group:(\d{5,})$/)?.[1];
  if (group) return `qq-group-${group}`;
  const guild = route.match(/^guild:([^:]+):([^:]+)$/);
  if (guild) return `qq-guild-${guild[1]}-${guild[2]}`;
  return "main";
}

async function resolveAgentId(workspaceRoot: string, route: string): Promise<string> {
  const candidates = [
    path.join(workspaceRoot, "qq_sessions", route, "agent.json"),
    path.join(workspaceRoot, "qq_sessions", routeToSessionKey(route), "agent.json"),
  ];
  for (const file of candidates) {
    const data = await readJson<{ agentId?: string }>(file);
    const id = String(data?.agentId || "").trim();
    if (id) return id;
  }
  return fallbackAgentIdByRoute(route);
}

async function appendRouteState(workspaceRoot: string, route: string, record: AutomationRecord): Promise<void> {
  const metaDir = routeMetaDir(workspaceRoot, route);
  await fs.mkdir(metaDir, { recursive: true });
  await fs.writeFile(path.join(metaDir, "automation-latest.json"), JSON.stringify(record, null, 2), "utf8");
  await fs.appendFile(path.join(metaDir, "automation-state.ndjson"), `${JSON.stringify(record)}\n`, "utf8");
}

async function runOpenclawJsonCommand(api: OpenClawPluginApi, args: string[], timeoutMs = 30_000): Promise<unknown> {
  const res = await api.runtime.system.runCommandWithTimeout(["openclaw", ...args], { timeoutMs });
  const stdout = String(res.stdout || "").trim();
  const stderr = String(res.stderr || "").trim();
  if (res.code !== 0) throw new Error(`openclaw ${args.join(" ")} failed code=${res.code}: ${stderr || stdout}`);
  if (!stdout) return {};
  try {
    return JSON.parse(stdout);
  } catch {
    return { text: stdout };
  }
}

type ListedAgent = { id?: string };

async function listConfiguredAgentIds(api: OpenClawPluginApi): Promise<Set<string>> {
  const raw = await runOpenclawJsonCommand(api, ["agents", "list", "--json"], 20_000);
  const rows = Array.isArray(raw) ? (raw as ListedAgent[]) : [];
  const ids = new Set<string>();
  for (const row of rows) {
    const id = String(row?.id || "")
      .trim()
      .toLowerCase();
    if (id) ids.add(id);
  }
  return ids;
}

function resolveStateRootFromWorkspace(workspaceRoot: string): string {
  return path.resolve(path.dirname(workspaceRoot));
}

function resolveWorkspaceForAgent(workspaceRoot: string, agentId: string): string {
  if (agentId === OWNER_AGENT) return workspaceRoot;
  const stateRoot = resolveStateRootFromWorkspace(workspaceRoot);
  return path.join(stateRoot, `workspace-${agentId}`);
}

function resolveAgentDirForAgent(workspaceRoot: string, agentId: string): string {
  const stateRoot = resolveStateRootFromWorkspace(workspaceRoot);
  return path.join(stateRoot, "agents", agentId, "agent");
}

async function ensureAgentRegistered(
  api: OpenClawPluginApi,
  workspaceRoot: string,
  agentIdRaw: string,
): Promise<void> {
  const agentId = String(agentIdRaw || "")
    .trim()
    .toLowerCase();
  if (!agentId || agentId === OWNER_AGENT) return;

  const configured = await listConfiguredAgentIds(api);
  if (configured.has(agentId)) return;

  const workspace = resolveWorkspaceForAgent(workspaceRoot, agentId);
  const agentDir = resolveAgentDirForAgent(workspaceRoot, agentId);
  try {
    await runOpenclawJsonCommand(
      api,
      [
        "agents",
        "add",
        agentId,
        "--workspace",
        workspace,
        "--agent-dir",
        agentDir,
        "--non-interactive",
        "--json",
      ],
      45_000,
    );
    api.logger.info(
      `qq-automation-manager: auto-registered agent id=${agentId} workspace=${workspace} agentDir=${agentDir}`,
    );
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (!/already exists/i.test(msg)) {
      throw err;
    }
  }
}

function parseIntSetExpr(expr: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  const parts = String(expr || "*")
    .split(",")
    .map((it) => it.trim())
    .filter(Boolean);
  for (const p of parts) {
    if (p === "*") {
      for (let i = min; i <= max; i += 1) out.add(i);
      continue;
    }
    const step = p.match(/^\*\/(\d+)$/);
    if (step) {
      const n = Math.max(1, Number(step[1]));
      for (let i = min; i <= max; i += n) out.add(i);
      continue;
    }
    const range = p.match(/^(\d+)-(\d+)$/);
    if (range) {
      const from = Math.max(min, Number(range[1]));
      const to = Math.min(max, Number(range[2]));
      for (let i = from; i <= to; i += 1) out.add(i);
      continue;
    }
    const n = Number(p);
    if (Number.isFinite(n) && n >= min && n <= max) out.add(n);
  }
  return out;
}

function localDateInTz(nowMs: number, tz?: string): Date {
  if (!tz || !tz.trim()) return new Date(nowMs);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(nowMs));
  const byType = new Map(parts.map((it) => [it.type, it.value]));
  const year = Number(byType.get("year") || 0);
  const month = Number(byType.get("month") || 1);
  const day = Number(byType.get("day") || 1);
  const hour = Number(byType.get("hour") || 0);
  const minute = Number(byType.get("minute") || 0);
  return new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
}

function cronBucket(nowMs: number, tz?: string): string {
  const d = localDateInTz(nowMs, tz);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}${mm}${dd}${hh}${mi}`;
}

function matchesCron(expr: string, nowMs: number, tz?: string): boolean {
  const fields = String(expr || "").trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const d = localDateInTz(nowMs, tz);
  const minute = d.getUTCMinutes();
  const hour = d.getUTCHours();
  const dow = d.getUTCDay();
  const minuteSet = parseIntSetExpr(fields[0], 0, 59);
  const hourSet = parseIntSetExpr(fields[1], 0, 23);
  const dowSet = parseIntSetExpr(fields[4], 0, 6);
  return minuteSet.has(minute) && hourSet.has(hour) && dowSet.has(dow);
}

function randomMinutes(minMinutes: number, maxMinutes: number): number {
  const min = Math.max(1, Math.floor(minMinutes));
  const max = Math.max(min, Math.floor(maxMinutes));
  const delta = max - min + 1;
  return min + Math.floor(Math.random() * delta);
}

async function readRecentRouteTimes(workspaceRoot: string, route: string): Promise<RouteRecentTimes> {
  let lastInboundAtMs = 0;
  let lastOutboundAtMs = 0;

  const directLogs = path.join(workspaceRoot, "qq_sessions", route, "logs");
  const canonicalLogs = path.join(workspaceRoot, "qq_sessions", routeToSessionKey(route), "logs");
  const candidates = Array.from(new Set([directLogs, canonicalLogs, routeLogsDir(workspaceRoot, route)]));

  for (const logsDir of candidates) {
    let files: string[] = [];
    try {
      files = (await fs.readdir(logsDir))
        .filter((f) => /^chat-\d{4}-\d{2}-\d{2}\.ndjson$/.test(f))
        .sort();
    } catch {
      continue;
    }
    if (files.length === 0) continue;
    const latest = files.slice(-2);
    for (const file of latest) {
      const raw = await fs.readFile(path.join(logsDir, file), "utf8").catch(() => "");
      if (!raw) continue;
      const lines = raw.trim().split("\n").slice(-400);
      for (const line of lines) {
        try {
          const rec = JSON.parse(line) as { ts?: number; direction?: string };
          const ts = Number(rec?.ts || 0);
          if (!ts) continue;
          if (rec.direction === "in") lastInboundAtMs = Math.max(lastInboundAtMs, ts);
          if (rec.direction === "out") lastOutboundAtMs = Math.max(lastOutboundAtMs, ts);
        } catch {
          continue;
        }
      }
    }
  }
  return { lastInboundAtMs, lastOutboundAtMs };
}

function shouldRunNow(schedule: CronSchedule, state: TargetState, nowMs: number): { due: boolean; nextStatePatch?: Partial<TargetState> } {
  if (schedule.kind === "every") {
    const last = Number(state.lastTriggeredAtMs || 0);
    if (!last) return { due: true };
    return { due: nowMs - last >= schedule.everyMs };
  }
  if (schedule.kind === "at") {
    if (state.atDone) return { due: false };
    const atMs = Date.parse(schedule.at);
    if (!Number.isFinite(atMs)) return { due: false };
    if (nowMs >= atMs) return { due: true, nextStatePatch: { atDone: true } };
    return { due: false };
  }
  const bucket = cronBucket(nowMs, schedule.tz);
  if (state.lastCronBucket === bucket) return { due: false };
  if (!matchesCron(schedule.expr, nowMs, schedule.tz)) return { due: false };
  return { due: true, nextStatePatch: { lastCronBucket: bucket } };
}

function buildAgentPrompt(target: TargetConfig): string {
  const smart = target.job.smart || {};
  const maxChars = Math.max(8, Math.min(200, Number(smart.maxChars || 48)));
  const base = String(target.job.message || "").trim();
  return [
    "你正在执行QQ渠道的自动触达任务。",
    "请只输出给用户的一条自然消息，不要输出任何系统标记。",
    "禁止输出 ANNOUNCE_SKIP / QQ_AUTO_SKIP / NO_REPLY 或类似控制词。",
    `建议长度不超过 ${maxChars} 个中文字符；最多两句。`,
    `任务目标：${base}`,
  ].join("\n");
}

async function triggerAgentTurn(
  api: OpenClawPluginApi,
  target: TargetConfig,
  agentId: string,
): Promise<{ ok: boolean; error?: string; summary?: string }> {
  const message = buildAgentPrompt(target);
  const args = [
    "agent",
    "--agent",
    agentId,
    "--message",
    message,
    "--deliver",
    "--channel",
    "qq",
    "--reply-channel",
    "qq",
    "--reply-to",
    target.route,
    "--json",
  ];
  if (target.job.thinking?.trim()) args.push("--thinking", target.job.thinking.trim());
  if (target.job.timeoutSeconds && Number.isFinite(target.job.timeoutSeconds)) {
    args.push("--timeout", String(Math.max(1, Math.floor(target.job.timeoutSeconds))));
  }
  const started = Date.now();
  try {
    const out = (await runOpenclawJsonCommand(api, args, 120_000)) as Record<string, unknown>;
    const summary = String((out && (out.summary || out.text || out.message)) || "").trim();
    void started;
    return { ok: true, summary };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err) };
  }
}

async function reconcileOnce(api: OpenClawPluginApi, workspaceRoot: string): Promise<void> {
  const cfg = api.runtime.config.loadConfig();
  const manager = normalizeManagerConfig(cfg, api.logger);
  if (!manager.enabled) return;

  const file = statePath(workspaceRoot);
  const prev = (await readJson<ReconcileState>(file)) || { version: 2, targets: {}, updatedAt: new Date().toISOString() };
  const next: ReconcileState = { version: 2, targets: {}, updatedAt: new Date().toISOString() };
  const nowMs = Date.now();

  for (const target of manager.targets) {
    if (!isValidRoute(target.route)) {
      api.logger.warn(`qq-automation-manager: invalid route target=${target.id} route=${target.route}`);
      continue;
    }
    if (manager.strictAgentOnly !== false && target.executionMode !== "agent-only") {
      api.logger.warn(`qq-automation-manager: target=${target.id} blocked by strictAgentOnly (executionMode=${target.executionMode})`);
      continue;
    }

    const agentId = await resolveAgentId(workspaceRoot, target.route);
    let ensureRegisterError = "";
    try {
      await ensureAgentRegistered(api, workspaceRoot, agentId);
    } catch (err) {
      ensureRegisterError = String(err);
      api.logger.warn(
        `qq-automation-manager: ensure agent registered failed target=${target.id} route=${target.route} agent=${agentId} error=${ensureRegisterError}`,
      );
    }
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
    const schedule = target.job.schedule as CronSchedule;

    const base: TargetState = {
      hash: desiredHash,
      route: target.route,
      agentId,
      lastTriggeredAtMs: Number(prev.targets[target.id]?.lastTriggeredAtMs || 0),
      lastSentAtMs: Number(prev.targets[target.id]?.lastSentAtMs || 0),
      nextEligibleAtMs: Number(prev.targets[target.id]?.nextEligibleAtMs || 0),
      lastInboundAtMs: Number(prev.targets[target.id]?.lastInboundAtMs || 0),
      lastOutboundAtMs: Number(prev.targets[target.id]?.lastOutboundAtMs || 0),
      lastRunResult: prev.targets[target.id]?.lastRunResult || "idle",
      lastSkipReason: prev.targets[target.id]?.lastSkipReason,
      lastError: prev.targets[target.id]?.lastError,
      atDone: Boolean(prev.targets[target.id]?.atDone),
      lastCronBucket: prev.targets[target.id]?.lastCronBucket,
      updatedAt: new Date().toISOString(),
    };

    if (ensureRegisterError) {
      base.lastRunResult = "failed";
      base.lastError = `ensure_agent_registered_failed: ${ensureRegisterError}`;
      base.updatedAt = new Date().toISOString();
      next.targets[target.id] = base;
      const rec: AutomationRecord = {
        ts: new Date().toISOString(),
        target_id: target.id,
        route: target.route,
        triggered: false,
        produced: false,
        skipped: false,
        sent_by_channel: null,
        run_ms: 0,
        note: "error:ensure_agent_registered_failed",
        trace: {
          service: "qq-automation-manager",
          source: "automation",
          execution_mode: "agent-only",
          scheduler: "internal",
          schedule_kind: schedule.kind,
          agent_id: agentId,
        },
      };
      await appendRouteState(workspaceRoot, target.route, rec).catch((stateErr) => {
        api.logger.warn(`qq-automation-manager: append route state failed target=${target.id}: ${String(stateErr)}`);
      });
      continue;
    }

    const times = await readRecentRouteTimes(workspaceRoot, target.route);
    base.lastInboundAtMs = times.lastInboundAtMs;
    base.lastOutboundAtMs = times.lastOutboundAtMs;

    if (!target.enabled) {
      base.lastRunResult = "idle";
      base.updatedAt = new Date().toISOString();
      next.targets[target.id] = base;
      continue;
    }

    const due = shouldRunNow(schedule, base, nowMs);
    if (due.nextStatePatch) Object.assign(base, due.nextStatePatch);
    if (!due.due) {
      base.updatedAt = new Date().toISOString();
      next.targets[target.id] = base;
      continue;
    }

    const smart = (target.job.smart || {}) as TargetSmartConfig;
    const smartEnabled = smart.enabled !== false;
    let skipReason = "";
    if (smartEnabled) {
      const minSilenceMinutes = Math.max(1, Number(smart.minSilenceMinutes || 30));
      const activeConversationMinutes = Math.max(1, Number(smart.activeConversationMinutes || 25));
      const randomMin = Math.max(1, Number(smart.randomIntervalMinMinutes || 30));
      const randomMax = Math.max(randomMin, Number(smart.randomIntervalMaxMinutes || 60));
      const minSilenceMs = minSilenceMinutes * 60_000;
      const activeMs = activeConversationMinutes * 60_000;

      if (!times.lastInboundAtMs) {
        skipReason = "no_inbound_yet";
      } else if (nowMs - times.lastInboundAtMs < minSilenceMs) {
        skipReason = "silence_not_reached";
      } else if (
        times.lastInboundAtMs > 0 &&
        times.lastOutboundAtMs > 0 &&
        Math.max(times.lastInboundAtMs, times.lastOutboundAtMs) >= nowMs - activeMs
      ) {
        skipReason = "active_conversation";
      } else {
        if (!base.nextEligibleAtMs && base.lastSentAtMs > 0) {
          base.nextEligibleAtMs = base.lastSentAtMs + randomMinutes(randomMin, randomMax) * 60_000;
        }
        if (base.nextEligibleAtMs > nowMs) {
          skipReason = "interval_not_reached";
        }
      }
    }

    if (skipReason) {
      base.lastTriggeredAtMs = nowMs;
      base.lastRunResult = "skipped";
      base.lastSkipReason = skipReason;
      base.lastError = "";
      base.updatedAt = new Date().toISOString();
      next.targets[target.id] = base;
      api.logger.info(
        `qq-automation-manager: skip target=${target.id} route=${target.route} reason=${skipReason} last_inbound_ms_ago=${times.lastInboundAtMs ? nowMs - times.lastInboundAtMs : -1}`,
      );
      const rec: AutomationRecord = {
        ts: new Date().toISOString(),
        target_id: target.id,
        route: target.route,
        triggered: true,
        produced: false,
        skipped: true,
        sent_by_channel: null,
        run_ms: 0,
        note: `skip:${skipReason}`,
        trace: {
          service: "qq-automation-manager",
          source: "automation",
          execution_mode: "agent-only",
          scheduler: "internal",
          schedule_kind: schedule.kind,
          agent_id: agentId,
        },
      };
      await appendRouteState(workspaceRoot, target.route, rec).catch((err) => {
        api.logger.warn(`qq-automation-manager: append route state failed target=${target.id}: ${String(err)}`);
      });
      continue;
    }

    const started = Date.now();
    const sendResult = await triggerAgentTurn(api, target, agentId);
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
    } else {
      base.lastRunResult = "failed";
      base.lastError = String(sendResult.error || "trigger_failed");
      api.logger.warn(
        `qq-automation-manager: trigger failed target=${target.id} route=${target.route} durationMs=${duration} error=${base.lastError}`,
      );
    }
    base.updatedAt = new Date().toISOString();
    next.targets[target.id] = base;

    const rec: AutomationRecord = {
      ts: new Date().toISOString(),
      target_id: target.id,
      route: target.route,
      triggered: true,
      produced: Boolean(sendResult.ok),
      skipped: false,
      sent_by_channel: sendResult.ok ? true : null,
      run_ms: duration,
      note: sendResult.ok ? "sent" : `error:${sendResult.error || "trigger_failed"}`,
      trace: {
        service: "qq-automation-manager",
        source: "automation",
        execution_mode: "agent-only",
        scheduler: "internal",
        schedule_kind: schedule.kind,
        agent_id: agentId,
      },
    };
    await appendRouteState(workspaceRoot, target.route, rec).catch((err) => {
      api.logger.warn(`qq-automation-manager: append route state failed target=${target.id}: ${String(err)}`);
    });
  }

  next.updatedAt = new Date().toISOString();
  await writeJson(file, next);
}

export function createQqAutomationManagerService(api: OpenClawPluginApi): OpenClawPluginService {
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const tick = async (workspaceDir?: string) => {
    if (running) return;
    running = true;
    try {
      const cfg = api.runtime.config.loadConfig();
      const workspaceRoot = resolveWorkspaceRoot(cfg, workspaceDir);
      await reconcileOnce(api, workspaceRoot);
    } catch (err) {
      api.logger.warn(`qq-automation-manager: reconcile failed: ${String(err)}`);
    } finally {
      running = false;
    }
  };

  return {
    id: "qq-automation-manager",
    start: async (ctx) => {
      const cfg = api.runtime.config.loadConfig();
      const manager = normalizeManagerConfig(cfg, api.logger);
      if (manager.reconcileOnStartup !== false) {
        await tick(ctx.workspaceDir);
      }
      const intervalMs = Math.max(15_000, Number(manager.reconcileIntervalMs || 120_000));
      timer = setInterval(() => {
        void tick(ctx.workspaceDir);
      }, intervalMs);
      timer.unref?.();
      api.logger.info(`qq-automation-manager: internal scheduler started (intervalMs=${intervalMs})`);
    },
    stop: async () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      api.logger.info("qq-automation-manager: service stopped");
    },
  };
}
