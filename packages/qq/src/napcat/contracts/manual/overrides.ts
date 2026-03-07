import type { OneBotMessage } from "../../../types.js";

export type NapCatRawEnvelope<T = unknown> = {
  status?: "ok" | "failed" | string;
  retcode?: number;
  data?: T;
  message?: string;
  msg?: string;
  wording?: string;
  echo?: string;
  [k: string]: unknown;
};

export type OneBotMessageMixType = OneBotMessage | string;

export interface NapCatManualRequestMap {
  // Compatibility-only old action (fallback target)
  clean_stream_temp: Record<string, unknown>;

  send_private_msg: { user_id: number | string; message: OneBotMessageMixType };
  send_group_msg: { group_id: number | string; message: OneBotMessageMixType };
  send_guild_channel_msg: { guild_id: string; channel_id: string; message: OneBotMessageMixType };
  delete_msg: { message_id: number | string };
  set_group_add_request: { flag: string; sub_type: string; approve?: boolean; reason?: string };
  set_friend_add_request: { flag: string; approve?: boolean; remark?: string };
  get_login_info: Record<string, never>;
  get_msg: { message_id: number | string };
  get_group_msg_history: { group_id: number | string };
  get_forward_msg: { id: string };
  get_friend_list: Record<string, never>;
  get_group_list: Record<string, never>;
  can_send_record: Record<string, never>;
  can_send_image: Record<string, never>;
  group_poke: { group_id: number | string; user_id: number | string };
  set_input_status: { user_id: string | number; event_type: number };
  set_group_ban: { group_id: number | string; user_id: number | string; duration?: number };
  set_group_kick: { group_id: number | string; user_id: number | string; reject_add_request?: boolean };
  get_guild_list: Record<string, never>;
  get_guild_service_profile: Record<string, never>;

  get_image: { file?: string; file_id?: string };
  get_record: { file?: string; file_id?: string; out_format?: string };
  get_file: { file?: string; file_id?: string };
  get_group_file_url: { group_id: number | string; file_id?: string; id?: string; busid?: number | string };
  get_private_file_url: { file?: string; file_id?: string };
  download_file: { file?: string; file_id?: string };
  download_file_stream: { file?: string; file_id?: string; chunk_size?: number };
  download_file_image_stream: { file?: string; file_id?: string; chunk_size?: number };
  download_file_record_stream: { file?: string; file_id?: string; chunk_size?: number };
  upload_file_stream: {
    stream_id?: string;
    file?: string;
    path?: string;
    file_path?: string;
    chunk_data?: string;
    chunk_index?: number;
    total_chunks?: number;
    file_size?: number;
    expected_sha256?: string;
    is_complete?: boolean;
    filename?: string;
    reset?: boolean;
    verify_only?: boolean;
    file_retention?: number;
  };
  clean_stream_temp_file: Record<string, unknown>;
}

export interface NapCatManualResponseMap {
  clean_stream_temp: { message?: string } | null;

  send_private_msg: { message_id?: number | string; [k: string]: unknown };
  send_group_msg: { message_id?: number | string; [k: string]: unknown };
  send_guild_channel_msg: { message_id?: number | string; [k: string]: unknown };
  delete_msg: { [k: string]: unknown } | null;
  set_group_add_request: { [k: string]: unknown } | null;
  set_friend_add_request: { [k: string]: unknown } | null;
  get_login_info: { user_id?: number | string; nickname?: string; [k: string]: unknown };
  get_msg: { message_id?: number | string; message?: unknown; raw_message?: string; [k: string]: unknown };
  get_group_msg_history: { messages?: unknown[]; [k: string]: unknown } | unknown[];
  get_forward_msg: { messages?: unknown[]; [k: string]: unknown };
  get_friend_list: Array<Record<string, unknown>>;
  get_group_list: Array<Record<string, unknown>>;
  can_send_record: { yes?: boolean; [k: string]: unknown };
  can_send_image: { yes?: boolean; [k: string]: unknown };
  group_poke: { [k: string]: unknown } | null;
  set_input_status: { [k: string]: unknown } | null;
  set_group_ban: { [k: string]: unknown } | null;
  set_group_kick: { [k: string]: unknown } | null;
  get_guild_list: Array<Record<string, unknown>>;
  get_guild_service_profile: Record<string, unknown> | null;

  get_image: { file?: string; url?: string; file_size?: string | number; file_name?: string; base64?: string; [k: string]: unknown };
  get_record: { file?: string; url?: string; file_size?: string | number; file_name?: string; base64?: string; [k: string]: unknown };
  get_file: { file?: string; path?: string; url?: string; file_size?: string | number; file_name?: string; base64?: string; [k: string]: unknown };
  get_group_file_url: { url?: string; file?: string; [k: string]: unknown };
  get_private_file_url: { url?: string; file?: string; [k: string]: unknown };
  download_file: { file?: string; path?: string; url?: string; [k: string]: unknown };
  download_file_stream: { type?: string; stream_id?: string; file_name?: string; file_size?: number; [k: string]: unknown };
  download_file_image_stream: { type?: string; stream_id?: string; file_name?: string; file_size?: number; [k: string]: unknown };
  download_file_record_stream: { type?: string; stream_id?: string; file_name?: string; file_size?: number; [k: string]: unknown };
  upload_file_stream: { type?: string; stream_id?: string; status?: string; file?: string; path?: string; url?: string; [k: string]: unknown };
  clean_stream_temp_file: { message?: string; [k: string]: unknown } | null;
}
