import { promises as fs } from "node:fs";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import { withTimeout } from "../utils/timeouts.js";

export async function prepareInboundSessionPipeline(params: {
  route: string;
  msgIdText: string;
  runtime: any;
  cfg: any;
  accountId: string;
  residentAgentId: string;
  residentSessionKey: string;
  ctxPayload: Record<string, unknown>;
  migrateLegacy: () => Promise<void>;
}): Promise<void> {
  const { route, msgIdText, runtime, cfg, accountId, residentAgentId, ctxPayload, migrateLegacy } = params;

  console.log(`[QQ][inbound] route=${route} msgId=${msgIdText} stage=session_prepare`);
  await withTimeout(migrateLegacy(), 4000, "migrateLegacySessionIfNeeded");

  console.log(`[QQ][inbound] route=${route} msgId=${msgIdText} stage=record_inbound`);
  const shouldUpdateLastRoute = ctxPayload.SessionKey !== "agent:main:main";
  await withTimeout(
    runtime.channel.session.recordInboundSession({
      storePath: runtime.channel.session.resolveStorePath(cfg.session?.store, { agentId: residentAgentId }),
      sessionKey: ctxPayload.SessionKey,
      ctx: ctxPayload,
      ...(shouldUpdateLastRoute
        ? { updateLastRoute: { sessionKey: ctxPayload.SessionKey, channel: "qq", to: route, accountId: DEFAULT_ACCOUNT_ID } }
        : {}),
      onRecordError: (err: unknown) => console.error("QQ Session Error:", err),
    }),
    5000,
    "recordInboundSession",
  );

  // accountId currently preserved for future per-account store routing; keep explicit to avoid hidden globals.
  void accountId;
}

export function createTaskStatePersister(params: {
  conversationBaseDir: (route: string) => string;
  route: string;
  msgIdText: string;
  taskKind: string;
  getDispatchId: () => string;
}) {
  const { conversationBaseDir, route, msgIdText, taskKind, getDispatchId } = params;
  const taskMetaPath = `${conversationBaseDir(route)}/meta/task-state.json`;

  return async (state: "queued" | "running" | "succeeded" | "failed" | "timeout", extra?: Record<string, unknown>) => {
    try {
      await fs.mkdir(`${conversationBaseDir(route)}/meta`, { recursive: true });
      const payload = {
        route,
        msgId: msgIdText,
        dispatchId: getDispatchId() || null,
        state,
        taskKind,
        at: Date.now(),
        ...extra,
      };
      await fs.writeFile(taskMetaPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    } catch (e) {
      console.warn("[QQ][task-meta] write failed", e);
    }
  };
}
