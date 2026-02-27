export {
  pushRouteAggregation,
  finalizeRouteAggregation,
  getRouteAggregationSeq,
  nextRouteGeneration,
  isRouteGenerationCurrent,
} from "./inbound/aggregation.js";

export function messageMentionsSelf(event: any, selfId: number | string): boolean {
  const sid = String(selfId || "");
  const raw = String(event?.raw_message || "");
  if (sid && raw.includes(`[CQ:at,qq=${sid}]`)) return true;
  const msg = event?.message;
  if (Array.isArray(msg)) {
    return msg.some((seg: any) => String(seg?.type || "") === "at" && String(seg?.data?.qq || "") === sid);
  }
  return false;
}
