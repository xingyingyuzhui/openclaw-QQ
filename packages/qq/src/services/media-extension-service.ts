import type { OneBotClient } from "../client.js";
import type { NapCatInvokeCtx } from "./message-service.js";

export async function fetchCustomFace(
  client: OneBotClient,
  file: string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("fetch_custom_face", { file }, ctx);
}

export async function ocrImage(
  client: OneBotClient,
  image: string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("ocr_image", { image }, ctx);
}

export async function getRKey(client: OneBotClient, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("nc_get_rkey", {}, ctx);
}
