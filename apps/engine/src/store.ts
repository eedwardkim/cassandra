import { and, desc, eq, gte, lt } from "drizzle-orm";
import type { BiasReport, Commit, Forecast, Tick, Trade, Category } from "@cassandra/shared";
import { CATEGORY_BITS } from "@cassandra/shared";
import { db, schema } from "./db/index.js";

const { ticks, biasReports, forecasts, commits, trades, contracts, events, indexHistory } = schema;
type CommitRow = typeof commits.$inferSelect;
type TradeRow = typeof trades.$inferSelect;

export const toTick = (r: typeof ticks.$inferSelect): Tick => ({
  symbol: r.symbol, ts: r.ts, bidBps: r.bidBps, askBps: r.askBps, noAskBps: r.noAskBps, midBps: r.midBps, lastBps: r.lastBps, volume: r.volume, source: r.source as Tick["source"],
});
export const toCommit = (r: CommitRow): Commit => ({
  id: String(r.id), forecastId: r.forecastId, symbol: r.symbol, marketKey: r.marketKey, chainId: r.chainId, ledgerId: r.onchainId,
  pBps: r.probabilityBps, reasoningHash: r.reasoningHash, commitment: r.commitment, salt: r.state === "revealed" || r.state === "scored" ? r.salt : null,
  commitTx: r.commitTx, commitBlock: r.commitBlock, revealTx: r.revealTx, revealBlock: null, scoreTx: r.scoreTx, outcomeYes: r.outcomeYes,
  brierBps2: r.brierBps2, state: r.state as Commit["state"], replay: r.source === "replay", createdAt: r.createdAt,
});
const CATS = Object.keys(CATEGORY_BITS) as Category[];
export const toTrade = (r: TradeRow): Trade => ({
  id: String(r.id), symbol: r.symbol, forecastId: r.forecastId, createdAt: r.createdAt, outcome: r.outcome as "yes" | "no", priceBps: r.priceBps,
  quantity: String(r.quantity), notionalCents: r.notionalCents, edgeBps: r.edgeBps, category: CATS[r.category] ?? "other",
  policyOk: r.state !== "refused", policyReason: r.reason ?? "ok", orderId: r.orderId, orderStatus: r.orderStatus, filledQuantity: r.filledQuantity,
  recordTx: r.recordTx, authorizeTx: r.authorizeTx ?? null, onchainTradeId: r.onchainTradeId ?? null, state: r.state as Trade["state"], error: r.state === "failed" ? r.reason : null, source: r.source as Trade["source"],
});
export const toForecast = (r: typeof forecasts.$inferSelect): Forecast => ({ ...(JSON.parse(r.json) as Forecast) });

export function ticksFor(symbol: string, sinceMs = 24 * 3600_000): Tick[] {
  return db.select().from(ticks).where(and(eq(ticks.symbol, symbol), gte(ticks.ts, Date.now() - sinceMs))).orderBy(ticks.ts).all().map(toTick);
}
export function latestTick(symbol: string): Tick | null {
  const r = db.select().from(ticks).where(eq(ticks.symbol, symbol)).orderBy(desc(ticks.ts)).limit(1).get();
  return r ? toTick(r) : null;
}
export function latestBias(symbol: string): BiasReport | null {
  const r = db.select().from(biasReports).where(eq(biasReports.symbol, symbol)).orderBy(desc(biasReports.ts)).limit(1).get();
  return r ? (JSON.parse(r.json) as BiasReport) : null;
}
export function latestForecast(symbol: string): Forecast | null {
  const r = db.select().from(forecasts).where(eq(forecasts.symbol, symbol)).orderBy(desc(forecasts.ts)).limit(1).get();
  return r ? toForecast(r) : null;
}
export function saveForecast(f: Forecast, cacheKey: string) {
  db.insert(forecasts).values({
    id: f.id, symbol: f.symbol, ts: f.createdAt, cacheKey, pBps: f.pBps, loBps: f.loBps, hiBps: f.hiBps, midBps: f.marketMidBps,
    reasoningHash: f.reasoningHash, model: f.model, source: f.source, json: JSON.stringify(f),
  }).onConflictDoNothing().run();
}
export function saveBias(r: BiasReport) {
  db.insert(biasReports).values({ symbol: r.symbol, ts: r.ts, irrationality: r.irrationality, edgeBps: r.edgeBps, json: JSON.stringify(r) }).run();
}
export const commitsFor = (symbol?: string) =>
  (symbol ? db.select().from(commits).where(eq(commits.symbol, symbol)) : db.select().from(commits)).orderBy(desc(commits.createdAt)).all();
export const tradesFor = (symbol?: string) =>
  (symbol ? db.select().from(trades).where(eq(trades.symbol, symbol)) : db.select().from(trades)).orderBy(desc(trades.createdAt)).all();
export const trackedContracts = () => db.select().from(contracts).where(eq(contracts.tracked, true)).all();
export const eventOf = (ticker: string) => db.select().from(events).where(eq(events.ticker, ticker)).get();
export const contractOf = (symbol: string) => db.select().from(contracts).where(eq(contracts.symbol, symbol)).get();
export const siblingsOf = (eventTicker: string) => db.select().from(contracts).where(eq(contracts.eventTicker, eventTicker)).all();
export const latestTicks = (symbols: string[]) => {
  const out = new Map<string, Tick>();
  const cut = Date.now() - 6 * 3600_000;
  for (const s of new Set(symbols)) {
    const r = db.select().from(ticks).where(and(eq(ticks.symbol, s), gte(ticks.ts, cut))).orderBy(desc(ticks.ts)).limit(1).get();
    if (r) out.set(s, toTick(r));
  }
  return out;
};
/** Quotes arrive every 5 s for ~24 contracts; keep two days of ticks and bias reports. */
export function prune(keepMs = 48 * 3600_000) {
  const cut = Date.now() - keepMs;
  db.delete(ticks).where(lt(ticks.ts, cut)).run();
  db.delete(biasReports).where(lt(biasReports.ts, cut)).run();
}
export const indexSeries = (sinceMs = 24 * 3600_000) =>
  db.select().from(indexHistory).where(gte(indexHistory.ts, Date.now() - sinceMs)).orderBy(indexHistory.ts).all();
