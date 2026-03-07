import type { OneBotClient } from "../client.js";

export type InboundMediaAction =
  | "get_image"
  | "get_record"
  | "get_file"
  | "get_group_file_url"
  | "get_private_file_url"
  | "download_file"
  | "download_file_stream"
  | "download_file_image_stream"
  | "download_file_record_stream";

export async function invokeInboundMediaAction(
  client: OneBotClient,
  action: InboundMediaAction,
  params: Record<string, unknown>,
  ctx: { route?: string; msgId?: string; source?: "chat" | "automation" | "inbound"; stage?: string },
): Promise<any> {
  return client.invokeNapCatAction(action, params as any, {
    route: ctx.route,
    msgId: ctx.msgId,
    source: ctx.source || "inbound",
    stage: ctx.stage || "media-resolve",
  });
}

export async function resolveInboundMediaByActionSequence(
  client: OneBotClient,
  attempts: Array<{ action: InboundMediaAction; params: Record<string, unknown> }>,
  pickResolved: (result: any) => string,
  ctx?: { route?: string; msgId?: string },
): Promise<string> {
  for (const it of attempts) {
    try {
      const info = await invokeInboundMediaAction(client, it.action, it.params, {
        route: ctx?.route,
        msgId: ctx?.msgId,
        source: "inbound",
        stage: "media-resolve",
      });
      const resolved = pickResolved(info);
      if (resolved) {
        console.log(`[QQ][media-resolve] resolve_action=${it.action} resolve_result=ok source=${resolved.slice(0, 120)}`);
        return resolved;
      }
      console.log(`[QQ][media-resolve] resolve_action=${it.action} resolve_result=empty`);
    } catch (err: any) {
      console.warn(`[QQ][media-resolve] error_code=resolve_action_failed action=${it.action} error=${err?.message || err}`);
    }
  }
  return "";
}
