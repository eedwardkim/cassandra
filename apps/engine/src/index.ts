import { config } from "./config.js";
import { log } from "./bus.js";
import { chainLive, publicClient } from "./chain/index.js";
import * as ops from "./chain/ops.js";
import { buildServer, capabilities, setLatestBlock } from "./server.js";
import { computeBiasAll, discoverAndTrack, pollQuotes, setPolicyMinEdge, writeIndex } from "./ingest.js";
import { runPipeline, councilBudgetLeft, reconcileTrades } from "./executor/index.js";
import { resolveSettled } from "./executor/resolve.js";
import { latestForecast, prune, trackedContracts } from "./store.js";
import { bus } from "./bus.js";
import { llmLive } from "./council/index.js";

function table(c: Awaited<ReturnType<typeof capabilities>>) {
  const rows = [
    ["gemini", `${c.gemini.mode} (sandbox, events = ${c.gemini.events}, orders ${c.gemini.orders})`],
    ["llm", `${c.llm.mode} (${c.llm.model})`],
    ["chain", `${c.chain.mode} (${c.chain.network} ${c.chain.chainId}, block = ${c.chain.block ?? "n/a"})`],
    ["ledger", c.chain.ledger ?? "—"], ["policy", c.chain.policy ?? "—"], ["agent", c.chain.agent ?? "—"], ["owner", c.chain.owner ?? "—"],
    ["demo", c.demoMode ? `on (tick ${config.tickSeconds}s)` : `off (tick ${config.tickSeconds}s)`],
  ];
  console.log("\nCASSANDRA capability table\n" + rows.map(([k, v]) => `  ${k!.padEnd(8)} ${v}`).join("\n") + "\n");
}

const every = (ms: number, name: string, fn: () => Promise<unknown>) => {
  let busy = false;
  const run = async () => { if (busy) return; busy = true; try { await fn(); } catch (e) { log("error", `${name}: ${(e as Error).message}`); } finally { busy = false; } };
  setInterval(run, ms);
  return run;
};

async function main() {
  // listen first so the health check passes while discovery and reconciliation run
  const app = await buildServer();
  await app.listen({ port: config.port, host: "0.0.0.0" });
  if (chainLive) {
    await ops.reconcilePending();
    await reconcileTrades().catch((e) => log("warn", `trade reconcile: ${(e as Error).message}`));
    try { setPolicyMinEdge((await ops.getPolicy()).minEdgeBps); } catch (e) { log("warn", `policy read failed: ${(e as Error).message}`); }
    publicClient.watchBlockNumber({ emitOnBegin: true, poll: true, pollingInterval: 4000, onBlockNumber: (b) => { setLatestBlock(Number(b)); bus.emit({ type: "block", number: Number(b) }); }, onError: () => {} });
  }
  await discoverAndTrack().catch((e) => log("error", `discovery: ${(e as Error).message}`));
  await pollQuotes();
  table(await capabilities());
  log("info", `engine listening on :${config.port}`);

  every(config.quoteSeconds * 1000, "quotes", pollQuotes);
  every(10 * 60_000, "discovery", discoverAndTrack);
  every(3600_000, "prune", async () => prune())();
  every(2 * 60_000, "rediscovery", async () => { if (trackedContracts().length < config.trackedTarget / 2) await discoverAndTrack(); });
  const indexTick = every(60_000, "index", async () => writeIndex(computeBiasAll()));
  await indexTick();
  every(config.tickSeconds * 1000, "tick", async () => {
    const reports = computeBiasAll();
    if (!llmLive || process.env.AUTO_COUNCIL === "false") return;
    // at most two automatic council runs per tick: the hottest stale contracts
    const due = reports
      // stale after an hour, on a hot bias score, or once the market has moved 8+ points since the council priced it
      .filter((r) => { const f = latestForecast(r.symbol); return !f || Date.now() - f.createdAt > 3600_000 || r.irrationality >= 35 || Math.abs(r.midBps - f.marketMidBps) >= 800; })
      .filter((r) => { const f = latestForecast(r.symbol); return !f || Date.now() - f.createdAt > 15 * 60_000; })
      .sort((a, b) => b.irrationality - a.irrationality).slice(0, config.demo ? 1 : 2);
    for (const r of due) {
      if (councilBudgetLeft() <= 2) break;
      await runPipeline(r.symbol).catch((e) => log("warn", `pipeline ${r.symbol}: ${(e as Error).message}`));
    }
  });
  if (chainLive) every(10 * 60_000, "resolve", resolveSettled)();
  log("info", `tracking ${trackedContracts().length} contracts`);
}

main().catch((e) => { console.error(e); process.exit(1); });
