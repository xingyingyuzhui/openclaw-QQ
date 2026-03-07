import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import { OneBotClient } from "../client.js";
import type { QQConfig } from "../config.js";
import { getFriendList, getGroupList, getGuildList } from "./message-service.js";

export async function listDirectoryPeers(params: {
  accountId?: string;
  getClient: (accountId: string) => OneBotClient | undefined;
}): Promise<any[]> {
  const client = params.getClient(params.accountId || DEFAULT_ACCOUNT_ID);
  if (!client) return [];
  try {
    const friends = await getFriendList(client, { route: "system", source: "chat", stage: "directory_list_peers" });
    return friends.map((f) => ({
      id: String(f.user_id),
      name: f.remark || f.nickname,
      type: "user" as const,
      metadata: { ...f },
    }));
  } catch {
    return [];
  }
}

export async function listDirectoryGroups(params: {
  accountId?: string;
  cfg: any;
  getClient: (accountId: string) => OneBotClient | undefined;
}): Promise<any[]> {
  const client = params.getClient(params.accountId || DEFAULT_ACCOUNT_ID);
  if (!client) return [];
  const list: any[] = [];

  try {
    const groups = await getGroupList(client, { route: "system", source: "chat", stage: "directory_list_groups" });
    list.push(
      ...groups.map((g) => ({
        id: String(g.group_id),
        name: g.group_name,
        type: "group" as const,
        metadata: { ...g },
      })),
    );
  } catch {}

  const enableGuilds = params.cfg?.channels?.qq?.enableGuilds ?? true;
  if (enableGuilds) {
    try {
      const guilds = await getGuildList(client, { route: "system", source: "chat", stage: "directory_list_guilds" });
      list.push(
        ...guilds.map((g) => ({
          id: `guild:${g.guild_id}`,
          name: `[频道] ${g.guild_name}`,
          type: "group" as const,
          metadata: { ...g },
        })),
      );
    } catch {}
  }

  return list;
}
