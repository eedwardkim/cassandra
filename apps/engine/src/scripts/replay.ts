/**
 * pnpm demo:replay — pick up to three Gemini sandbox contracts that have already settled and for which the
 * engine stored real pre-settlement quotes, run bias → council → seal on that history, then resolve on-chain
 * with Gemini's real resolution side. Rows are flagged "replay" in the UI.
 */
import { and, eq, lt, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { chainLive, network } from "../chain/index.js";
import * as gemini from "../gemini/index.js";
import { biasFor, markSettled } from "../ingest.js";
import { forecastFor, seal } from "../executor/index.js";
import { resolveOne } from "../executor/resolve.js";
import { saveForecast } from "../store.js";
import { cacheKey } from "../executor/index.js";

const want = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 3);
if (!chainLive) { console.error("chain is in dry-run; replay needs a chain"); process.exit(1); }

const { contracts, ticks, commits } = schema;
const done = new Set(db.select({ s: commits.symbol }).from(commits).where(and(eq(commits.network, network), eq(commits.source, "replay"))).all().map((r) => r.s));
const expired = db.select({ symbol: contracts.symbol, eventTicker: contracts.eventTicker, n: sql<number>`count(${ticks.ts})` })
  .from(contracts).innerJoin(ticks, eq(ticks.symbol, contracts.symbol))
  .where(lt(contracts.expiryDate, new Date().toISOString())).groupBy(contracts.symbol).having(sql`count(${ticks.ts}) >= 3`).all()
  .filter((c) => !done.has(c.symbol));
console.log(`${expired.length} expired contracts with stored pre-settlement quotes`);

let n = 0;
for (const c of expired) {
  if (n >= want) break;
  const ev = await gemini.contractsOf(c.eventTicker).catch(() => null);
  const k = ev?.contracts.find((x) => x.symbol === c.symbol);
  const side = k?.resolutionSide?.toLowerCase();
  if (side !== "yes" && side !== "no") continue;
  const report = biasFor(c.symbol);
  const f0 = await forecastFor(c.symbol, report, { force: true });
  const f = { ...f0, source: "replay" as const };
  saveForecast(f, `${cacheKey(c.symbol, f.marketMidBps)}|replay`);
  const commit = await seal(f, "replay");
  await markSettled(c.symbol, side, k?.resolvedAt ?? null);
  const r = await resolveOne(c.symbol, side === "yes", "replay");
  console.log(`✓ ${c.symbol}: market ${(f.marketMidBps / 100).toFixed(1)}% → council ${(f.pBps / 100).toFixed(1)}%, Gemini settled ${side.toUpperCase()}`);
  console.log(`  commit ${commit.commitTx}\n  reveal ${commit.revealTx}\n  scored ${r?.hash} (Brier ${r?.scored.map((s) => (s.brierBps2 / 1e8).toFixed(3)).join(", ")})`);
  n++;
}
console.log(n ? `replayed ${n} settled market(s) on ${network}` : "no settled market with stored quotes yet; let the engine run past one expiry");
process.exit(n ? 0 : 1);
