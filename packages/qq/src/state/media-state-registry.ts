export type MemberCacheEntry = { name: string; time: number };
export type RouteRecentMediaState = { urls: string[]; updatedAt: number; lastMsgId?: string };
export type RouteMediaManifest = {
  msgId: string;
  route: string;
  mediaUrls: string[];
  localUrls: string[];
  updatedAt: number;
};

const MEMBER_CACHE_TTL_MS = 60 * 60 * 1000;
const memberCache = new Map<string, MemberCacheEntry>();
const routeRecentMedia = new Map<string, RouteRecentMediaState>();
const routeMediaManifestByMsg = new Map<string, RouteMediaManifest>();
const routeLatestManifestKey = new Map<string, string>();
const routeFileTaskLockUntil = new Map<string, number>();

function manifestKey(route: string, msgId: string): string {
  return `${route}|${msgId}`;
}

export function getCachedMemberName(groupId: string, userId: string): string | null {
  const key = `${groupId}:${userId}`;
  const cached = memberCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.time > MEMBER_CACHE_TTL_MS) {
    memberCache.delete(key);
    return null;
  }
  return cached.name;
}

export function setCachedMemberName(groupId: string, userId: string, name: string): void {
  memberCache.set(`${groupId}:${userId}`, { name, time: Date.now() });
}

export function rememberRouteMediaManifest(route: string, msgId: string, mediaUrls: string[], localUrls: string[]): void {
  const key = manifestKey(route, msgId);
  const manifest: RouteMediaManifest = {
    msgId,
    route,
    mediaUrls: Array.from(new Set((mediaUrls || []).map((u) => String(u || "").trim()).filter(Boolean))),
    localUrls: Array.from(new Set((localUrls || []).map((u) => String(u || "").trim()).filter(Boolean))),
    updatedAt: Date.now(),
  };
  routeMediaManifestByMsg.set(key, manifest);
  routeLatestManifestKey.set(route, key);
}

export function getRouteMediaManifest(route: string, msgId: string, ttlMs = 10 * 60 * 1000): RouteMediaManifest | null {
  const key = manifestKey(route, msgId);
  const found = routeMediaManifestByMsg.get(key);
  if (!found) return null;
  if (Date.now() - found.updatedAt > Math.max(1000, ttlMs)) {
    routeMediaManifestByMsg.delete(key);
    return null;
  }
  return found;
}

export function getRouteLatestMediaManifest(route: string, ttlMs = 10 * 60 * 1000): RouteMediaManifest | null {
  const key = routeLatestManifestKey.get(route);
  if (!key) return null;
  const found = routeMediaManifestByMsg.get(key);
  if (!found) return null;
  if (Date.now() - found.updatedAt > Math.max(1000, ttlMs)) {
    routeMediaManifestByMsg.delete(key);
    routeLatestManifestKey.delete(route);
    return null;
  }
  return found;
}

export function rememberRouteRecentMedia(route: string, urls: string[], msgId?: string): void {
  const dedup = Array.from(new Set((urls || []).map((u) => String(u || "").trim()).filter(Boolean)));
  if (dedup.length === 0) return;
  routeRecentMedia.set(route, { urls: dedup, updatedAt: Date.now(), lastMsgId: msgId ? String(msgId) : undefined });
}

export function getRouteRecentMedia(route: string, ttlMs = 10 * 60 * 1000, maxItems = 6): string[] {
  const state = routeRecentMedia.get(route);
  if (!state) return [];
  if (Date.now() - state.updatedAt > Math.max(1000, ttlMs)) {
    routeRecentMedia.delete(route);
    return [];
  }
  return state.urls.slice(0, Math.max(1, maxItems));
}

export function lockRouteFileTask(route: string, ttlMs = 60_000): void {
  routeFileTaskLockUntil.set(route, Date.now() + Math.max(1000, ttlMs));
}

export function isRouteFileTaskLocked(route: string): boolean {
  const until = routeFileTaskLockUntil.get(route) || 0;
  if (!until) return false;
  if (Date.now() > until) {
    routeFileTaskLockUntil.delete(route);
    return false;
  }
  return true;
}
