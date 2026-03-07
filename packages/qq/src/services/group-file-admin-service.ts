import type { OneBotClient } from "../client.js";
import type { NapCatInvokeCtx } from "./message-service.js";

export async function createGroupFileFolder(
  client: OneBotClient,
  groupId: number | string,
  name: string,
  parentId = "/",
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction(
    "create_group_file_folder",
    { group_id: groupId, name, parent_id: parentId },
    ctx,
  );
}

export async function deleteGroupFile(
  client: OneBotClient,
  groupId: number | string,
  fileId: string,
  busid: number,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction(
    "delete_group_file",
    { group_id: groupId, file_id: fileId, busid },
    ctx,
  );
}

export async function deleteGroupFolder(
  client: OneBotClient,
  groupId: number | string,
  folderId: string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("delete_group_folder", { group_id: groupId, folder_id: folderId }, ctx);
}

export async function renameGroupFile(
  client: OneBotClient,
  groupId: number | string,
  fileId: string,
  busid: number,
  newName: string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction(
    "rename_group_file",
    { group_id: groupId, file_id: fileId, busid, name: newName },
    ctx,
  );
}

export async function moveGroupFile(
  client: OneBotClient,
  groupId: number | string,
  fileId: string,
  busid: number,
  parentDirectory: string,
  targetDirectory: string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction(
    "move_group_file",
    {
      group_id: groupId,
      file_id: fileId,
      busid,
      parent_directory: parentDirectory,
      target_directory: targetDirectory,
    },
    ctx,
  );
}
