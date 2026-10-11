import { eq, inArray, notInArray } from "drizzle-orm";
import { CATEGORY_BITS, liquidityScore, spectrometer, type BiasReport, type Category, type Tick } from "@cassandra/shared";
import { config } from "./config.js";
import { bus, log } from "./bus.js";
import { db, schema } from "./db/index.js";
import * as gemini from "./gemini/index.js";
import { isLadderLeg } from "./gemini/index.js";
import { latestForecast, latestTicks, saveBias, siblingsOf, ticksFor, trackedContracts, contractOf, eventOf } from "./store.js";

const { events, contracts, ticks, indexHistory } = schema;
export const depth = new Map<string, number>();
let policyMinEdge = 300;
export const setPolicyMinEdge = (bps: number) => { policyMinEdge = bps; };
export let lastDiscovery = { events: 0, contracts: 0, quoted: 0, ts: 0 };

function upsertEvent(e: gemini.DiscoveredEvent, source: string) {
  const now = Date.now();
  db.insert(events).values({ ticker: e.ticker, title: e.title, description: e.description, category: e.category, rawCategory: e.rawCategory, status: e.status, volume: e.volume, expiryDate: e.expiryDate, exclusive: e.exclusive, source, updatedAt: now })
    .onConflictDoUpdate({ target: events.ticker, set: { title: e.title, description: e.description, status: e.status, volume: e.volume, expiryDate: e.expiryDate, updatedAt: now } }).run();
  for (const k of e.contracts) {
    db.insert(contracts).values({ symbol: k.symbol, eventTicker: e.ticker, label: k.label, category: k.category, expiryDate: k.expiryDate, status: k.status, resolutionSide: k.resolutionSide, resolvedAt: k.resolvedAt, source, updatedAt: now })
      .onConflictDoUpdate({ target: contracts.symbol, set: { status: k.status, label: k.label, expiryDate: k.expiryDate, resolutionSide: k.resolutionSide, resolvedAt: k.resolvedAt, updatedAt: now } }).run();
  }
}

/** Pull every active event, persist, and pick ~24 contracts to track: quoted, not pinned at 0/100, spread across events and categories, soonest-resolving last. */
export async function discoverAndTrack(): Promise<number> {
  const evs = await gemini.discover();
  const src = gemini.geminiSource;
  for (const e of evs) upsertEvent(e, src);
  const activeSymbols = new Set(evs.flatMap((e) => e.contracts.map((k) => k.symbol)));
  const now = Date.now();
  const live = (k: gemini.DiscoveredContract) => !k.expiryDate || Date.parse(k.expiryDate) - now > 4 * 60_000;
  // embedded event prices are sparse in the sandbox; probe order books for the rest (bounded)
  const unpriced = evs.flatMap((e) => e.contracts.filter((k) => !k.quote && live(k))).sort((a, b) => Date.parse(a.expiryDate ?? "2100-01-01") - Date.parse(b.expiryDate ?? "2100-01-01")).slice(0, 160);
  for (let i = 0; i < unpriced.length; i += 10) {
    await Promise.all(unpriced.slice(i, i + 10).map(async (k) => { try { k.quote = await gemini.quote(k.symbol); } catch { /* not listed on the book */ } }));
  }
  const candidates = evs.flatMap((e) => e.contracts.filter((k) => k.quote && k.quote.midBps >= 300 && k.quote.midBps <= 9700 && live(k)).map((k) => ({ e, k })));
  // round-robin across events (most liquid first), keeping category diversity
  const byEvent = new Map<string, typeof candidates>();
  for (const c of candidates) byEvent.set(c.e.ticker, [...(byEvent.get(c.e.ticker) ?? []), c]);
  for (const list of byEvent.values()) list.sort((a, b) => Math.abs(5000 - a.k.quote!.midBps) - Math.abs(5000 - b.k.quote!.midBps));
  const keep = new Set<string>(trackedContracts().filter((c) => activeSymbols.has(c.symbol) && c.status !== "settled").map((c) => c.symbol));
  const manual = new Set(keep);
  const queues = [...byEvent.values()].sort((a, b) => b.length - a.length);
  for (let round = 0; keep.size < config.trackedTarget && queues.some((q) => q.length > round); round++) {
    for (const q of queues) { const c = q[round]; if (c && keep.size < config.trackedTarget) keep.add(c.k.symbol); }
  }
  if (!candidates.length && keep.size) {
    log("warn", `discovery: sandbox books are empty right now; keeping ${keep.size} tracked contracts`);
    lastDiscovery = { events: evs.length, contracts: activeSymbols.size, quoted: 0, ts: now };
    return keep.size;
  }
  db.update(contracts).set({ tracked: false }).where(notInArray(contracts.symbol, [...keep])).run();
  if (keep.size) db.update(contracts).set({ tracked: true }).where(inArray(contracts.symbol, [...keep])).run();
  lastDiscovery = { events: evs.length, contracts: activeSymbols.size, quoted: candidates.length, ts: now };
  log("info", `discovery: ${evs.length} active events, ${candidates.length} quoted contracts, tracking ${keep.size} (${manual.size} carried over)`);
  return keep.size;
}

export async function trackEvent(eventTicker: string) {
  const e = await gemini.contractsOf(eventTicker);
  upsertEvent(e, gemini.geminiSource);
  const syms = e.contracts.filter((k) => k.quote).map((k) => k.symbol).slice(0, 4);
  if (syms.length) db.update(contracts).set({ tracked: true }).where(inArray(contracts.symbol, syms)).run();
  return syms;
}

export function insertTick(q: gemini.Quote): Tick {
  const t: Tick = { symbol: q.symbol, ts: q.ts, bidBps: q.bidBps, askBps: q.askBps, noAskBps: q.noAskBps, midBps: q.midBps, lastBps: q.lastBps, volume: q.volume, source: q.source };
  db.insert(ticks).values(t).run();
  return t;
}

/** One pass over the tracked set: fresh order-book quote per contract, stored as integer bps. */
export async function pollQuotes(): Promise<number> {
  let n = 0;
  const tracked = trackedContracts();
  await Promise.all(tracked.map(async (c) => {
    try {
      const q = await gemini.quote(c.symbol);
      if (!q) return;
      depth.set(c.symbol, q.volume != null && q.midBps > 0 ? Math.round(q.volume / (q.midBps / 10000)) : 0);
      insertTick(q);
      bus.emit({ type: "tick", symbol: c.symbol, midBps: q.midBps, ts: q.ts });
      n++;
    } catch (err) {
      if (!/not found|404/i.test((err as Error).message)) log("warn", `quote ${c.symbol}: ${(err as Error).message}`);
    }
  }));
  return n;
}

export const categoryBit = (c: string) => CATEGORY_BITS[(c as Category)] ?? CATEGORY_BITS.other;

export function biasFor(symbol: string): BiasReport | null {
  const c = contractOf(symbol);
  if (!c) return null;
  const tk = ticksFor(symbol);
  if (!tk.length) return null;
  const e = eventOf(c.eventTicker);
  const sibs = siblingsOf(c.eventTicker);
  const latest = latestTicks(sibs.map((s) => s.symbol));
  const f = latestForecast(symbol);
  const t = tk[tk.length - 1]!;
  const report = spectrometer({
    contract: { symbol, category: c.category as Category, expiryDate: c.expiryDate, exclusive: !!e?.exclusive && !sibs.some((s) => isLadderLeg(s.symbol, s.label)) },
    ticks: tk,
    siblings: sibs.flatMap((s) => { const x = latest.get(s.symbol); return x ? [{ symbol: s.symbol, midBps: x.midBps }] : []; }),
    council: f && Date.now() - f.createdAt < 6 * 3600_000 ? { pBps: f.pBps, loBps: f.loBps, hiBps: f.hiBps } : null,
    liquidityScore: liquidityScore(depth.get(symbol) ?? t.volume ?? 0, t.bidBps, t.askBps),
  }, policyMinEdge);
  return report;
}

export function computeBiasAll(): BiasReport[] {
  const out: BiasReport[] = [];
  for (const c of trackedContracts()) {
    const r = biasFor(c.symbol);
    if (!r) continue;
    saveBias(r);
    bus.emit({ type: "bias.update", report: r });
    out.push(r);
  }
  return out;
}

/** Depth-weighted mean irrationality across tracked contracts (sandbox events report zero volume, so resting depth is the weight). */
export function writeIndex(reports: BiasReport[]) {
  if (!reports.length) return null;
  let wsum = 0, sum = 0;
  for (const r of reports) { const w = Math.log10(2 + (depth.get(r.symbol) ?? 0)); wsum += w; sum += w * r.irrationality; }
  const value = Math.round((sum / wsum) * 10) / 10;
  const ts = Date.now();
  db.insert(indexHistory).values({ ts, value, contracts: reports.length }).onConflictDoNothing().run();
  bus.emit({ type: "index.update", value, ts });
  return value;
}

export async function markSettled(symbol: string, side: "yes" | "no", resolvedAt: string | null) {
  db.update(contracts).set({ status: "settled", resolutionSide: side, resolvedAt, tracked: false }).where(eq(contracts.symbol, symbol)).run();
}
