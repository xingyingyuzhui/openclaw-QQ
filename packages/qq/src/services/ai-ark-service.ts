import type { OneBotClient } from "../client.js";
import type { NapCatInvokeCtx } from "./message-service.js";

export async function arkShareGroup(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("ArkShareGroup", params, ctx);
}

export async function arkSharePeer(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("ArkSharePeer", params, ctx);
}

export async function sendArkShare(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("send_ark_share", params, ctx);
}

export async function sendGroupArkShare(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("send_group_ark_share", params, ctx);
}

export async function getAiCharacters(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_ai_characters", params, ctx);
}

export async function getAiRecord(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_ai_record", params, ctx);
}

export async function sendGroupAiRecord(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("send_group_ai_record", params, ctx);
}

export async function getMiniAppArk(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_mini_app_ark", params, ctx);
}

export async function clickInlineKeyboardButton(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("click_inline_keyboard_button", params, ctx);
}

export async function sendFlashMessage(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("send_flash_msg", params, ctx);
}
