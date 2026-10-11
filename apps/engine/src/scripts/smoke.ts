/**
 * pnpm smoke — verifies the whole loop in-process against whatever adapters are live:
 * capability table → Gemini discovery + quotes → bias → council → commit/reveal → leash proof (refused trade, no Gemini order) → authorizeTrade → sandbox order → settleTrade.
 * Flags: --no-trade (skip the order), --open-leash (owner wallet sets min edge 0 for the positive trade, then restores), --symbol=GEMI-..., --services (also ping running engine :4000 and web :3000).
 */
import { config } from "../config.js";
import { chainLive, explorerTx } from "../chain/index.js";
import { capabilities } from "../server.js";
import { discoverAndTrack, pollQuotes, biasFor, lastDiscovery } from "../ingest.js";
import { runPipeline, tradeGap } from "../executor/index.js";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { agentPolicyAbi, type Policy } from "@cassandra/shared";
import { agentAccount, chain, deployment, publicClient } from "../chain/index.js";
import * as ops from "../chain/ops.js";
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
  const res = await runPipeline(symbol, { trade: false });
  if (res.forecast) {
    ok(`Judge p=${(res.forecast.pBps / 100).toFixed(1)}% [${(res.forecast.loBps / 100).toFixed(1)}–${(res.forecast.hiBps / 100).toFixed(1)}] model ${res.forecast.model} hash ${res.forecast.reasoningHash}`);
    console.log(`     ${res.forecast.judge.rationale.slice(0, 220)}`);
  } else fail("no forecast (LLM dry-run?)");

  console.log(`\n[3] Chain (${chainLive ? "live" : "dry-run"})`);
  if (res.commit) {
    ok(`commit #${res.commit.ledgerId} ${link(res.commit.commitTx)}`);
    res.commit.revealTx ? ok(`reveal ${link(res.commit.revealTx)}`) : console.log("     reveal scheduled (REVEAL_DELAY_SECONDS > 0)");
  } else if (chainLive) fail("no commit");

  if (!arg("no-trade") && res.forecast && res.report) {
    if (!chainLive || config.gemini.dryRun) fail("leash proof needs a live chain and live Gemini");
    else {
      // The owner signs here with OWNER_PRIVATE_KEY from env, standing in for the human's browser wallet.
      const owner = createWalletClient({ account: privateKeyToAccount(config.chain.ownerKey!), chain, transport: http(config.chain.network === "local" ? config.chain.localRpcUrl : config.chain.rpcUrl) });
      const setPolicy = async (p: Policy, label: string) => {
        const hash = await owner.writeContract({ address: deployment!.policy, abi: agentPolicyAbi, functionName: "setPolicy", args: [agentAccount!.address, { ...p, maxNotionalPerTrade: BigInt(p.maxNotionalPerTrade), maxDailyNotional: BigInt(p.maxDailyNotional) }] });
        await publicClient.waitForTransactionReceipt({ hash });
        ok(`owner setPolicy (${label}) ${link(hash)}`);
      };
      const cur = await ops.getPolicy();
      const policy: Policy = { maxNotionalPerTrade: cur.maxNotionalPerTrade, maxDailyNotional: cur.maxDailyNotional, minEdgeBps: cur.minEdgeBps, allowedCategoryMask: cur.allowedCategoryMask, paused: cur.paused };

      console.log("\n[4] Leash: the chain refuses before Gemini sees anything");
      const before = await gemini.orderHistory();
      ok(`Gemini getOrderHistory count before: ${before.length}`);
      // min edge 0 so the per-trade cap is the check that fires (check() tests edge before notional)
      await setPolicy({ ...policy, maxNotionalPerTrade: 0, minEdgeBps: 0 }, "max per trade $0.00");
      try {
        const t = await tradeGap(res.forecast, res.report);
        t.state === "refused" && t.policyReason === "notional exceeds max per trade"
          ? ok(`tick refused: "${t.policyReason}" (notional $${(t.notionalCents / 100).toFixed(2)}, state ${t.state}, order id ${t.orderId ?? "none"})`)
          : fail(`expected refusal, got ${t.state} ${t.policyReason}`);
        const after = await gemini.orderHistory();
        after.length === before.length ? ok(`Gemini getOrderHistory count after: ${after.length} (unchanged)`) : fail(`order count moved ${before.length} → ${after.length}`);
      } finally {
        await setPolicy(policy, "restored");
      }

      console.log("\n[5] Inside the leash: authorizeTrade → Gemini order → settleTrade");
      if (arg("open-leash")) await setPolicy({ ...policy, minEdgeBps: 0 }, "min edge 0 for this run");
      try {
        const t = await tradeGap(res.forecast, res.report);
        if (t.state === "refused") ok(`chain refused: ${t.policyReason}. No order sent.`);
        else {
          t.authorizeTx ? ok(`TradeAuthorized #${t.onchainTradeId} ${link(t.authorizeTx)}`) : fail("no authorize tx");
          t.orderId ? ok(`Gemini sandbox order ${t.orderId} ${t.outcome} ${t.quantity} @ ${(t.priceBps / 100).toFixed(0)}¢ → ${t.orderStatus}, filled ${t.filledQuantity}`) : fail(`no order: ${t.error}`);
          t.recordTx ? ok(`TradeRecorded (settleTrade) ${link(t.recordTx)}`) : fail("no settle tx");
        }
      } finally {
        if (arg("open-leash")) await setPolicy(policy, "restored");
      }
    }
  }
  console.log("\ncapabilities", JSON.stringify(await capabilities()));
  console.log(failures ? `\nSMOKE FAILED (${failures})` : "\nSMOKE OK");
  process.exit(failures ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
