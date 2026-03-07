import type { OneBotClient } from "../client.js";

export type StreamInvokeContext = {
  route?: string;
  msgId?: string;
  dispatchId?: string;
  attemptId?: string;
  source?: "chat" | "automation" | "inbound";
  stage?: string;
};

export async function uploadFileStream(
  client: OneBotClient,
  params: Record<string, unknown>,
  ctx: StreamInvokeContext,
): Promise<any> {
  return client.invokeNapCatAction("upload_file_stream", params as any, {
    route: ctx.route,
    msgId: ctx.msgId,
    dispatchId: ctx.dispatchId,
    attemptId: ctx.attemptId,
    source: ctx.source || "chat",
    stage: ctx.stage || "stream-upload",
  });
}

export async function cleanStreamTemp(
  client: OneBotClient,
  ctx: StreamInvokeContext,
): Promise<any> {
  return client.invokeNapCatAction("clean_stream_temp_file", {}, {
    route: ctx.route,
    source: ctx.source || "chat",
    stage: ctx.stage || "stream-clean",
  });
}
