import type { OneBotClient } from "../../client.js";
import type { NapCatTransport } from "./action-invoker.js";

export function createWsClientAdapter(client: OneBotClient): NapCatTransport {
  return {
    callActionEnvelope: (action, params, timeoutMs) =>
      client.callActionEnvelope(action, params, timeoutMs),
  };
}
