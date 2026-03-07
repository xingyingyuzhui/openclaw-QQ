import type { OneBotClient } from "../client.js";
import type { NapCatInvokeCtx } from "./message-service.js";

export async function getModelShow(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("_get_model_show", params, ctx);
}

export async function setModelShow(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("_set_model_show", params, ctx);
}

export async function markAllAsRead(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("_mark_all_as_read", params, ctx);
}

export async function botExit(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("bot_exit", params, ctx);
}

export async function cleanCache(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("clean_cache", params, ctx);
}

export async function checkUrlSafely(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("check_url_safely", params, ctx);
}

export async function getClientKey(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_clientkey", params, ctx);
}

export async function getRobotUinRange(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_robot_uin_range", params, ctx);
}

export async function getRKey(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_rkey", params, ctx);
}

export async function getRKeyServer(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_rkey_server", params, ctx);
}

export async function getPacketStatus(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("nc_get_packet_status", params, ctx);
}

export async function getUserStatus(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("nc_get_user_status", params, ctx);
}

export async function setRestart(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("set_restart", params, ctx);
}

export async function testDownloadStream(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("test_download_stream", params, ctx);
}

export async function translateEn2Zh(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("translate_en2zh", params, ctx);
}

export async function invokeUnknownAction(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("unknown", params, ctx);
}
