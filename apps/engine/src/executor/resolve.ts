import { and, eq, inArray } from "drizzle-orm";
import type { Hex } from "viem";
import { db, schema } from "../db/index.js";
import { bus, log } from "../bus.js";
import { network } from "../chain/index.js";
import * as ops from "../chain/ops.js";
import * as gemini from "../gemini/index.js";
import { markSettled } from "../ingest.js";
import { toCommit } from "../store.js";

const { commits, contracts } = schema;

/** Resolve on-chain every revealed market whose Gemini contract has settled. Owner wallet is the resolver for the hackathon. */
export async function resolveOne(symbol: string, outcomeYes: boolean, source = "live") {
  const open = db.select().from(commits).where(and(eq(commits.symbol, symbol), eq(commits.network, network), inArray(commits.state, ["revealed"]))).all();
  if (!open.length) return null;
  const r = await ops.resolveMarket(open[0]!.marketKey as Hex, outcomeYes, symbol);
  for (const s of r.scored) {
    const row = db.update(commits).set({ state: "scored", outcomeYes, brierBps2: s.brierBps2, scoreTx: r.hash, updatedAt: Date.now() })
      .where(and(eq(commits.onchainId, s.id), eq(commits.network, network))).returning().get();
    if (row) bus.emit({ type: "seal.scored", commit: toCommit(row) });
  }
  log("info", `resolved ${symbol} ${outcomeYes ? "YES" : "NO"} (${source}); scored ${r.scored.length} commit(s) tx ${r.hash}`);
  return r;
}

export async function resolveSettled() {
  const pending = db.select({ symbol: commits.symbol }).from(commits).where(and(eq(commits.network, network), eq(commits.state, "revealed"))).all();
  const symbols = [...new Set(pending.map((p) => p.symbol))];
  const results = [];
  for (const symbol of symbols) {
    const c = db.select().from(contracts).where(eq(contracts.symbol, symbol)).get();
    if (!c || (c.expiryDate && Date.parse(c.expiryDate) > Date.now())) continue;
    try {
      const ev = await gemini.contractsOf(c.eventTicker);
      const k = ev.contracts.find((x) => x.symbol === symbol);
      const side = k?.resolutionSide?.toLowerCase();
      if (side !== "yes" && side !== "no") continue;
      await markSettled(symbol, side, k?.resolvedAt ?? null);
      results.push(await resolveOne(symbol, side === "yes"));
    } catch (e) {
      log("warn", `resolve ${symbol}: ${(e as Error).message}`);
    }
  }
  return results;
}
