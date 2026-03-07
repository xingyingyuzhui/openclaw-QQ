import type { OneBotClient } from "../client.js";
import type { NapCatInvokeCtx } from "./message-service.js";

export async function setFriendRemark(
  client: OneBotClient,
  userId: number | string,
  remark: string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("set_friend_remark", { user_id: userId, remark }, ctx);
}

export async function setGroupAdmin(
  client: OneBotClient,
  groupId: number | string,
  userId: number | string,
  enable = true,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("set_group_admin", { group_id: groupId, user_id: userId, enable }, ctx);
}

export async function setGroupCard(
  client: OneBotClient,
  groupId: number | string,
  userId: number | string,
  card: string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("set_group_card", { group_id: groupId, user_id: userId, card }, ctx);
}

export async function setGroupName(
  client: OneBotClient,
  groupId: number | string,
  groupName: string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("set_group_name", { group_id: groupId, group_name: groupName }, ctx);
}

export async function setGroupSpecialTitle(
  client: OneBotClient,
  groupId: number | string,
  userId: number | string,
  specialTitle: string,
  duration = -1,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction(
    "set_group_special_title",
    { group_id: groupId, user_id: userId, special_title: specialTitle, duration },
    ctx,
  );
}

export async function setGroupWholeBan(
  client: OneBotClient,
  groupId: number | string,
  enable = true,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("set_group_whole_ban", { group_id: groupId, enable }, ctx);
}

export async function setGroupPortrait(
  client: OneBotClient,
  groupId: number | string,
  file: string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("set_group_portrait", { group_id: groupId, file }, ctx);
}

export async function setGroupRemark(
  client: OneBotClient,
  groupId: number | string,
  remark: string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("set_group_remark", { group_id: groupId, remark }, ctx);
}

export async function setGroupSign(
  client: OneBotClient,
  groupId: number | string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("set_group_sign", { group_id: groupId }, ctx);
}

export async function setGroupLeave(
  client: OneBotClient,
  groupId: number | string,
  isDismiss = false,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("set_group_leave", { group_id: groupId, is_dismiss: isDismiss }, ctx);
}
