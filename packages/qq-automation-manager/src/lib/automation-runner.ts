import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { runOpenclawJsonCommand } from "./route-agent-resolver.js";
import { buildAutomationRoleBlock, readAutomationRoleContext, type AutomationRoleContext } from "./role-context.js";
import type { AutomationRecord, CronSchedule, TargetConfig } from "./target-config.js";

export function buildAgentPrompt(target: TargetConfig, roleBlock = ""): string {
  const smart = target.job.smart || {};
  const maxChars = Math.max(8, Math.min(200, Number(smart.maxChars || 48)));
  const base = String(target.job.message || "").trim();
  return [
    "你正在执行QQ渠道的自动触达任务。",
    "请只输出给用户的一条自然消息，不要输出任何系统标记。",
    "禁止输出 ANNOUNCE_SKIP / QQ_AUTO_SKIP / NO_REPLY 或类似控制词。",
    "要把这条消息当作该 route 绑定 agent 自己说的话，而不是外部调度器的广播。",
    "发送前显式参考当前角色模板、风格和 relationship.json；如果这些信息显示不适合打扰，就直接沉默，不要硬聊。",
    `建议长度不超过 ${maxChars} 个中文字符；最多两句。`,
    `任务目标：${base}`,
    roleBlock,
  ].join("\n");
}

export async function triggerAgentTurn(
  api: OpenClawPluginApi,
  target: TargetConfig,
  agentId: string,
  workspaceRoot?: string,
): Promise<{ ok: boolean; error?: string; summary?: string }> {
  const roleCtx = workspaceRoot ? await readAutomationRoleContext({ workspaceRoot, route: target.route, agentId }).catch(() => null) : null;
  const message = buildAgentPrompt(target, buildAutomationRoleBlock(roleCtx));
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
  try {
    const out = (await runOpenclawJsonCommand(api, args, 120_000)) as Record<string, unknown>;
    const summary = String((out && (out.summary || out.text || out.message)) || "").trim();
    return { ok: true, summary };
  } catch (err: any) {
    return { ok: false, error: String(err?.message || err) };
  }
}

export function buildAutomationRecord(params: {
  targetId: string;
  route: string;
  scheduleKind: CronSchedule["kind"];
  agentId: string;
  triggered: boolean;
  produced: boolean;
  skipped: boolean;
  sentByChannel: boolean | null;
  runMs: number;
  note?: string;
  roleContext?: AutomationRoleContext | null;
}): AutomationRecord {
  return {
    ts: new Date().toISOString(),
    target_id: params.targetId,
    route: params.route,
    triggered: params.triggered,
    produced: params.produced,
    skipped: params.skipped,
    sent_by_channel: params.sentByChannel,
    run_ms: params.runMs,
    note: params.note,
    trace: {
      service: "qq-automation-manager",
      source: "automation",
      execution_mode: "agent-only",
      scheduler: "internal",
      schedule_kind: params.scheduleKind,
      agent_id: params.agentId,
      role_template_id: params.roleContext?.templateId,
      affinity: params.roleContext?.affinity,
      affinity_stage: params.roleContext?.affinityStage,
      initiative_level: params.roleContext?.initiativeLevel,
    },
  };
}
