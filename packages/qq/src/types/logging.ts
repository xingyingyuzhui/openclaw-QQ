export type QQLogEvent =
  | "qq_inbound_received"
  | "qq_inbound_media_resolve"
  | "qq_inbound_media_materialize"
  | "qq_dispatch_start"
  | "qq_dispatch_done"
  | "qq_dispatch_drop"
  | "qq_dispatch_timeout"
  | "qq_dispatch_error"
  | "qq_outbound_send"
  | "qq_outbound_drop"
  | "qq_outbound_retry"
  | "qq_session_migrate_start"
  | "qq_session_migrate_move"
  | "qq_session_migrate_done"
  | "qq_proactive_tick"
  | "qq_proactive_skip"
  | "qq_proactive_send"
  | "qq_proactive_state";

export type QQErrorCode =
  | "resolve_action_failed"
  | "materialize_http_failed"
  | "materialize_empty_payload"
  | "migration_io_failed"
  | "group_member_lookup_failed"
  | "unknown_error";

export type QQLogTrace = {
  event: QQLogEvent;
  route: string;
  agent_id?: string;
  session_key?: string;
  msg_id?: string;
  dispatch_id?: string;
  attempt_id?: string;
  source?: "chat" | "automation" | "inbound";
  resolve_stage?: string;
  resolve_action?: string;
  resolve_result?: string;
  materialize_result?: string;
  materialize_error_code?: string;
  drop_reason?: string;
  fallback_stage?: string;
  retry_count?: number;
  duration_ms?: number;
  http_status?: number;
  error?: string;
  account_id?: string;
  workspace_root?: string;
  [k: string]: unknown;
};
