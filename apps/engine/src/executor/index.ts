import { randomBytes, randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Hex } from "viem";
import { commitmentHash, marketKey, orderIdHash, type Forecast, type BiasReport } from "@cassandra/shared";
import { config } from "../config.js";
import { bus, log } from "../bus.js";
import { db, schema } from "../db/index.js";
import { chainLive, network, chain } from "../chain/index.js";
import * as ops from "../chain/ops.js";
import * as gemini from "../gemini/index.js";
import { runCouncil, llmLive, councilBudgetLeft, type CouncilContext } from "../council/index.js";
import { biasFor, categoryBit, setPolicyMinEdge } from "../ingest.js";
import { contractOf, eventOf, latestForecast, saveBias, saveForecast, siblingsOf, latestTicks, ticksFor, toCommit, toTrade } from "../store.js";

const { forecasts, commits, trades, agentRuns } = schema;
const running = new Set<string>();
const pct = (b: number) => `${(b / 100).toFixed(1)}%`;
export const cacheKey = (symbol: string, midBps: number, ts = Date.now()) => `${symbol}|${Math.round(midBps / 500) * 500}|${Math.floor(ts / 3600_000)}`;

function pricePath(symbol: string): string {
  const tk = ticksFor(symbol);
  if (!tk.length) return "no history";
  const first = tk[0]!, last = tk[tk.length - 1]!;
  const mids = tk.map((t) => t.midBps);
  const hrs = ((last.ts - first.ts) / 3600_000).toFixed(1);
  const hourAgo = tk.find((t) => t.ts >= last.ts - 3600_000) ?? first;
  return `${tk.length} quotes over ${hrs}h; first ${pct(first.midBps)}, 1h ago ${pct(hourAgo.midBps)}, now ${pct(last.midBps)}; range ${pct(Math.min(...mids))}–${pct(Math.max(...mids))}`;
}

export function councilContext(symbol: string, report: BiasReport | null, asOf = Date.now()): CouncilContext {
  const c = contractOf(symbol);
  if (!c) throw new Error(`unknown contract ${symbol}`);
  const e = eventOf(c.eventTicker);
  const t = latestTicks([symbol]).get(symbol) ?? ticksFor(symbol, 365 * 86400_000).at(-1);
  if (!t) throw new Error(`no quotes for ${symbol}`);
  const sibs = siblingsOf(c.eventTicker).filter((s) => s.symbol !== symbol);
  const sibTicks = latestTicks(sibs.map((s) => s.symbol));
  const top = report?.signatures.filter((s) => s.score > 0).slice(0, 3).map((s) => `${s.kind} ${(s.score * 100).toFixed(0)}/100 (${s.explanation})`).join("; ");
  return {
    symbol, eventTitle: e?.title ?? c.eventTicker, contractLabel: c.label, description: e?.description ?? null, category: c.category,
    expiryDate: c.expiryDate, daysToResolution: c.expiryDate ? (Date.parse(c.expiryDate) - asOf) / 86400_000 : null,
    midBps: t.midBps, bidBps: t.bidBps, askBps: t.askBps,
    siblings: sibs.map((s) => ({ label: s.label, midBps: sibTicks.get(s.symbol)?.midBps ?? null })),
    pricePath: pricePath(symbol), biasSummary: top || "no signature above zero",
  };
}

/** Council with cache by (symbol, mid rounded to 0.05, hour bucket). */
export async function forecastFor(symbol: string, report: BiasReport | null, opts: { force?: boolean } = {}): Promise<Forecast> {
  const ctx = councilContext(symbol, report);
  const key = cacheKey(symbol, ctx.midBps);
  const runId = randomUUID();
  if (!opts.force) {
    const hit = db.select().from(forecasts).where(eq(forecasts.cacheKey, key)).get();
    if (hit) {
      const f = JSON.parse(hit.json) as Forecast;
      bus.emit({ type: "council.start", symbol, runId: f.id, cached: true });
      bus.emit({ type: "council.final", symbol, runId: f.id, forecast: f });
      return f;
    }
  }
  bus.emit({ type: "council.start", symbol, runId, cached: false });
  try {
    const { forecast } = await runCouncil(ctx, runId);
    saveForecast(forecast, key);
    bus.emit({ type: "council.final", symbol, runId, forecast });
    db.insert(agentRuns).values({ kind: "council", symbol, ts: Date.now(), status: "ok", detail: forecast.id }).run();
    return forecast;
  } catch (err) {
    bus.emit({ type: "council.error", symbol, runId, message: (err as Error).message });
    db.insert(agentRuns).values({ kind: "council", symbol, ts: Date.now(), status: "error", detail: (err as Error).message }).run();
    throw err;
  }
}

/** commit() from the agent wallet, then reveal() after REVEAL_DELAY_SECONDS. Row goes pending → sealed → revealed. */
export async function seal(f: Forecast, source: "live" | "replay" = "live") {
  const existing = db.select().from(commits).where(and(eq(commits.forecastId, f.id), eq(commits.network, network))).get();
  if (existing) return toCommit(existing);
  const mKey = marketKey(f.symbol);
  const salt = `0x${randomBytes(32).toString("hex")}` as Hex;
  const commitment = commitmentHash(mKey, f.pBps, f.reasoningHash as Hex, salt);
  const now = Date.now();
  const row = db.insert(commits).values({
    forecastId: f.id, symbol: f.symbol, marketKey: mKey, network, chainId: chain.id, probabilityBps: f.pBps, reasoningHash: f.reasoningHash,
    salt, commitment, state: "pending", source, createdAt: now, updatedAt: now,
  }).returning().get();
  bus.emit({ type: "seal.pending", commit: toCommit(row) });
  try {
    const c = await ops.commitForecast(mKey, commitment, String(row.id));
    const sealed = db.update(commits).set({ state: "sealed", onchainId: c.onchainId, commitTx: c.hash, commitBlock: c.block, updatedAt: Date.now() }).where(eq(commits.id, row.id)).returning().get();
    bus.emit({ type: "seal.committed", commit: toCommit(sealed) });
    log("info", `sealed ${f.symbol} p=${pct(f.pBps)} commit #${c.onchainId} tx ${c.hash}`);
    const doReveal = async () => {
      const r = await ops.revealForecast(c.onchainId, f.pBps, f.reasoningHash as Hex, salt, String(row.id));
      const revealed = db.update(commits).set({ state: "revealed", revealTx: r.hash, updatedAt: Date.now() }).where(eq(commits.id, row.id)).returning().get();
      bus.emit({ type: "seal.revealed", commit: toCommit(revealed) });
      return revealed;
    };
    if (config.revealDelaySeconds <= 0) return toCommit(await doReveal());
    setTimeout(() => doReveal().catch((e) => log("error", `reveal ${row.id}: ${(e as Error).message}`)), config.revealDelaySeconds * 1000);
    return toCommit(sealed);
  } catch (err) {
    db.update(commits).set({ state: "failed", updatedAt: Date.now() }).where(eq(commits.id, row.id)).run();
    throw err;
  }
}

/** Policy check on-chain, IOC order in the sandbox, then recordTrade on-chain. */
export async function tradeGap(f: Forecast, report: BiasReport) {
  const already = db.select().from(trades).where(and(eq(trades.forecastId, f.id), eq(trades.network, network))).all();
  if (already.some((t) => t.state !== "refused")) return toTrade(already[0]!);
  const c = contractOf(f.symbol)!;
  const t = latestTicks([f.symbol]).get(f.symbol);
  if (!t) throw new Error("no fresh quote");
  const outcome: "yes" | "no" = f.pBps >= t.midBps ? "yes" : "no";
  const bestAsk = outcome === "yes" ? t.askBps : t.noAskBps;
  if (bestAsk == null) throw new Error(`no ${outcome} ask on the book`);
  const priceBps = Math.min(9900, bestAsk + 100);
  const policy = await ops.getPolicy();
  setPolicyMinEdge(policy.minEdgeBps);
  const quantity = Math.max(1, Math.min(10, Math.floor(policy.maxNotionalPerTrade / (priceBps / 100))));
  const notionalCents = Math.round((quantity * priceBps) / 100);
  const edge = report.edgeBps;
  const category = categoryBit(c.category);
  const check = await ops.checkPolicy(notionalCents, edge, category);
  bus.emit({ type: "policy.checked", symbol: f.symbol, ok: check.ok, reason: check.reason, edgeBps: edge, notionalCents });
  const now = Date.now();
  const base = { symbol: f.symbol, forecastId: f.id, outcome, side: "buy", priceBps, quantity, notionalCents, edgeBps: edge, category, clientOrderId: randomUUID(), network, source: gemini.geminiSource, createdAt: now, updatedAt: now };
  if (!check.ok) {
    const row = db.insert(trades).values({ ...base, state: "refused", reason: check.reason }).returning().get();
    bus.emit({ type: "trade.refused", trade: toTrade(row) });
    log("warn", `trade refused on-chain for ${f.symbol}: ${check.reason}`);
    return toTrade(row);
  }
  // store the attempt before the POST; a crash after this point is reconciled from order history, never resent
  const row = db.insert(trades).values({ ...base, state: "placing" }).returning().get();
  let placed: gemini.PlacedOrder;
  try {
    placed = await gemini.placeIoc({ symbol: f.symbol, outcome, priceBps, quantity, clientOrderId: base.clientOrderId });
  } catch (err) {
    const failed = db.update(trades).set({ state: "failed", reason: (err as Error).message.slice(0, 300), updatedAt: Date.now() }).where(eq(trades.id, row.id)).returning().get();
    bus.emit({ type: "trade.refused", trade: toTrade(failed) });
    throw err;
  }
  const p2 = db.update(trades).set({ state: "placed", orderId: placed.orderId, orderStatus: placed.status, filledQuantity: placed.filledQuantity, updatedAt: Date.now() }).where(eq(trades.id, row.id)).returning().get();
  bus.emit({ type: "trade.placed", trade: toTrade(p2) });
  log("info", `sandbox order ${placed.orderId} ${outcome} ${quantity} @ ${pct(priceBps)} → ${placed.status}`);
  const rec = await ops.recordTrade(marketKey(f.symbol), notionalCents, Math.max(0, edge), category, orderIdHash(placed.orderId), String(row.id));
  const done = rec.ok
    ? db.update(trades).set({ state: "recorded", recordTx: rec.hash, recordBlock: rec.block, updatedAt: Date.now() }).where(eq(trades.id, row.id)).returning().get()
    : db.update(trades).set({ state: "refused", reason: rec.reason, updatedAt: Date.now() }).where(eq(trades.id, row.id)).returning().get();
  bus.emit({ type: rec.ok ? "trade.recorded" : "trade.refused", trade: toTrade(done) });
  return toTrade(done);
}

export interface PipelineResult { report: BiasReport | null; forecast: Forecast | null; commit: ReturnType<typeof toCommit> | null; trade: ReturnType<typeof toTrade> | null; steps: string[] }

/** bias → council → seal → policy → trade → record for one contract. */
export async function runPipeline(symbol: string, opts: { force?: boolean; trade?: boolean } = {}): Promise<PipelineResult> {
  if (running.has(symbol)) throw new Error(`pipeline already running for ${symbol}`);
  running.add(symbol);
  const steps: string[] = [];
  try {
    let report = biasFor(symbol);
    if (report) { saveBias(report); bus.emit({ type: "bias.update", report }); steps.push(`bias ${report.irrationality}`); }
    const prev = latestForecast(symbol);
    const stale = !prev || Date.now() - prev.createdAt > 3600_000;
    if (!llmLive && !prev) return { report, forecast: null, commit: null, trade: null, steps: [...steps, "council skipped (LLM dry-run)"] };
    const forecast = opts.force || stale || (report?.irrationality ?? 0) >= 35 ? await forecastFor(symbol, report, { force: opts.force }) : prev!;
    steps.push(`council ${pct(forecast.pBps)}`);
    report = biasFor(symbol) ?? report;
    if (report) { saveBias(report); bus.emit({ type: "bias.update", report }); }
    if (!chainLive) return { report, forecast, commit: null, trade: null, steps: [...steps, "seal skipped (chain dry-run)"] };
    const commit = await seal(forecast);
    steps.push(`sealed ${commit.commitTx}`);
    let trade = null;
    if (opts.trade !== false && report) {
      try { trade = await tradeGap(forecast, report); steps.push(`trade ${trade.state} ${trade.orderId ?? trade.policyReason}`); }
      catch (err) { steps.push(`trade error ${(err as Error).message}`); log("error", `trade ${symbol}: ${(err as Error).message}`); }
    }
    return { report, forecast, commit, trade, steps };
  } finally {
    running.delete(symbol);
  }
}

export { councilBudgetLeft };
