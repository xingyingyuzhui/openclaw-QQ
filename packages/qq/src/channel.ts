import {
  type ChannelPlugin,
  buildChannelConfigSchema,
  DEFAULT_ACCOUNT_ID,
  normalizeAccountId,
  applyAccountNameToChannelSection,
  migrateBaseNameToDefaultAccount,
} from "openclaw/plugin-sdk";
import { OneBotClient } from "./client.js";
import { QQConfigSchema, type QQConfig } from "./config.js";
import { createDeliveryManager } from "./delivery.js";
import { sendDirectOutbound } from "./outbound/direct-sender.js";
import { logSendAttempt, summarizeText } from "./outbound/send-target.js";
import { configureQQLogger, resetQQLoggerAccount } from "./diagnostics/logger.js";
import { handleInboundMessageEvent } from "./inbound/inbound-orchestrator.js";
import {
  appendConversationLog as appendConversationLogCore,
  conversationBaseDir as conversationBaseDirCore,
} from "./core/runtime-context.js";
import { normalizeTarget } from "./routing.js";
import { getQQRuntime } from "./runtime.js";
import { ensureMediaRelayStarted } from "./media-relay.js";
import {
  bindAccountWorkspaceRoot,
  clearAccountWorkspaceRoot,
  clearCleanupIntervalForAccount,
  deleteClientForAccount,
  getClientForAccount,
  resolveAccountWorkspaceRoot,
  setCleanupIntervalForAccount,
  setClientForAccount,
} from "./state/account-runtime-registry.js";
import { clearAccountRouteRuntime } from "./state/route-runtime-registry.js";
import {
  evaluateProactiveTick,
  markProactiveFailed,
  markProactiveSent,
  shouldEnableProactiveScheduler,
} from "./services/proactive-scheduler-service.js";
import { getLoginInfo } from "./services/message-service.js";
import { listDirectoryGroups, listDirectoryPeers } from "./services/account-directory-service.js";
import { probeQqAccount } from "./services/account-status-service.js";
import { setFriendAddRequest, setGroupAddRequest } from "./services/group-admin-service.js";
import { deleteMessage } from "./services/message-service.js";
import type { ResolvedQQAccount } from "./types/channel.js";

function cleanupAccountRuntime(accountId: string, clientHint?: OneBotClient) {
  clearCleanupIntervalForAccount(accountId);
  clearAccountRouteRuntime(accountId);
  const client = getClientForAccount(accountId) || clientHint;
  if (client) {
    try { client.disconnect(); } catch {}
  }
  deleteClientForAccount(accountId);
  clearAccountWorkspaceRoot(accountId);
  resetQQLoggerAccount(accountId);
}

async function ensureClientReadyForSend(accountId: string, config: QQConfig): Promise<void> {
  const client = getClientForAccount(accountId);
  if (!client) throw new Error(`QQ client not found for account=${accountId}`);
  if (client.isConnected()) return;
  const waitMs = Math.max(100, Number(config.sendWaitForReconnectMs ?? 5000));
  const ok = await client.waitUntilConnected(waitMs);
  if (!ok) throw new Error("WebSocket not open");
}

const deliveryManager = createDeliveryManager({
  ensureReady: ensureClientReadyForSend,
  onAttemptLog: logSendAttempt,
});
const proactiveNudges = [
  "忙完了没？我在。要不要我顺手帮你把下一步也做了。",
  "路过提醒：别一直硬扛，喝口水再继续，我陪你。",
  "今天状态还行吗？要是累了，我给你走个省脑模式。",
] as const;

const DEFAULT_SEND_CFG = {
  sendQueueMaxRetries: 3,
  sendQueueBaseDelayMs: 1000,
  sendQueueJitterMs: 400,
  sendRetryMinDelayMs: 500,
  sendRetryMaxDelayMs: 8000,
  sendRetryJitterRatio: 0.15,
  sendWaitForReconnectMs: 5000,
  rateLimitMs: 1000,
} as QQConfig;

function conversationBaseDir(accountId: string, route: string) {
  return conversationBaseDirCore(resolveAccountWorkspaceRoot(accountId), route);
}

async function appendConversationLog(route: string, accountId: string, direction: "in" | "out", data: {
  messageId?: string | number | null;
  text?: string;
  mediaCount?: number;
  filePath?: string;
  mediaItemsTotal?: number;
  mediaItemsMaterialized?: number;
  mediaItemsUnresolved?: number;
  unresolvedReasons?: string[];
}) {
  await appendConversationLogCore({
    workspaceRoot: resolveAccountWorkspaceRoot(accountId),
    route,
    accountId,
    direction,
    data,
    summarizeText,
  });
}
export const qqChannel: ChannelPlugin<ResolvedQQAccount> = {
  id: "qq",
  meta: {
    id: "qq",
    label: "QQ (OneBot)",
    selectionLabel: "QQ",
    docsPath: "extensions/qq",
    blurb: "Connect to QQ via OneBot v11",
  },
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    // @ts-ignore
    deleteMessage: true,
  },
  configSchema: buildChannelConfigSchema(QQConfigSchema),
  config: {
    listAccountIds: (cfg) => {
        // @ts-ignore
        const qq = cfg.channels?.qq;
        if (!qq) return [];
        if (qq.accounts) return Object.keys(qq.accounts);
        return [DEFAULT_ACCOUNT_ID];
    },
    resolveAccount: (cfg, accountId) => {
        const id = accountId ?? DEFAULT_ACCOUNT_ID;
        // @ts-ignore
        const qq = cfg.channels?.qq;
        const accountConfig = id === DEFAULT_ACCOUNT_ID ? qq : qq?.accounts?.[id];
        return {
            accountId: id,
            name: accountConfig?.name ?? "QQ Default",
            enabled: true,
            configured: Boolean(accountConfig?.wsUrl),
            tokenSource: accountConfig?.accessToken ? "config" : "none",
            config: accountConfig || {},
        };
    },
    defaultAccountId: () => DEFAULT_ACCOUNT_ID,
    describeAccount: (acc) => ({
        accountId: acc.accountId,
        configured: acc.configured,
    }),
  },
  directory: {
      listPeers: async ({ accountId }) =>
        listDirectoryPeers({
          accountId,
          getClient: (id) => getClientForAccount(id),
        }),
      listGroups: async ({ accountId, cfg }) =>
        listDirectoryGroups({
          accountId,
          cfg,
          getClient: (id) => getClientForAccount(id),
        }),
  },
  status: {
      probeAccount: async ({ account, timeoutMs }) =>
        probeQqAccount({
          account,
          timeoutMs,
          getLiveClient: (id) => getClientForAccount(id),
        }),
      buildAccountSnapshot: ({ account, runtime, probe }) => {
          return {
              accountId: account.accountId,
              name: account.name,
              enabled: account.enabled,
              configured: account.configured,
              running: runtime?.running ?? false,
              lastStartAt: runtime?.lastStartAt ?? null,
              lastError: runtime?.lastError ?? null,
              probe,
          };
      }
  },
  setup: {
    resolveAccountId: ({ accountId }) => normalizeAccountId(accountId),
    applyAccountName: ({ cfg, accountId, name }) => 
        applyAccountNameToChannelSection({ cfg, channelKey: "qq", accountId, name }),
    validateInput: ({ input }) => null,
    applyAccountConfig: ({ cfg, accountId, input }) => {
        const namedConfig = applyAccountNameToChannelSection({
            cfg,
            channelKey: "qq",
            accountId,
            name: input.name,
        });
        
        const next = accountId !== DEFAULT_ACCOUNT_ID 
            ? migrateBaseNameToDefaultAccount({ cfg: namedConfig, channelKey: "qq" }) 
            : namedConfig;

        const newConfig = {
            wsUrl: input.wsUrl || "ws://localhost:3001",
            accessToken: input.accessToken,
            enabled: true,
        };

        if (accountId === DEFAULT_ACCOUNT_ID) {
            return {
                ...next,
                channels: {
                    ...next.channels,
                    qq: { ...next.channels?.qq, ...newConfig }
                }
            };
        }
        
        return {
            ...next,
            channels: {
                ...next.channels,
                qq: {
                    ...next.channels?.qq,
                    enabled: true,
                    accounts: {
                        ...next.channels?.qq?.accounts,
                        [accountId]: {
                            ...next.channels?.qq?.accounts?.[accountId],
                            ...newConfig
                        }
                    }
                }
            }
        };
    }
  },
  proactive: {
    shouldEnable: ({ account }) => shouldEnableProactiveScheduler(account as ResolvedQQAccount),
    tick: async ({ accountId, account, nowMs }) =>
      evaluateProactiveTick({
        accountId,
        account: account as ResolvedQQAccount,
        nowMs,
        nudges: proactiveNudges,
      }),
    markSent: async ({ context, result, nowMs }) => {
      await markProactiveSent({
        accountId: context.accountId,
        account: context.account as ResolvedQQAccount,
        resultRoute: String(result.route || ""),
        nowMs,
      });
    },
    markFailed: async ({ context, result, error }) => {
      markProactiveFailed({
        accountId: context.accountId,
        resultRoute: String(result.route || ""),
        error: String(error || ""),
      });
    },
  },
  gateway: {
    startAccount: async (ctx) => {
        const { account, cfg, abortSignal, setStatus } = ctx;
        const config = account.config;
        const ownerUserId = String((config as any).ownerUserId || "").trim();
        if (ownerUserId) process.env.OPENCLAW_QQ_OWNER_ID = ownerUserId;
        const accountWorkspaceRoot = bindAccountWorkspaceRoot(account.accountId, cfg);
        configureQQLogger({
          accountId: account.accountId,
          workspaceRoot: accountWorkspaceRoot,
          traceEnabled: (config as any).loggingTraceEnabled !== false && (config as any).napcatLogTraceEnabled !== false,
          verboseErrors: (config as any).loggingVerboseErrors === true,
        });

        if (!config.wsUrl) throw new Error("QQ: wsUrl is required");

        await ensureMediaRelayStarted({
          workspaceRoot: accountWorkspaceRoot,
          enabled: (config as any).mediaProxyEnabled === true,
          host: (config as any).mediaProxyListenHost || "0.0.0.0",
          port: Number((config as any).mediaProxyListenPort || 18890),
          proxyPath: String((config as any).mediaProxyPath || "/qq/media"),
          token: String((config as any).mediaProxyToken || "").trim() || "openclaw-qq-relay",
        });

        // Ensure one runtime instance (client + cleanup timer) per account.
        if (getClientForAccount(account.accountId)) {
          console.log(`[QQ] Stopping existing runtime for account ${account.accountId} before restart`);
        }
        cleanupAccountRuntime(account.accountId);

        const client = new OneBotClient({
            wsUrl: config.wsUrl,
            accessToken: config.accessToken,
            accountId: account.accountId,
            napcatVersionPolicy: (config as any).napcatVersionPolicy,
            napcatCapabilityProbeEnabled: (config as any).napcatCapabilityProbeEnabled,
            napcatActionTimeoutMs: Number((config as any).napcatActionTimeoutMs ?? 5000),
            napcatActionMaxRetries: Number((config as any).napcatActionMaxRetries ?? 1),
            napcatActionRetryBaseDelayMs: Number((config as any).napcatActionRetryBaseDelayMs ?? 300),
        });
        
        setClientForAccount(account.accountId, client);

        const processedMsgIds = new Set<string>();
        const cleanupInterval = setInterval(() => {
            if (processedMsgIds.size > 1000) processedMsgIds.clear();
        }, 3600000);
        setCleanupIntervalForAccount(account.accountId, cleanupInterval);

        client.on("connect", async () => {
             console.log(`[QQ] Connected account ${account.accountId}`);
             try {
               setStatus?.({ ...ctx.getStatus(), accountId: account.accountId, connected: true, running: true, lastError: null });
             } catch {}
             try {
                const info = await getLoginInfo(client, { route: "system", source: "chat", stage: "start_account_login_info" });
                if (info && info.user_id) client.setSelfId(info.user_id);
                if (info && info.nickname) console.log(`[QQ] Logged in as: ${info.nickname} (${info.user_id})`);
                getQQRuntime().channel.activity.record({
                    channel: "qq", accountId: account.accountId, direction: "inbound", 
                 });
             } catch (err) { }
        });
        client.on("disconnect", () => {
          try {
            setStatus?.({ ...ctx.getStatus(), accountId: account.accountId, connected: false });
          } catch {}
        });

        client.on("request", (event) => {
            if (config.autoApproveRequests) {
                if (event.request_type === "friend") {
                  void setFriendAddRequest(client, event.flag, true, "", { route: "system", source: "chat", stage: "auto_approve_friend" });
                } else if (event.request_type === "group") {
                  void setGroupAddRequest(client, event.flag, event.sub_type, true, "", { route: "system", source: "chat", stage: "auto_approve_group" });
                }
            }
        });

        client.on("message", async (event) => {
          await handleInboundMessageEvent({
            event,
            client,
            account,
            cfg,
            config,
            accountWorkspaceRoot,
            processedMsgIds,
            deliveryManager,
            conversationBaseDir,
            appendConversationLog,
          });
        });

        client.connect();
        const cleanup = () => {
          cleanupAccountRuntime(account.accountId, client);
        };
        if (abortSignal.aborted) {
          cleanup();
          return;
        }
        await new Promise<void>((resolve) => {
          abortSignal.addEventListener("abort", () => resolve(), { once: true });
        });
        cleanup();
    },
    stopAccount: async ({ accountId }) => {
        cleanupAccountRuntime(accountId);
    },
    logoutAccount: async ({ accountId, cfg }) => {
        return { loggedOut: true, cleared: true };
    }
  },
  outbound: {
    sendText: async ({ to, text, accountId, replyTo, cfg }) => {
        const effectiveAccountId = accountId || DEFAULT_ACCOUNT_ID;
        const client = getClientForAccount(effectiveAccountId);
        if (!client) return { channel: "qq", sent: false, error: "Client not connected" };
        return sendDirectOutbound({
          to,
          text,
          replyTo,
          accountId: effectiveAccountId,
          cfg,
          client,
          deliveryManager,
          defaultSendConfig: DEFAULT_SEND_CFG,
          resolveAccountWorkspaceRoot: (id) => resolveAccountWorkspaceRoot(id),
          conversationBaseDir: (id, route) => conversationBaseDir(id, route),
          appendConversationLog,
        });
    },
    sendMedia: async ({ to, text, mediaUrl, accountId, replyTo, cfg }) => {
         const effectiveAccountId = accountId || DEFAULT_ACCOUNT_ID;
         const client = getClientForAccount(effectiveAccountId);
         if (!client) return { channel: "qq", sent: false, error: "Client not connected" };
         return sendDirectOutbound({
           to,
           text,
           mediaUrl,
           replyTo,
           accountId: effectiveAccountId,
           cfg,
           client,
           deliveryManager,
           defaultSendConfig: DEFAULT_SEND_CFG,
           resolveAccountWorkspaceRoot: (id) => resolveAccountWorkspaceRoot(id),
           conversationBaseDir: (id, route) => conversationBaseDir(id, route),
           appendConversationLog,
         });
    },
    // @ts-ignore
    deleteMessage: async ({ messageId, accountId }) => {
        const client = getClientForAccount(accountId || DEFAULT_ACCOUNT_ID);
        if (!client) return { channel: "qq", success: false, error: "Client not connected" };
        try {
          await deleteMessage(client, messageId, { route: "system", source: "chat", stage: "delete_message" });
          return { channel: "qq", success: true };
        }
        catch (err) { return { channel: "qq", success: false, error: String(err) }; }
    }
  },
  messaging: { 
      normalizeTarget,
      targetResolver: {
          looksLikeId: (id) => /^user:\d{5,12}$/.test(id) || /^group:\d{5,12}$/.test(id) || /^guild:[^:]+:[^:]+$/.test(id),
          hint: "user:QQ号, group:群号, guild:频道",
      }
  }
};
