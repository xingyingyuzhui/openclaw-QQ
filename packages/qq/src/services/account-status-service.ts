import { OneBotClient } from "../client.js";
import { getLoginInfo } from "./message-service.js";

export async function probeQqAccount(params: {
  account: { accountId: string; config: any };
  timeoutMs?: number;
  getLiveClient: (accountId: string) => OneBotClient | undefined;
}): Promise<any> {
  const { account, timeoutMs } = params;
  if (!account.config.wsUrl) return { ok: false, error: "Missing wsUrl" };

  const liveClient = params.getLiveClient(account.accountId);
  if (liveClient?.isConnected()) {
    try {
      const info = await getLoginInfo(liveClient, { route: "system", source: "chat", stage: "probe_account_live" });
      return { ok: true, bot: { id: String(info.user_id), username: info.nickname } };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  const client = new OneBotClient({
    wsUrl: account.config.wsUrl,
    accessToken: account.config.accessToken,
    silent: true,
    accountId: account.accountId,
    napcatVersionPolicy: account.config.napcatVersionPolicy,
    napcatCapabilityProbeEnabled: account.config.napcatCapabilityProbeEnabled,
    napcatActionTimeoutMs: account.config.napcatActionTimeoutMs,
    napcatActionMaxRetries: account.config.napcatActionMaxRetries,
    napcatActionRetryBaseDelayMs: account.config.napcatActionRetryBaseDelayMs,
  });

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      client.disconnect();
      resolve({ ok: false, error: "Connection timeout" });
    }, timeoutMs || 5000);

    client.on("connect", async () => {
      try {
        const info = await getLoginInfo(client, { route: "system", source: "chat", stage: "probe_account_temp" });
        clearTimeout(timer);
        client.disconnect();
        resolve({ ok: true, bot: { id: String(info.user_id), username: info.nickname } });
      } catch (e) {
        clearTimeout(timer);
        client.disconnect();
        resolve({ ok: false, error: String(e) });
      }
    });

    client.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, error: String(err) });
    });

    client.connect();
  });
}
