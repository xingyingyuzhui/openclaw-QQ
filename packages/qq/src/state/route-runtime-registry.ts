const routeLastInboundAt = new Map<string, number>();
const routeLastProactiveAt = new Map<string, number>();
const proactiveStateHydrated = new Set<string>();
const routeRecentOutboundText = new Map<string, { text: string; at: number }>();
const routeInboundSeq = new Map<string, number>();
const routeLastFallbackAt = new Map<string, number>();

function routeStateKey(accountId: string, route: string): string {
  return `${accountId}|${route}`;
}

function normalizeOutboundDedupText(text: string): string {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function nextRouteInboundSeq(route: string): number {
  const v = (routeInboundSeq.get(route) || 0) + 1;
  routeInboundSeq.set(route, v);
  return v;
}

export function getRouteInboundSeq(route: string): number {
  return routeInboundSeq.get(route) || 0;
}

export function getRouteLastInboundAt(accountId: string, route: string): number {
  return routeLastInboundAt.get(routeStateKey(accountId, route)) || 0;
}

export function getRouteLastProactiveAt(accountId: string, route: string): number {
  return routeLastProactiveAt.get(routeStateKey(accountId, route)) || 0;
}

export function setRouteLastInboundAt(accountId: string, route: string, ts: number): void {
  routeLastInboundAt.set(routeStateKey(accountId, route), ts);
}

export function setRouteLastProactiveAt(accountId: string, route: string, ts: number): void {
  routeLastProactiveAt.set(routeStateKey(accountId, route), ts);
}

export function isProactiveStateHydrated(accountId: string, route: string): boolean {
  return proactiveStateHydrated.has(routeStateKey(accountId, route));
}

export function markProactiveStateHydrated(accountId: string, route: string): void {
  proactiveStateHydrated.add(routeStateKey(accountId, route));
}

export function clearAccountRouteRuntime(accountId: string): void {
  const prefix = `${accountId}|`;
  for (const key of Array.from(routeLastInboundAt.keys())) {
    if (key.startsWith(prefix)) routeLastInboundAt.delete(key);
  }
  for (const key of Array.from(routeLastProactiveAt.keys())) {
    if (key.startsWith(prefix)) routeLastProactiveAt.delete(key);
  }
  for (const key of Array.from(proactiveStateHydrated.values())) {
    if (key.startsWith(prefix)) proactiveStateHydrated.delete(key);
  }
}

export function shouldSuppressDuplicateOutboundText(route: string, chunk: string, dedupWindowMs: number): boolean {
  const normalized = normalizeOutboundDedupText(chunk);
  if (!normalized) return false;
  const now = Date.now();
  const prev = routeRecentOutboundText.get(route);
  if (!prev) return false;
  if (now - prev.at > Math.max(500, dedupWindowMs)) return false;
  return prev.text === normalized;
}

export function rememberRouteOutboundText(route: string, chunk: string): void {
  const normalized = normalizeOutboundDedupText(chunk);
  if (!normalized) return;
  routeRecentOutboundText.set(route, { text: normalized, at: Date.now() });
}

export function canSendRouteFallback(route: string, cooldownMs: number): boolean {
  const now = Date.now();
  const last = routeLastFallbackAt.get(route) || 0;
  return now - last >= Math.max(1000, cooldownMs);
}

export function markRouteFallbackSent(route: string): void {
  routeLastFallbackAt.set(route, Date.now());
}
