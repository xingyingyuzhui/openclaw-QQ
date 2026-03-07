import type { OneBotClient } from "../client.js";
import type { NapCatInvokeCtx } from "./message-service.js";

export async function setGroupBan(
  client: OneBotClient,
  groupId: number | string,
  userId: number | string,
  duration = 1800,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction(
    "set_group_ban",
    { group_id: groupId, user_id: userId, duration },
    ctx,
  );
}

export async function setGroupKick(
  client: OneBotClient,
  groupId: number | string,
  userId: number | string,
  rejectAddRequest = false,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction(
    "set_group_kick",
    { group_id: groupId, user_id: userId, reject_add_request: rejectAddRequest },
    ctx,
  );
}

export async function setGroupAddRequest(
  client: OneBotClient,
  flag: string,
  subType: string,
  approve = true,
  reason = "",
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction(
    "set_group_add_request",
    { flag, sub_type: subType, approve, reason },
    ctx,
  );
}

export async function setFriendAddRequest(
  client: OneBotClient,
  flag: string,
  approve = true,
  remark = "",
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction(
    "set_friend_add_request",
    { flag, approve, remark },
    ctx,
  );
}

export async function groupPoke(
  client: OneBotClient,
  groupId: number | string,
  userId: number | string,
  ctx?: NapCatInvokeCtx,
): Promise<any> {
  return client.invokeNapCatAction(
    "group_poke",
    { group_id: groupId, user_id: userId },
    ctx,
  );
}
