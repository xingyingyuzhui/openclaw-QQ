import type { OneBotClient } from "../client.js";
import type { QQConfig } from "../config.js";
import { cleanStreamTemp, uploadFileStream, type StreamInvokeContext } from "../services/outbound-media-service.js";

export async function supportsStreamTransport(client: OneBotClient, config: QQConfig, ctx?: StreamInvokeContext): Promise<boolean> {
  if (config.streamTransportEnabled === false) return false;
  try {
    await cleanStreamTemp(client, { ...ctx, stage: ctx?.stage || "stream-probe" });
    return true;
  } catch {
    return false;
  }
}

export async function uploadFileStreamIfAvailable(
  client: OneBotClient,
  file: string,
  config: QQConfig,
  ctx?: StreamInvokeContext,
): Promise<string | null> {
  if (config.streamTransportEnabled === false) return null;
  try {
    const data =
      (await uploadFileStream(client, { file }, { ...ctx, stage: ctx?.stage || "stream-upload" }).catch(() => null)) ||
      (await uploadFileStream(client, { path: file }, { ...ctx, stage: ctx?.stage || "stream-upload" }).catch(() => null)) ||
      (await uploadFileStream(client, { file_path: file }, { ...ctx, stage: ctx?.stage || "stream-upload" }).catch(() => null));
    const v = String(data?.file || data?.url || data?.path || data?.file_path || "").trim();
    return v || null;
  } catch {
    return null;
  }
}
