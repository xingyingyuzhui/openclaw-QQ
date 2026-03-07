import type { OneBotClient } from "../client.js";
import type { NapCatInvokeCtx } from "./message-service.js";

export async function getGroupHonorInfo(
  client: OneBotClient,
  groupId: number | string,
  type = "all",
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("get_group_honor_info", { group_id: groupId, type }, ctx);
}

export async function getGroupAtAllRemain(
  client: OneBotClient,
  groupId: number | string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction("get_group_at_all_remain", { group_id: groupId }, ctx);
}
