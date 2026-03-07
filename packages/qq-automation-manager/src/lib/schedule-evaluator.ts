import type { CronSchedule, TargetState } from "./target-config.js";

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

export function randomMinutes(minMinutes: number, maxMinutes: number): number {
  const min = Math.max(1, Math.floor(minMinutes));
  const max = Math.max(min, Math.floor(maxMinutes));
  const delta = max - min + 1;
  return min + Math.floor(Math.random() * delta);
}

export function shouldRunNow(
  schedule: CronSchedule,
  state: TargetState,
  nowMs: number,
): { due: boolean; nextStatePatch?: Partial<TargetState> } {
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
