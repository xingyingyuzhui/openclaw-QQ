import type { OneBotClient } from "../client.js";
import type { QQConfig } from "../config.js";

async function tryAction(client: OneBotClient, action: string, params: Record<string, any>): Promise<any> {
  return client.sendAction(action, params || {});
}

export async function supportsStreamTransport(client: OneBotClient, config: QQConfig): Promise<boolean> {
  if (config.streamTransportEnabled === false) return false;
  try {
    await tryAction(client, "clean_stream_temp_file", {});
    return true;
  } catch {
    try {
      await tryAction(client, "clean_stream_temp", {});
      return true;
    } catch {
      return false;
    }
  }
}

export async function uploadFileStreamIfAvailable(
  client: OneBotClient,
  file: string,
  config: QQConfig,
): Promise<string | null> {
  if (config.streamTransportEnabled === false) return null;
  try {
    const data =
      (await tryAction(client, "upload_file_stream", { file }).catch(() => null)) ||
      (await tryAction(client, "upload_file_stream", { path: file }).catch(() => null)) ||
      (await tryAction(client, "upload_file_stream", { file_path: file }).catch(() => null));
    const v = String(data?.file || data?.url || data?.path || data?.file_path || "").trim();
    return v || null;
  } catch {
    return null;
  }
}
