import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createClient, HmacAuth } from "@gemini-markets/sdk/server";
import type { Category, Source } from "@cassandra/shared";
import { config } from "../config.js";
import { log } from "../bus.js";

export type GeminiClient = Awaited<ReturnType<typeof createClient>>;
type RawEvent = NonNullable<Awaited<ReturnType<GeminiClient["predictions"]["listEvents"]>>["data"]>[number];
type RawContract = NonNullable<RawEvent["contracts"]>[number];

export interface DiscoveredContract {
  symbol: string; eventTicker: string; label: string; category: Category; expiryDate: string | null; status: string;
  resolutionSide: string | null; resolvedAt: string | null; quote: Quote | null;
}
export interface DiscoveredEvent {
  ticker: string; title: string; description: string | null; category: Category; rawCategory: string; status: string;
  volume: number; expiryDate: string | null; exclusive: boolean; contracts: DiscoveredContract[];
}
export interface Quote { symbol: string; bidBps: number | null; askBps: number | null; noAskBps: number | null; midBps: number; lastBps: number | null; volume: number | null; ts: number; source: Source }

const FIXTURES = join(config.fixturesDir, "gemini");
export const geminiSource: Source = config.gemini.dryRun ? "fixture" : "live";

/** Decimal string → integer basis points. The only place price strings are parsed. */
export const toBps = (s: string | null | undefined): number | null => {
  if (s == null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 10000) : null;
};
export const fromBps = (bps: number) => (bps / 10000).toFixed(2);

export function mapCategory(raw: string | undefined, title = ""): Category {
  const s = `${raw ?? ""} ${title}`.toLowerCase();
  if (/politic|election|senate|house|president|midterm/.test(s)) return "politics";
  if (/sport|nfl|nba|mlb|nhl|soccer|football|tennis|ufc/.test(s)) return "sports";
  if (/crypto|btc|eth|sol|bitcoin|ether/.test(s)) return "crypto";
  if (/econ|fed|cpi|rate|inflation|gdp|jobs/.test(s)) return "economics";
  if (/commod|gold|oil|silver|wti/.test(s)) return "commodities";
  if (/weather|temperature|hurricane/.test(s)) return "weather";
  if (/culture|entertain|movie|music|award/.test(s)) return "culture";
  return "other";
}

function quoteFromPrices(symbol: string, k: RawContract, ts: number): Quote | null {
  const p = k.prices;
  if (!p) return null;
  const bid = toBps(p.bestBid), ask = toBps(p.bestAsk), last = toBps(p.lastTradePrice);
  const noAsk = toBps(p.buy?.no);
  const mid = bid != null && ask != null ? Math.round((bid + ask) / 2) : last ?? null;
  if (mid == null) return null;
  return { symbol, bidBps: bid, askBps: ask, noAskBps: noAsk, midBps: mid, lastBps: last, volume: null, ts, source: geminiSource };
}

/** Strike-ladder legs ("$1.40 or above") nest inside each other, so their YES prices legitimately sum past 100%. */
export const isLadderLeg = (symbol: string, label: string) => /-(HI|LO)[0-9]/.test(symbol) || /or (above|below|higher|lower)|above|below/i.test(label);

function mapEvent(e: RawEvent, ts: number): DiscoveredEvent {
  const category = mapCategory(e.category, e.title);
  const contracts = (e.contracts ?? []).filter((k) => k.instrumentSymbol).map((k) => ({
    symbol: k.instrumentSymbol!, eventTicker: e.ticker ?? "", label: k.label ?? k.instrumentSymbol!, category,
    expiryDate: k.expiryDate ?? e.expiryDate ?? null, status: String(k.status ?? e.status ?? "active"),
    resolutionSide: (k.resolutionSide as string | undefined) ?? null, resolvedAt: k.resolvedAt ?? null,
    quote: quoteFromPrices(k.instrumentSymbol!, k, ts),
  }));
  return {
    ticker: e.ticker ?? "", title: e.title ?? e.ticker ?? "", description: e.description ?? null, category, rawCategory: e.category ?? "",
    status: String(e.status ?? "active"), volume: Number(e.volume ?? 0) || 0, expiryDate: e.expiryDate ?? null,
    // Strike ladders ("BTC above X") are nested, not mutually exclusive; categorical events are.
    exclusive: String(e.type ?? "").toLowerCase() === "categorical" && !contracts.some((k) => isLadderLeg(k.symbol, k.label)), contracts,
  };
}

export const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x), 2);
function readFixture<T>(name: string): T {
  const f = join(FIXTURES, `${name}.json`);
  if (!existsSync(f)) throw new Error(`fixture ${name} missing; run pnpm capture with live keys`);
  return JSON.parse(readFileSync(f, "utf8")) as T;
}
export function writeFixture(name: string, data: unknown) {
  mkdirSync(FIXTURES, { recursive: true });
  writeFileSync(join(FIXTURES, `${name}.json`), json(data));
}

import { client } from "../gateway.js";
export { client };

export async function rawActiveEvents(): Promise<RawEvent[]> {
  if (config.gemini.dryRun) return readFixture<RawEvent[]>("events");
  const c = await client();
  const out: RawEvent[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const r = await c.predictions.listEvents({ status: ["active"], limit: 100, offset });
    out.push(...(r.data ?? []));
    if ((r.data ?? []).length < 100) break;
  }
  return out;
}

export async function discover(): Promise<DiscoveredEvent[]> {
  const ts = Date.now();
  return (await rawActiveEvents()).map((e) => mapEvent(e, ts));
}

export async function contractsOf(eventTicker: string): Promise<DiscoveredEvent> {
  if (config.gemini.dryRun) {
    const e = readFixture<RawEvent[]>("events").find((x) => x.ticker === eventTicker);
    if (!e) throw new Error(`event ${eventTicker} not in fixtures`);
    return mapEvent(e, Date.now());
  }
  const c = await client();
  return mapEvent((await c.predictions.getEvent({ eventTicker })) as RawEvent, Date.now());
}

type Book = { bids: { price: string; amount: string }[]; asks: { price: string; amount: string }[] };
/** Best bid/ask from the order book; the YES book's bid implies the NO ask (1 − bid). */
export async function quote(symbol: string): Promise<Quote | null> {
  const ts = Date.now();
  let book: Book;
  if (config.gemini.dryRun) {
    const all = readFixture<Record<string, Book>>("books");
    if (!all[symbol]) return null;
    book = all[symbol]!;
  } else {
    const c = await client();
    book = (await c.marketData.getCurrentOrderBook({ symbol })) as unknown as Book;
  }
  const bid = book.bids.length ? Math.max(...book.bids.map((b) => toBps(b.price) ?? 0)) : null;
  const ask = book.asks.length ? Math.min(...book.asks.map((a) => toBps(a.price) ?? 10000)) : null;
  if (bid == null && ask == null) return null;
  const mid = bid != null && ask != null ? Math.round((bid + ask) / 2) : (bid ?? ask)!;
  const depth = [...book.bids, ...book.asks].reduce((s, l) => s + Number(l.amount) * Number(l.price), 0);
  return { symbol, bidBps: bid, askBps: ask, noAskBps: bid != null ? 10000 - bid : null, midBps: mid, lastBps: null, volume: Math.round(depth * 100) / 100, ts, source: geminiSource };
}

export interface BookLevel { priceBps: number; amount: number }
/** Top levels of the YES book, best first; read-only market data. */
export async function bookOf(symbol: string, levels = 12): Promise<{ symbol: string; ts: number; source: string; bids: BookLevel[]; asks: BookLevel[] } | null> {
  let book: Book;
  if (config.gemini.dryRun) {
    const all = readFixture<Record<string, Book>>("books");
    if (!all[symbol]) return null;
    book = all[symbol]!;
  } else {
    book = (await (await client()).marketData.getCurrentOrderBook({ symbol })) as unknown as Book;
  }
  const lv = (ls: Book["bids"]) => ls.map((l) => ({ priceBps: toBps(l.price) ?? -1, amount: Number(l.amount) })).filter((l) => l.priceBps >= 0 && l.amount > 0);
  return {
    symbol, ts: Date.now(), source: geminiSource,
    bids: lv(book.bids).sort((a, b) => b.priceBps - a.priceBps).slice(0, levels),
    asks: lv(book.asks).sort((a, b) => a.priceBps - b.priceBps).slice(0, levels),
  };
}

export async function rawBook(symbol: string): Promise<Book> {
  return (await (await client()).marketData.getCurrentOrderBook({ symbol })) as unknown as Book;
}
export async function rawSettled(): Promise<RawEvent[]> {
  return ((await (await client()).predictions.listRecentlySettledEvents({ limit: 100 })).data ?? []) as RawEvent[];
}

export async function books(symbols: string[]): Promise<Record<string, Book>> {
  const c = await client();
  const out: Record<string, Book> = {};
  for (const s of symbols) out[s] = (await c.marketData.getCurrentOrderBook({ symbol: s })) as unknown as Book;
  return out;
}

export async function settled(since: number): Promise<DiscoveredEvent[]> {
  const raw = config.gemini.dryRun
    ? readFixture<RawEvent[]>("settled")
    : ((await (await client()).predictions.listRecentlySettledEvents({ limit: 100 })).data ?? []) as RawEvent[];
  return raw.filter((e) => !e.resolvedAt || Date.parse(e.resolvedAt) >= since).map((e) => mapEvent(e, Date.now()));
}

export interface PlacedOrder { orderId: string; status: string; filledQuantity: string; clientOrderId: string; raw: unknown }

export async function orderHistory(symbol?: string): Promise<{ orderId: string; clientOrderId?: string; status: string; filledQuantity?: string }[]> {
  if (config.gemini.dryRun) return [];
  const c = await client();
  const r = await c.predictions.getOrderHistory({ account: config.gemini.account, ...(symbol ? { symbol } : {}) } as never);
  const rows = (Array.isArray(r) ? r : ((r as { data?: unknown[] }).data ?? [])) as Record<string, unknown>[];
  return rows.map((o) => ({ orderId: String(o.orderId), clientOrderId: o.clientOrderId as string | undefined, status: String(o.status), filledQuantity: o.filledQuantity as string | undefined }));
}

export async function positions(): Promise<unknown[]> {
  if (config.gemini.dryRun) return [];
  const c = await client();
  try {
    const r = await c.predictions.getPositions({ account: config.gemini.account } as never);
    return JSON.parse(json(Array.isArray(r) ? r : ((r as { data?: unknown[] }).data ?? [])));
  } catch (err) {
    log("warn", `positions unavailable: ${(err as Error).message}`);
    return [];
  }
}
