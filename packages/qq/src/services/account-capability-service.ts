import type { OneBotClient } from "../client.js";
import type { NapCatInvokeCtx } from "./message-service.js";

export async function getStatus(client: OneBotClient, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_status", {}, ctx);
}

export async function getVersionInfo(client: OneBotClient, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_version_info", {}, ctx);
}

export async function getStrangerInfo(
  client: OneBotClient,
  userId: number | string,
  noCache = false,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("get_stranger_info", { user_id: userId, no_cache: noCache }, ctx);
}

export async function getCookies(client: OneBotClient, domain = "", ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_cookies", domain ? { domain } : {}, ctx);
}

export async function getCsrfToken(client: OneBotClient, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_csrf_token", {}, ctx);
}

export async function getCredentials(client: OneBotClient, domain = "", ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_credentials", domain ? { domain } : {}, ctx);
}
