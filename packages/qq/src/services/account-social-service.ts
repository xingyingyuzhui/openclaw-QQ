import type { OneBotClient } from "../client.js";
import type { NapCatInvokeCtx } from "./message-service.js";

export async function getRecentContacts(client: OneBotClient, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_recent_contact", {}, ctx);
}

export async function getOnlineClients(client: OneBotClient, noCache = false, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_online_clients", { no_cache: noCache }, ctx);
}

export async function getFriendMessageHistory(
  client: OneBotClient,
  userId: number | string,
  messageSeq?: number,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  const params: Record<string, unknown> = { user_id: userId };
  if (typeof messageSeq === "number") params.message_seq = messageSeq;
  return client.invokeNapCatAction("get_friend_msg_history", params, ctx);
}

export async function getProfileLike(
  client: OneBotClient,
  userId: number | string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("get_profile_like", { user_id: userId }, ctx);
}
