export type MediaKind = "image" | "record" | "video" | "file";

export type MediaItem = {
  source: string;
  name?: string;
  kindHint?: MediaKind;
  replyToId?: string;
};

export type ResolvedMediaCandidate = {
  value: string;
  candidateType: "stream" | "http" | "base64" | "data" | "unknown";
  fallbackStage: "stream" | "http" | "http-base64" | "local-base64";
};

export type MediaSendTrace = {
  route: string;
  media_source: string;
  media_kind: MediaKind;
  resolved_realpath?: string;
  candidate_type?: string;
  deny_reason?: string;
  fallback_stage?: string;
  error?: string;
};

export type InboundMediaResolveTrace = {
  route: string;
  msg_id?: string;
  segment_type: "image" | "video" | "record" | "file";
  dispatch_id?: string;
  resolve_action?: string;
  resolve_stage: "collect" | "resolve" | "fallback_get_msg" | "materialize";
  resolve_result: "ok" | "failed";
  retry_count?: number;
  materialize_result?: "materialized" | "unresolved";
  materialize_error_code?: string;
  http_status?: number;
  error?: string;
};

export type InboundMediaRef = {
  route: string;
  messageId?: string;
  segmentType: "image" | "video" | "record" | "file";
  segmentIndex: number;
  file?: string;
  file_id?: string;
  url?: string;
  path?: string;
  name?: string;
  busid?: string | number;
  data?: Record<string, any>;
};

export type InboundResolveResult = {
  ref: InboundMediaRef;
  candidates: string[];
  resolvedSource?: string;
  resolveAction: string;
  resolveResult: "ok" | "failed";
  errorCode?: string;
};

export type RouteInFlightState = {
  route: string;
  dispatchId: string;
  msgId: string;
  startedAt: number;
  abortController: AbortController;
};

export type MaterializeResult = {
  url: string;
  outputUrl?: string;
  materialized: boolean;
  errorCode?: string;
  httpStatus?: number;
  retryCount?: number;
  error?: string;
  originalFilename?: string;
  finalFilename?: string;
  nameSource?: "hint" | "url" | "download" | "fallback";
  extSource?: "original" | "url" | "buffer" | "fallback";
};
