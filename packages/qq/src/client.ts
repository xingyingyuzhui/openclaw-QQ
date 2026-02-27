import WebSocket from "ws";
import EventEmitter from "events";
import type { OneBotEvent, OneBotMessage } from "./types.js";

interface OneBotClientOptions {
  wsUrl: string;
  accessToken?: string;
  silent?: boolean;
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

  constructor(options: OneBotClientOptions) {
    super();
    this.options = options;
    this.silent = Boolean(options.silent);
  }

  getSelfId(): number | null {
    return this.selfId;
  }

  setSelfId(id: number) {
    this.selfId = id;
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
          await this.getLoginInfo();
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

  sendPrivateMsg(userId: number, message: OneBotMessage | string) {
    this.send("send_private_msg", { user_id: userId, message });
  }

  async sendPrivateMsgWithResponse(userId: number, message: OneBotMessage | string): Promise<any> {
    return this.sendWithResponse("send_private_msg", { user_id: userId, message });
  }

  sendGroupMsg(groupId: number, message: OneBotMessage | string) {
    this.send("send_group_msg", { group_id: groupId, message });
  }

  async sendGroupMsgWithResponse(groupId: number, message: OneBotMessage | string): Promise<any> {
    return this.sendWithResponse("send_group_msg", { group_id: groupId, message });
  }

  deleteMsg(messageId: number | string) {
    this.send("delete_msg", { message_id: messageId });
  }

  setGroupAddRequest(flag: string, subType: string, approve: boolean = true, reason: string = "") {
    this.send("set_group_add_request", { flag, sub_type: subType, approve, reason });
  }

  setFriendAddRequest(flag: string, approve: boolean = true, remark: string = "") {
    this.send("set_friend_add_request", { flag, approve, remark });
  }

  async getLoginInfo(): Promise<any> {
    return this.sendWithResponse("get_login_info", {});
  }

  async getMsg(messageId: number | string): Promise<any> {
    return this.sendWithResponse("get_msg", { message_id: messageId });
  }

  // Note: get_group_msg_history is extended API supported by go-cqhttp/napcat
  async getGroupMsgHistory(groupId: number): Promise<any> {
    return this.sendWithResponse("get_group_msg_history", { group_id: groupId });
  }

  async getForwardMsg(id: string): Promise<any> {
    return this.sendWithResponse("get_forward_msg", { id });
  }

  async getFriendList(): Promise<any[]> {
    return this.sendWithResponse("get_friend_list", {});
  }

  async getGroupList(): Promise<any[]> {
    return this.sendWithResponse("get_group_list", {});
  }

  async canSendRecord(): Promise<boolean> {
    try {
      const data = await this.sendWithResponse("can_send_record", {});
      return Boolean(data?.yes);
    } catch {
      return false;
    }
  }

  async canSendImage(): Promise<boolean> {
    try {
      const data = await this.sendWithResponse("can_send_image", {});
      return Boolean(data?.yes);
    } catch {
      // Some NapCat builds do not expose can_send_image; do not hard-fail image sends.
      return true;
    }
  }

  async sendAction(action: string, params: Record<string, any>): Promise<any> {
    return this.sendWithResponse(action, params || {});
  }

  // --- Guild (Channel) Extension APIs ---
  sendGuildChannelMsg(guildId: string, channelId: string, message: OneBotMessage | string) {
    this.send("send_guild_channel_msg", { guild_id: guildId, channel_id: channelId, message });
  }

  async sendGuildChannelMsgWithResponse(guildId: string, channelId: string, message: OneBotMessage | string): Promise<any> {
    return this.sendWithResponse("send_guild_channel_msg", { guild_id: guildId, channel_id: channelId, message });
  }

  async getGuildList(): Promise<any[]> {
    // Note: API name varies by implementation (get_guild_list vs get_guilds)
    // We try the most common one for extended OneBot
    try {
        return await this.sendWithResponse("get_guild_list", {});
    } catch {
        return [];
    }
  }

  async getGuildServiceProfile(): Promise<any> {
      try { return await this.sendWithResponse("get_guild_service_profile", {}); } catch { return null; }
  }

  sendGroupPoke(groupId: number, userId: number) {
      this.send("group_poke", { group_id: groupId, user_id: userId });
      // Note: Some implementations use send_poke or touch
      // Standard OneBot v11 doesn't enforce poke API, but group_poke is common in go-cqhttp
  }

  async setInputStatus(userId: number | string, eventType: number): Promise<any> {
    return this.sendWithResponse("set_input_status", {
      user_id: String(userId),
      event_type: Number(eventType),
    });
  }
  // --------------------------------------

  setGroupBan(groupId: number, userId: number, duration: number = 1800) {
    this.send("set_group_ban", { group_id: groupId, user_id: userId, duration });
  }

  setGroupKick(groupId: number, userId: number, rejectAddRequest: boolean = false) {
    this.send("set_group_kick", { group_id: groupId, user_id: userId, reject_add_request: rejectAddRequest });
  }

  private sendWithResponse(action: string, params: any): Promise<any> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState !== WebSocket.OPEN) {
        reject(new Error("WebSocket not open"));
        return;
      }

      const echo = Math.random().toString(36).substring(2, 15);
      const handler = (data: WebSocket.RawData) => {
        try {
          const resp = JSON.parse(data.toString());
          if (resp.echo === echo) {
            this.ws?.off("message", handler);
            if (resp.status === "ok") {
              resolve(resp.data);
            } else {
              const target = params?.group_id ?? params?.user_id ?? (params?.guild_id && params?.channel_id ? `${params.guild_id}:${params.channel_id}` : "unknown");
              reject(new Error(`[${action}] failed target=${target} msg=${resp.msg || "API request failed"}`));
            }
          }
        } catch (err) {
          // Ignore non-JSON messages
        }
      };

      this.ws.on("message", handler);
      this.ws.send(JSON.stringify({ action, params, echo }));

      // Timeout after 5 seconds
      setTimeout(() => {
        this.ws?.off("message", handler);
        reject(new Error("Request timeout"));
      }, 5000);
    });
  }

  private send(action: string, params: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action, params }));
    } else {
      if (!this.silent) console.warn("[QQ] Cannot send message, WebSocket not open");
    }
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
