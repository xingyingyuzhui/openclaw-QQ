import path from "node:path";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk";
import { OneBotClient } from "../client.js";

const FALLBACK_WORKSPACE =
  process.env.OPENCLAW_WORKSPACE || path.join(process.env.HOME || "", ".openclaw", "workspace");

const clients = new Map<string, OneBotClient>();
const cleanupIntervals = new Map<string, NodeJS.Timeout>();
const accountWorkspaceRoots = new Map<string, string>();

export function setClientForAccount(accountId: string, client: OneBotClient): void {
  clients.set(accountId, client);
}

export function getClientForAccount(accountId: string): OneBotClient | undefined {
  return clients.get(accountId);
}

export function deleteClientForAccount(accountId: string): void {
  clients.delete(accountId);
}

export function setCleanupIntervalForAccount(accountId: string, timer: NodeJS.Timeout): void {
  cleanupIntervals.set(accountId, timer);
}

export function clearCleanupIntervalForAccount(accountId: string): void {
  const timer = cleanupIntervals.get(accountId);
  if (!timer) return;
  try {
    clearInterval(timer);
  } catch {}
  cleanupIntervals.delete(accountId);
}

export function resolveWorkspaceRootFromConfig(cfg: any): string {
  const fromCfg = cfg?.agents?.defaults?.workspace;
  if (typeof fromCfg === "string" && fromCfg.trim()) return fromCfg.trim();
  return FALLBACK_WORKSPACE;
}

export function bindAccountWorkspaceRoot(accountId: string, cfg: any): string {
  const root = resolveWorkspaceRootFromConfig(cfg);
  accountWorkspaceRoots.set(String(accountId || DEFAULT_ACCOUNT_ID), root);
  return root;
}

export function resolveAccountWorkspaceRoot(accountId?: string): string {
  const key = String(accountId || DEFAULT_ACCOUNT_ID).trim() || DEFAULT_ACCOUNT_ID;
  return accountWorkspaceRoots.get(key) || FALLBACK_WORKSPACE;
}

export function clearAccountWorkspaceRoot(accountId: string): void {
  accountWorkspaceRoots.delete(accountId);
}
