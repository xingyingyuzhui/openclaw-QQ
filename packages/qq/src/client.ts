import WebSocket from "ws";
import EventEmitter from "events";
import type { OneBotEvent } from "./types.js";
import { createWsClientAdapter } from "./napcat/transport/ws-client-adapter.js";
import { invokeNapCat } from "./napcat/compat/invoke-napcat.js";
import type { NapCatAction, NapCatRequestMap, NapCatResponseMap, NapCatVersionPolicy } from "./napcat/contracts/index.js";
import type { NapCatRawEnvelope } from "./napcat/contracts/index.js";
import type { NapCatInvokeContext } from "./diagnostics/napcat-trace.js";

interface OneBotClientOptions {
  wsUrl: string;
  accessToken?: string;
  silent?: boolean;
  accountId?: string;
  napcatVersionPolicy?: NapCatVersionPolicy;
  napcatCapabilityProbeEnabled?: boolean;
  napcatActionTimeoutMs?: number;
  napcatActionMaxRetries?: number;
  napcatActionRetryBaseDelayMs?: number;
}

export class OneBotClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private options: OneBotClientOptions;
  private reconnectAttempts = 0;
  private maxReconnectDelay = 60000; // Max 1 minute delay
  private selfId: number | null = null;
  private isAlive = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private lastMessageAt = 0;
  private silent = false;
  private accountId = "default";
  private transport = createWsClientAdapter(this);

  constructor(options: OneBotClientOptions) {
    super();
    this.options = options;
    this.silent = Boolean(options.silent);
    this.accountId = String(options.accountId || "default").trim() || "default";
  }

  getSelfId(): number | null {
    return this.selfId;
  }

  setSelfId(id: number) {
    this.selfId = id;
  }

  private buildInvokeContext(partial?: {
    route?: string;
    requestId?: string;
    source?: "chat" | "automation" | "inbound";
    stage?: string;
    msgId?: string;
    dispatchId?: string;
    attemptId?: string;
  }): NapCatInvokeContext {
    return {
      accountId: this.accountId,
      route: String(partial?.route || "system"),
      requestId: String(partial?.requestId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
      source: partial?.source || "chat",
      stage: partial?.stage,
      msgId: partial?.msgId,
      dispatchId: partial?.dispatchId,
      attemptId: partial?.attemptId,
    };
  }

  connect() {
    this.cleanup();

    const headers: Record<string, string> = {};
    if (this.options.accessToken) {
      headers["Authorization"] = `Bearer ${this.options.accessToken}`;
    }

    try {
      this.ws = new WebSocket(this.options.wsUrl, { headers });

      this.ws.on("open", () => {
        this.isAlive = true;
        this.lastMessageAt = Date.now();
        this.reconnectAttempts = 0; // Reset counter on success
        this.emit("connect");
        if (!this.silent) console.log("[QQ] Connected to OneBot server");

        // Start heartbeat check
        this.startHeartbeat();
      });

      this.ws.on("message", (data) => {
        this.isAlive = true; // Any message from server means connection is alive
        this.lastMessageAt = Date.now();
        try {
          const payload = JSON.parse(data.toString()) as OneBotEvent;
          if (payload.post_type === "meta_event" && payload.meta_event_type === "heartbeat") {
            return;
          }
          this.emit("message", payload);
        } catch (err) {
          // Ignore non-JSON or parse errors
        }
      });

      this.ws.on("close", (code, reason) => {
        if (!this.silent) {
          const rs = Buffer.isBuffer(reason) ? reason.toString("utf8") : String(reason || "");
          console.warn(`[QQ] WebSocket closed code=${code} reason=${rs || "n/a"}`);
        }
        this.handleDisconnect();
      });

      this.ws.on("error", (err) => {
        if (!this.silent) console.error("[QQ] WebSocket error:", err);
        this.handleDisconnect();
      });
    } catch (err) {
      if (!this.silent) console.error("[QQ] Failed to initiate WebSocket connection:", err);
      this.scheduleReconnect();
    }
  }

  private cleanup() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.terminate();
      }
      this.ws = null;
    }
  }

  private startHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    // Soft/hard timeout model to reduce false reconnects when heartbeat jitter exists.
    this.heartbeatTimer = setInterval(async () => {
      const now = Date.now();
      const elapsed = now - (this.lastMessageAt || 0);
      const softTimeoutMs = 90_000;
      const hardTimeoutMs = 150_000;

      if (elapsed < softTimeoutMs) return;

      // Soft timeout: probe first, don't immediately drop socket.
      if (elapsed >= softTimeoutMs && elapsed < hardTimeoutMs) {
        try {
          await this.invokeNapCatAction("get_login_info", {}, { route: "system", source: "chat", stage: "heartbeat_probe" });
          this.isAlive = true;
          this.lastMessageAt = Date.now();
          return;
        } catch {
          // fall through; still give it until hard timeout
        }
      }

      if (elapsed >= hardTimeoutMs) {
        if (!this.silent) console.warn("[QQ] Heartbeat hard-timeout, forcing reconnect...");
        this.handleDisconnect();
      }
    }, 30_000);
  }

  private handleDisconnect() {
    this.cleanup();
    this.emit("disconnect");
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return; // Already scheduled
    
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), this.maxReconnectDelay);
    if (!this.silent) {
      console.log(`[QQ] Reconnecting in ${delay / 1000}s (Attempt ${this.reconnectAttempts + 1})...`);
    }
    
    this.reconnectTimer = setTimeout(() => {
        this.reconnectAttempts++;
        this.connect();
    }, delay);
  }

  async callActionEnvelope(action: string, params: Record<string, unknown>, timeoutMs = 5000): Promise<NapCatRawEnvelope> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not open"));
        return;
      }

      const echo = Math.random().toString(36).substring(2, 15);
      let timeoutHandle: NodeJS.Timeout | null = null;
      const handler = (data: WebSocket.RawData) => {
        try {
          const resp = JSON.parse(data.toString()) as NapCatRawEnvelope;
          if (resp.echo === echo) {
            this.ws?.off("message", handler);
            if (timeoutHandle) clearTimeout(timeoutHandle);
            resolve(resp);
          }
        } catch (err) {
          // Ignore non-JSON messages
        }
      };

      this.ws.on("message", handler);
      this.ws.send(JSON.stringify({ action, params, echo }));

      timeoutHandle = setTimeout(() => {
        this.ws?.off("message", handler);
        reject(new Error("Request timeout"));
      }, Math.max(100, Number(timeoutMs || 5000)));
    });
  }

  async invokeNapCatAction<A extends NapCatAction>(
    action: A,
    params: NapCatRequestMap[A],
    ctx?: {
      route?: string;
      requestId?: string;
      source?: "chat" | "automation" | "inbound";
      stage?: string;
      msgId?: string;
      dispatchId?: string;
      attemptId?: string;
    },
  ): Promise<NapCatResponseMap[A]> {
    const route = String(ctx?.route || (typeof (params as any)?.group_id !== "undefined"
      ? `group:${String((params as any).group_id)}`
      : typeof (params as any)?.user_id !== "undefined"
        ? `user:${String((params as any).user_id)}`
        : "system"));
    return invokeNapCat({
      transport: this.transport,
      action,
      params,
      ctx: this.buildInvokeContext({ ...ctx, route }),
      options: {
        versionPolicy: this.options.napcatVersionPolicy || "new-first-with-legacy-fallback",
        capabilityProbeEnabled: this.options.napcatCapabilityProbeEnabled !== false,
        actionTimeoutMs: Number(this.options.napcatActionTimeoutMs || 5000),
        actionMaxRetries: Number(this.options.napcatActionMaxRetries ?? 1),
        actionRetryBaseDelayMs: Number(this.options.napcatActionRetryBaseDelayMs ?? 300),
      },
    });
  }

  async waitUntilConnected(timeoutMs = 5000): Promise<boolean> {
    if (this.isConnected()) return true;
    return new Promise((resolve) => {
      let settled = false;
      const onConnect = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.off("connect", onConnect);
        resolve(true);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.off("connect", onConnect);
        resolve(this.isConnected());
      }, Math.max(100, timeoutMs));
      this.on("connect", onConnect);
      if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
        this.connect();
      }
    });
  }

  disconnect() {
    this.cleanup();
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
