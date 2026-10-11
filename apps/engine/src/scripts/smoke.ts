/**
 * pnpm smoke — verifies the whole loop in-process against whatever adapters are live:
 * capability table → Gemini discovery + quotes → bias → council → commit/reveal → policy check → sandbox order → recordTrade.
 * Flags: --no-trade (skip the order), --symbol=GEMI-..., --services (also ping running engine :4000 and web :3000).
 */
import { config } from "../config.js";
import { chainLive, explorerTx } from "../chain/index.js";
import { capabilities } from "../server.js";
import { discoverAndTrack, pollQuotes, biasFor, lastDiscovery } from "../ingest.js";
import { runPipeline } from "../executor/index.js";
import { trackedContracts, latestTicks } from "../store.js";
import * as gemini from "../gemini/index.js";

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}`))?.split("=")[1] ?? (process.argv.includes(`--${k}`) ? "1" : undefined);
const ok = (m: string) => console.log(`  \u2713 ${m}`);
const link = (h?: string | null) => (h ? `${h}${explorerTx(h) ? `  ${explorerTx(h)}` : ""}` : "—");
let failures = 0;
const fail = (m: string) => { failures++; console.log(`  \u2717 ${m}`); };

async function main() {
  if (arg("services")) {
    for (const [name, url] of [["engine", `http://localhost:${config.port}/health`], ["web", "http://localhost:3000/"]] as const) {
      try { const r = await fetch(url, { signal: AbortSignal.timeout(8000) }); r.ok ? ok(`${name} health ${r.status}`) : fail(`${name} health ${r.status}`); }
      catch (e) { fail(`${name} unreachable: ${(e as Error).message}`); }
    }
  }
  console.log("\n[1] Gemini sandbox");
  const n = await discoverAndTrack();
  await pollQuotes();
  ok(`${lastDiscovery.events} active events, ${lastDiscovery.quoted} quoted contracts, ${n} tracked (source ${gemini.geminiSource})`);
  const tracked = trackedContracts();
  const ticks = latestTicks(tracked.map((c) => c.symbol));
  for (const c of tracked.slice(0, 10)) console.log(`     ${c.symbol.padEnd(34)} mid ${ticks.get(c.symbol) ? (ticks.get(c.symbol)!.midBps / 100).toFixed(1) + "%" : "—"}`);
  if (tracked.length < 10) fail("fewer than 10 tracked contracts");

  console.log("\n[2] Bias Spectrometer + Council");
  const symbol = arg("symbol") ?? [...tracked].filter((c) => ticks.get(c.symbol)).sort((a, b) => Math.abs(5000 - ticks.get(a.symbol)!.midBps) - Math.abs(5000 - ticks.get(b.symbol)!.midBps))[0]?.symbol;
  if (!symbol) throw new Error("no quoted contract to run");
  const report = biasFor(symbol);
  ok(`BiasReport ${symbol}: irrationality ${report?.irrationality}, top ${report?.signatures[0]?.kind} ${report?.signatures[0]?.score.toFixed(2)}`);
  const res = await runPipeline(symbol, { trade: !arg("no-trade") });
  if (res.forecast) {
    ok(`Judge p=${(res.forecast.pBps / 100).toFixed(1)}% [${(res.forecast.loBps / 100).toFixed(1)}–${(res.forecast.hiBps / 100).toFixed(1)}] model ${res.forecast.model} hash ${res.forecast.reasoningHash}`);
    console.log(`     ${res.forecast.judge.rationale.slice(0, 220)}`);
  } else fail("no forecast (LLM dry-run?)");

  console.log(`\n[3] Chain (${chainLive ? "live" : "dry-run"})`);
  if (res.commit) {
    ok(`commit #${res.commit.ledgerId} ${link(res.commit.commitTx)}`);
    res.commit.revealTx ? ok(`reveal ${link(res.commit.revealTx)}`) : console.log("     reveal scheduled (REVEAL_DELAY_SECONDS > 0)");
  } else if (chainLive) fail("no commit");

  if (!arg("no-trade")) {
    console.log("\n[4] Policy + sandbox order + record");
    const t = res.trade;
    if (!t) fail("no trade attempt");
    else {
      ok(`policy ${t.policyOk ? "ok" : "refused"}: ${t.policyReason} (edge ${t.edgeBps} bps, notional $${(t.notionalCents / 100).toFixed(2)})`);
      if (t.orderId) ok(`Gemini sandbox order ${t.orderId} ${t.outcome} ${t.quantity} @ ${(t.priceBps / 100).toFixed(0)}¢ → ${t.orderStatus}`);
      if (t.recordTx) ok(`TradeRecorded ${link(t.recordTx)}`);
    }
  }
  console.log("\ncapabilities", JSON.stringify(await capabilities()));
  console.log(failures ? `\nSMOKE FAILED (${failures})` : "\nSMOKE OK");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
