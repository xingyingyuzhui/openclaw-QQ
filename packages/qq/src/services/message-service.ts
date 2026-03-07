import type { OneBotClient } from "../client.js";
import type { OneBotMessage } from "../types.js";

export type NapCatInvokeCtx = {
  route?: string;
  requestId?: string;
  source?: "chat" | "automation" | "inbound";
  stage?: string;
  msgId?: string;
  dispatchId?: string;
  attemptId?: string;
};

export async function sendPrivateMessage(
  client: OneBotClient,
  userId: number | string,
  message: OneBotMessage | string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("send_private_msg", { user_id: userId, message }, ctx);
}

export async function sendGroupMessage(
  client: OneBotClient,
  groupId: number | string,
  message: OneBotMessage | string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("send_group_msg", { group_id: groupId, message }, ctx);
}

export async function sendGuildChannelMessage(
  client: OneBotClient,
  guildId: string,
  channelId: string,
  message: OneBotMessage | string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("send_guild_channel_msg", { guild_id: guildId, channel_id: channelId, message }, ctx);
}

export async function deleteMessage(
  client: OneBotClient,
  messageId: number | string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("delete_msg", { message_id: messageId }, ctx);
}

export async function getLoginInfo(client: OneBotClient, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_login_info", {}, ctx);
}

export async function getMessage(
  client: OneBotClient,
  messageId: number | string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("get_msg", { message_id: messageId }, ctx);
}

export async function getGroupMessageHistory(
  client: OneBotClient,
  groupId: number | string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("get_group_msg_history", { group_id: groupId }, ctx);
}

export async function getForwardMessage(
  client: OneBotClient,
  id: string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("get_forward_msg", { id }, ctx);
}

export async function getFriendList(client: OneBotClient, ctx?: NapCatInvokeCtx): Promise<any[]> {
  return (await client.invokeNapCatAction("get_friend_list", {}, ctx)) as any[];
}

export async function getGroupList(client: OneBotClient, ctx?: NapCatInvokeCtx): Promise<any[]> {
  return (await client.invokeNapCatAction("get_group_list", {}, ctx)) as any[];
}

export async function getGuildList(client: OneBotClient, ctx?: NapCatInvokeCtx): Promise<any[]> {
  return (await client.invokeNapCatAction("get_guild_list", {}, ctx)) as any[];
}

export async function getGuildServiceProfile(client: OneBotClient, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_guild_service_profile", {}, ctx);
}

export async function getGroupMemberInfo(
  client: OneBotClient,
  groupId: number | string,
  userId: number | string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("get_group_member_info", { group_id: groupId, user_id: userId }, ctx);
}

export async function canSendRecord(client: OneBotClient, ctx?: NapCatInvokeCtx): Promise<boolean> {
  try {
    const data = await client.invokeNapCatAction("can_send_record", {}, ctx);
    return Boolean((data as any)?.yes);
  } catch {
    return false;
  }
}

export async function canSendImage(client: OneBotClient, ctx?: NapCatInvokeCtx): Promise<boolean> {
  try {
    const data = await client.invokeNapCatAction("can_send_image", {}, ctx);
    return Boolean((data as any)?.yes);
  } catch {
    return true;
  }
}

export async function setInputStatus(
  client: OneBotClient,
  userId: number | string,
  eventType: number,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction(
    "set_input_status",
    { user_id: String(userId), event_type: Number(eventType) },
    ctx,
  );
}
