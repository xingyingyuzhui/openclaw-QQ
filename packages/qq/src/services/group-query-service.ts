import type { OneBotClient } from "../client.js";
import type { NapCatInvokeCtx } from "./message-service.js";

export async function getGroupInfo(
  client: OneBotClient,
  groupId: number | string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("get_group_info", { group_id: groupId }, ctx);
}

export async function getGroupMemberList(
  client: OneBotClient,
  groupId: number | string,
  ctx?: NapCatInvokeCtx,
): Promise<any[]> {
  return (await client.invokeNapCatAction("get_group_member_list", { group_id: groupId }, ctx)) as unknown as any[];
}

export async function getGroupSystemMessages(
  client: OneBotClient,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("get_group_system_msg", {}, ctx);
}

export async function getGroupFileSystemInfo(
  client: OneBotClient,
  groupId: number | string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("get_group_file_system_info", { group_id: groupId }, ctx);
}

export async function getGroupRootFiles(
  client: OneBotClient,
  groupId: number | string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("get_group_root_files", { group_id: groupId }, ctx);
}

export async function getGroupFilesByFolder(
  client: OneBotClient,
  groupId: number | string,
  folderId: string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("get_group_files_by_folder", { group_id: groupId, folder_id: folderId }, ctx);
}
