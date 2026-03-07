import { createHash } from "node:crypto";
import path from "node:path";
import type { OpenClawConfig, OpenClawPluginApi } from "openclaw/plugin-sdk";
import { z } from "zod";

const OWNER_PLACEHOLDER = "QQ_OWNER_ID";
export function getOwnerQq(): string {
  return String(process.env.OPENCLAW_QQ_OWNER_ID || OWNER_PLACEHOLDER).trim();
}
export function getOwnerRoute(): string {
  return `user:${getOwnerQq()}`;
}
export const OWNER_AGENT = "main";

export type CronSchedule =
  | { kind: "cron"; expr: string; tz?: string }
  | { kind: "every"; everyMs: number }
  | { kind: "at"; at: string };

export type TargetSmartConfig = {
  enabled?: boolean;
  minSilenceMinutes?: number;
  activeConversationMinutes?: number;
  randomIntervalMinMinutes?: number;
  randomIntervalMaxMinutes?: number;
  maxChars?: number;
  lowInitiativeExtraSilenceMinutes?: number;
  lowAffinityExtraSilenceMinutes?: number;
  coldStageSkip?: boolean;
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
        lowInitiativeExtraSilenceMinutes: z.number().int().min(0).optional(),
        lowAffinityExtraSilenceMinutes: z.number().int().min(0).optional(),
        coldStageSkip: z.boolean().optional(),
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

export type TargetConfig = z.infer<typeof TargetSchema>;
export type ManagerConfig = z.infer<typeof ManagerSchema>;

export type TargetState = {
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

export type ReconcileState = {
  version: 2;
  targets: Record<string, TargetState>;
  updatedAt: string;
};

export type AutomationRecord = {
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
    role_template_id?: string;
    affinity?: number;
    affinity_stage?: string;
    initiative_level?: string;
  };
};

export type RouteRecentTimes = {
  lastInboundAtMs: number;
  lastOutboundAtMs: number;
};

export function resolveWorkspaceRoot(cfg: OpenClawConfig, fallback?: string): string {
  const fromCfg = cfg?.agents?.defaults?.workspace;
  if (typeof fromCfg === "string" && fromCfg.trim()) return fromCfg.trim();
  if (typeof fallback === "string" && fallback.trim()) return fallback.trim();
  if (typeof process.env.OPENCLAW_WORKSPACE === "string" && process.env.OPENCLAW_WORKSPACE.trim()) {
    return process.env.OPENCLAW_WORKSPACE.trim();
  }
  return path.join(process.env.HOME || "", ".openclaw", "workspace");
}

export function normalizeManagerConfig(cfg: OpenClawConfig, logger: OpenClawPluginApi["logger"]): ManagerConfig {
  const ownerUserId = String((cfg as any)?.channels?.qq?.ownerUserId || "").trim();
  if (ownerUserId) process.env.OPENCLAW_QQ_OWNER_ID = ownerUserId;
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

export function isValidRoute(route: string): boolean {
  if (/^user:\d{5,}$/.test(route)) return true;
  if (/^group:\d{5,}$/.test(route)) return true;
  if (/^guild:[^:/\\.]+:[^:/\\.]+$/.test(route)) return true;
  return false;
}

export function routeToSessionKey(route: string): string {
  return route.replaceAll(":", "__");
}

export function stableHash(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
