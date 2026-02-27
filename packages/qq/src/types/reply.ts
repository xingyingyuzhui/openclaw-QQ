import type { ReplyPayload } from "openclaw/plugin-sdk";
import type { MediaItem } from "./media.js";

export type NormalizedReplyPayload = {
  textChunks: string[];
  mediaItems: MediaItem[];
};

export type QQReplyPayload = ReplyPayload & {
  mediaUrl?: string;
  mediaUrls?: string[];
  files?: Array<{ url?: string; name?: string }>;
};

export type DeliveryAttemptPhase = "prepared" | "queued" | "sending" | "sent" | "dropped" | "failed";

export type DeliveryDropReason =
  | "dispatch_aborted"
  | "dispatch_id_mismatch"
  | "abort_text_suppressed"
  | "duplicate_text_suppressed"
  | "policy_blocked"
  | "quota_exceeded"
  | "automation_meta_leak_guard"
  | "dispatch_timeout"
  | "transport_unavailable"
  | "unknown_error";

export type DeliveryAttemptTrace = {
  route: string;
  msgId: string;
  dispatchId: string;
  attemptId: string;
  phase: DeliveryAttemptPhase;
  result?: "ok" | "failed" | "dropped";
  dropReason?: DeliveryDropReason;
  error?: string;
  retryIndex?: number;
  action?: string;
};
