export type AggregationResult = { text: string; mediaUrls: string[] };
export type AggregationStats = {
  mediaItemsTotal: number;
  mediaItemsMaterialized: number;
  mediaItemsUnresolved: number;
  unresolvedReasons: string[];
};

type RouteAggregationState = {
  seq: number;
  texts: string[];
  mediaUrls: string[];
  mediaItemsTotal: number;
  mediaItemsMaterialized: number;
  mediaItemsUnresolved: number;
  unresolvedReasons: string[];
};

const routeAggregation = new Map<string, RouteAggregationState>();
const routeGeneration = new Map<string, number>();

export function pushRouteAggregation(route: string, text: string, mediaUrls: string[], stats?: Partial<AggregationStats>) {
  const state = routeAggregation.get(route) || {
    seq: 0,
    texts: [],
    mediaUrls: [],
    mediaItemsTotal: 0,
    mediaItemsMaterialized: 0,
    mediaItemsUnresolved: 0,
    unresolvedReasons: [],
  };
  state.seq += 1;
  if (String(text || "").trim()) state.texts.push(String(text).trim());
  if (Array.isArray(mediaUrls) && mediaUrls.length > 0) state.mediaUrls.push(...mediaUrls);
  state.mediaItemsTotal += Math.max(0, Number(stats?.mediaItemsTotal ?? 0));
  state.mediaItemsMaterialized += Math.max(0, Number(stats?.mediaItemsMaterialized ?? 0));
  state.mediaItemsUnresolved += Math.max(0, Number(stats?.mediaItemsUnresolved ?? 0));
  if (Array.isArray(stats?.unresolvedReasons) && stats!.unresolvedReasons!.length > 0) {
    state.unresolvedReasons.push(...stats!.unresolvedReasons!.filter(Boolean).map((it) => String(it)));
  }
  routeAggregation.set(route, state);
  return state.seq;
}

export function finalizeRouteAggregation(route: string): AggregationResult & AggregationStats {
  const state = routeAggregation.get(route);
  if (!state) {
    return {
      text: "",
      mediaUrls: [],
      mediaItemsTotal: 0,
      mediaItemsMaterialized: 0,
      mediaItemsUnresolved: 0,
      unresolvedReasons: [],
    };
  }
  const text = state.texts.join("\n").trim();
  const mediaUrls = Array.from(new Set(state.mediaUrls.filter(Boolean)));
  routeAggregation.delete(route);
  return {
    text,
    mediaUrls,
    mediaItemsTotal: state.mediaItemsTotal,
    mediaItemsMaterialized: state.mediaItemsMaterialized,
    mediaItemsUnresolved: state.mediaItemsUnresolved,
    unresolvedReasons: Array.from(new Set(state.unresolvedReasons.filter(Boolean))),
  };
}

export function getRouteAggregationSeq(route: string): number | null {
  const state = routeAggregation.get(route);
  return state ? state.seq : null;
}

export function nextRouteGeneration(route: string): number {
  const n = (routeGeneration.get(route) || 0) + 1;
  routeGeneration.set(route, n);
  return n;
}

export function isRouteGenerationCurrent(route: string, generation: number): boolean {
  return (routeGeneration.get(route) || 0) === generation;
}
