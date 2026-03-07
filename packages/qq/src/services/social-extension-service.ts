import type { OneBotClient } from "../client.js";
import type { NapCatInvokeCtx } from "./message-service.js";

export async function friendPoke(
  client: OneBotClient,
  userId: number | string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("friend_poke", { user_id: userId }, ctx);
}

export async function sendPoke(
  client: OneBotClient,
  userId: number | string,
  groupId?: number | string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("send_poke", { user_id: userId, group_id: groupId }, ctx);
}

export async function getFriendsWithCategory(
  client: OneBotClient,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("get_friends_with_category", {}, ctx);
}

export async function getUnidirectionalFriendList(
  client: OneBotClient,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("get_unidirectional_friend_list", {}, ctx);
}
