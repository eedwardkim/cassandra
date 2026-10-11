import type { BiasReport, Capabilities, Commit, Forecast, Signature, Tick, Trade, Policy, StreamEvent } from "@cassandra/shared";

export const ENGINE = process.env.NEXT_PUBLIC_ENGINE_URL ?? "http://localhost:4000";

export interface MarketSummary {
  symbol: string; label: string; eventTicker: string; title: string; category: string; expiryDate: string | null; status: string;
  tracked: boolean; depth: number; tick: Tick | null; irrationality: number | null; edgeBps: number | null;
  topSignature: Signature | null; councilBps: number | null; forecastId: string | null; source: "live" | "fixture" | "replay";
}
export interface MarketDetail extends MarketSummary { description: string | null; ticks: Tick[]; bias: BiasReport | null; forecast: Forecast | null; commits: Commit[]; trades: Trade[] }
export interface LedgerRow extends Commit { title: string; label: string }
export interface Ledger { network: string; chainId: number; ledger: string | null; explorer: string | null; onchain: { count: number; meanBrierBps2: string | number } | null; counts: { sealed: number; revealed: number; scored: number }; commits: LedgerRow[] }
export interface PolicyState { live: boolean; policy: Policy | null; agent?: string; owner?: string; address?: string; trades: Trade[]; categories: Record<string, number>; spentTodayCents?: number }
export type { BiasReport, Capabilities, Commit, Forecast, Signature, Tick, Trade, Policy, StreamEvent };

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${ENGINE}${path}`, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) }, cache: "no-store" });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as { error?: string }).error ?? `${r.status}`);
  return body as T;
}

const REASONS: Record<string, string> = {
  "notional exceeds max per trade": "over the per-trade limit",
  "daily notional limit reached": "over the daily limit",
  "edge below policy minimum": "edge below the minimum",
  "agent paused by owner": "agent paused by the owner",
  "category not allowed": "category not allowed",
  "no policy set for agent": "no limits set",
};
export const blocked = (reason: string | null | undefined) => `Blocked by your limits: ${REASONS[reason ?? ""] ?? reason ?? "rejected"}. No order sent to Gemini.`;
export const offline = (err: string) => (process.env.NODE_ENV === "development" ? `Engine offline (${err}). Start it with pnpm dev.` : "Engine offline");
export const pct = (bps: number | null | undefined, d = 1) => (bps == null ? "—" : `${(bps / 100).toFixed(d)}%`);
export const short = (h?: string | null) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : "—");
export const usd = (cents: number | null | undefined) => (cents == null ? "—" : `$${(cents / 100).toFixed(2)}`);
export const txUrl = (explorer: string | null | undefined, hash?: string | null) => (explorer && hash ? `${explorer}${hash}` : null);
export const BSCSCAN = "https://testnet.bscscan.com/tx/";
export const BIAS_NAMES: Record<string, string> = {
  overround: "Overround", favoriteLongshot: "Favorite–longshot", roundNumberAnchoring: "Round-number anchoring",
  herding: "Herding", recencyShock: "Recency shock", wishfulThinking: "Wishful thinking", horizonNeglect: "Horizon neglect",
};
