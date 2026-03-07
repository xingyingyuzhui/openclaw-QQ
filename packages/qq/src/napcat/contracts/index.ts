import type { NapCatGeneratedAction } from "./generated/actions.js";
import type { NapCatGeneratedRequestMap, NapCatGeneratedResponseMap } from "./generated/maps.js";
import type { NapCatManualRequestMap, NapCatManualResponseMap, NapCatRawEnvelope } from "./manual/overrides.js";

export type { NapCatRawEnvelope };

export type NapCatRequestMap = Omit<NapCatGeneratedRequestMap, keyof NapCatManualRequestMap> & NapCatManualRequestMap;

export type NapCatResponseMap = Omit<NapCatGeneratedResponseMap, keyof NapCatManualResponseMap> & NapCatManualResponseMap;

export type NapCatAction = NapCatGeneratedAction | keyof NapCatManualRequestMap;

export type NapCatVersionPolicy = "new-first-with-legacy-fallback" | "legacy-first" | "strict-new";
