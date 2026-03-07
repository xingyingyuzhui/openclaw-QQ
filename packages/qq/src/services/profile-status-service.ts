import type { OneBotClient } from "../client.js";
import type { NapCatInvokeCtx } from "./message-service.js";

export async function deleteFriend(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("delete_friend", params, ctx);
}

export async function setDiyOnlineStatus(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("set_diy_online_status", params, ctx);
}

export async function setOnlineStatus(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("set_online_status", params, ctx);
}

export async function setQqAvatar(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("set_qq_avatar", params, ctx);
}

export async function setQqProfile(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("set_qq_profile", params, ctx);
}

export async function setSelfLongnick(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("set_self_longnick", params, ctx);
}
