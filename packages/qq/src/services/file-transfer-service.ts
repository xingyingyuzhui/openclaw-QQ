import type { OneBotClient } from "../client.js";
import type { NapCatInvokeCtx } from "./message-service.js";

export async function uploadGroupFile(
  client: OneBotClient,
  groupId: number | string,
  file: string,
  name?: string,
  folderId?: string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction(
    "upload_group_file",
    {
      group_id: groupId,
      file,
      name,
      folder_id: folderId,
    },
    ctx,
  );
}

export async function uploadPrivateFile(
  client: OneBotClient,
  userId: number | string,
  file: string,
  name?: string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction(
    "upload_private_file",
    {
      user_id: userId,
      file,
      name,
    },
    ctx,
  );
}

export async function sendOnlineFile(
  client: OneBotClient,
  userId: number | string,
  filePath: string,
  fileName: string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction(
    "send_online_file",
    {
      user_id: userId,
      file_path: filePath,
      file_name: fileName,
    },
    ctx,
  );
}
