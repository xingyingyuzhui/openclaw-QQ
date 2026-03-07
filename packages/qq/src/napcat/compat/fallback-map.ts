import type { NapCatAction } from "../contracts/index.js";

const FALLBACK_MAP: Record<string, string[]> = {
  clean_stream_temp_file: ["clean_stream_temp"],
};

export function getFallbackActions(action: NapCatAction | string): string[] {
  return FALLBACK_MAP[String(action)] || [];
}

export function hasFallbackActions(action: NapCatAction | string): boolean {
  return getFallbackActions(action).length > 0;
}
