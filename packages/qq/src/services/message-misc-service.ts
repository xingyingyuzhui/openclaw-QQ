import type { OneBotClient } from "../client.js";
import type { NapCatInvokeCtx } from "./message-service.js";

export async function forwardFriendSingleMessage(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("forward_friend_single_msg", params, ctx);
}

export async function forwardGroupSingleMessage(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("forward_group_single_msg", params, ctx);
}

export async function getDoubtFriendsAddRequest(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_doubt_friends_add_request", params, ctx);
}

export async function getShareLink(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_share_link", params, ctx);
}

export async function sendMessage(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("send_msg", params, ctx);
}

export async function sendGroupSign(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("send_group_sign", params, ctx);
}

export async function sendPacket(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("send_packet", params, ctx);
}

export async function setDoubtFriendsAddRequest(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("set_doubt_friends_add_request", params, ctx);
}
