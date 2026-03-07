import type { OneBotClient } from "../client.js";
import type { NapCatInvokeCtx } from "./message-service.js";

export async function getOnlineFileMessage(
  client: OneBotClient,
  messageId: number | string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("get_online_file_msg", { message_id: messageId }, ctx);
}

export async function receiveOnlineFile(
  client: OneBotClient,
  userId: number | string,
  fileId: string,
  filePath: string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction(
    "receive_online_file",
    { user_id: userId, file_id: fileId, file_path: filePath },
    ctx,
  );
}

export async function refuseOnlineFile(
  client: OneBotClient,
  userId: number | string,
  fileId: string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("refuse_online_file", { user_id: userId, file_id: fileId }, ctx);
}

export async function cancelOnlineFile(
  client: OneBotClient,
  userId: number | string,
  fileId: string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("cancel_online_file", { user_id: userId, file_id: fileId }, ctx);
}
