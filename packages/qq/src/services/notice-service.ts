import type { OneBotClient } from "../client.js";
import type { NapCatInvokeCtx } from "./message-service.js";

export async function getGroupNotice(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("_get_group_notice", params, ctx);
}

export async function sendGroupNotice(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("_send_group_notice", params, ctx);
}

export async function deleteGroupNotice(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("_del_group_notice", params, ctx);
}

export async function getGroupIgnoreAddRequest(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_group_ignore_add_request", params, ctx);
}

export async function getGroupIgnoredNotifies(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_group_ignored_notifies", params, ctx);
}

export async function getGroupDetailInfo(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_group_detail_info", params, ctx);
}

export async function getGroupInfoEx(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_group_info_ex", params, ctx);
}

export async function getGroupShutList(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("get_group_shut_list", params, ctx);
}

export async function setGroupAddOption(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("set_group_add_option", params, ctx);
}

export async function setGroupRobotAddOption(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("set_group_robot_add_option", params, ctx);
}

export async function setGroupSearch(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("set_group_search", params, ctx);
}

export async function setGroupTodo(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("set_group_todo", params, ctx);
}

export async function setGroupKickMembers(client: OneBotClient, params: Record<string, unknown>, ctx?: NapCatInvokeCtx): Promise<any> {
  return client.invokeNapCatAction("set_group_kick_members", params, ctx);
}
