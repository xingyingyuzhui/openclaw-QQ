export type ParsedTarget =
  | { kind: "user"; userId: number; route: string }
  | { kind: "group"; groupId: number; route: string }
  | { kind: "guild"; guildId: string; channelId: string; route: string };

const SAFE_GUILD_PART = "[A-Za-z0-9_.-]+";
const QQ_ROUTE_PATTERN = new RegExp(`^(user:\\d{5,12}|group:\\d{5,12}|guild:${SAFE_GUILD_PART}:${SAFE_GUILD_PART})$`);

let ownerQq = String(process.env.OPENCLAW_QQ_OWNER_ID || "").trim();
export const OWNER_MAIN_AGENT_ID = "main";
export const OWNER_MAIN_SESSION_KEY = `agent:${OWNER_MAIN_AGENT_ID}:main`;

export function configureOwnerQq(ownerUserId?: string): void {
  ownerQq = String(ownerUserId || "").trim();
}

export function getOwnerQq(): string {
  return ownerQq;
}

export function getOwnerRoute(): string {
  return ownerQq ? `user:${ownerQq}` : "";
}

export function normalizeTarget(raw: string): string {
  const value = String(raw || "").trim().replace(/^qq:/i, "");
  if (!value) return value;
  const v = value.toLowerCase();

  const channelPref = v.match(/^channel:(private|group):(\d{5,12})$/i);
  if (channelPref) return `${channelPref[1] === "private" ? "user" : "group"}:${channelPref[2]}`;

  const sessionPref = v.match(/^session:qq:(user|group|guild:.+)$/i);
  if (sessionPref) return sessionPref[1];

  if (/^private:\d{5,12}$/i.test(v)) return v.replace(/^private:/i, "user:");
  if (/^\d{5,12}$/.test(v)) return `user:${v}`;
  if (/^user:\d{5,12}$/i.test(v)) return v;
  if (/^group:\d{5,12}$/i.test(v)) return v;
  if (/^guild:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/i.test(v)) return v;

  return value;
}

export function parseTarget(raw: string): ParsedTarget | null {
  const target = normalizeTarget(String(raw || "").trim());
  if (/^user:\d{5,12}$/.test(target)) {
    const userId = parseInt(target.slice(5), 10);
    return { kind: "user", userId, route: `user:${userId}` };
  }
  if (/^group:\d{5,12}$/.test(target)) {
    const groupId = parseInt(target.slice(6), 10);
    return { kind: "group", groupId, route: `group:${groupId}` };
  }
  if (/^guild:[A-Za-z0-9_.-]+:[A-Za-z0-9_.-]+$/.test(target)) {
    const [, guildId, channelId] = target.split(":");
    return { kind: "guild", guildId, channelId, route: `guild:${guildId}:${channelId}` };
  }
  return null;
}

export async function resolveOutboundTarget(raw: string): Promise<ParsedTarget | null> {
  return parseTarget(raw);
}

export function isOwnerPrivateRoute(route: string): boolean {
  const ownerRoute = getOwnerRoute();
  if (!ownerRoute) return false;
  return String(route || "").trim() === ownerRoute;
}

export function isValidQQRoute(route: string): boolean {
  return QQ_ROUTE_PATTERN.test(String(route || "").trim());
}

export function routeToResidentAgentId(route: string): string {
  const normalized = String(route || "").trim();
  if (isOwnerPrivateRoute(normalized)) return OWNER_MAIN_AGENT_ID;
  const userMatch = normalized.match(/^user:(\d{5,12})$/);
  if (userMatch) return `qq-user-${userMatch[1]}`;
  const groupMatch = normalized.match(/^group:(\d{5,12})$/);
  if (groupMatch) return `qq-group-${groupMatch[1]}`;
  const guildMatch = normalized.match(/^guild:([^:]+):([^:]+)$/);
  if (guildMatch) return `qq-guild-${guildMatch[1]}-${guildMatch[2]}`;
  throw new Error(`Invalid QQ route: ${route}`);
}

export function buildResidentSessionKey(route: string): string {
  const normalized = String(route || "").trim();
  if (isOwnerPrivateRoute(normalized)) return OWNER_MAIN_SESSION_KEY;
  return `agent:${routeToResidentAgentId(normalized)}:main`;
}
