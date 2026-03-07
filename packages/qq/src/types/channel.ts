import type { ChannelAccountSnapshot } from "openclaw/plugin-sdk";
import type { OneBotClient } from "../client.js";
import type { QQConfig } from "../config.js";

export type ResolvedQQAccount = ChannelAccountSnapshot & {
  config: QQConfig;
  client?: OneBotClient;
};
