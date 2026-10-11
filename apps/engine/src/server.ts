import Fastify from "fastify";
import cors from "@fastify/cors";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { CATEGORY_BITS, Policy, type Capabilities } from "@cassandra/shared";
import { config } from "./config.js";
import { bus, log } from "./bus.js";
import { db, schema } from "./db/index.js";
import { chainLive, chain, deployment, network, blockNumber, explorerTx, agentAccount, publicClient } from "./chain/index.js";
import * as ops from "./chain/ops.js";
import { llmLive } from "./council/index.js";
import { geminiSource } from "./gemini/index.js";
import { lastDiscovery, trackEvent, depth, setPolicyMinEdge } from "./ingest.js";
import { runPipeline } from "./executor/index.js";
import { commitsFor, contractOf, eventOf, indexSeries, latestBias, latestForecast, latestTicks, ticksFor, toCommit, toForecast, toTrade, trackedContracts, tradesFor } from "./store.js";

let latestBlock: number | null = null;
export const setLatestBlock = (b: number) => { latestBlock = b; };

export async function capabilities(): Promise<Capabilities> {
  latestBlock = (await blockNumber()) ?? latestBlock;
  return {
    gemini: { mode: geminiSource === "live" ? "live" : "fixture", priceFeed: "rest-orderbook-5s", orders: geminiSource === "live" ? "sandbox" : "dry-run", events: lastDiscovery.events },
    llm: { mode: llmLive ? "live" : "dry-run", model: config.llm.model },
    chain: { mode: chainLive ? "live" : "dry-run", network, chainId: chain.id, block: latestBlock, ledger: deployment?.ledger ?? null, policy: deployment?.policy ?? null, agent: agentAccount?.address ?? null, owner: chainLive ? await ownerOf() : null },
    contextDev: !!config.contextDevKey, demoMode: config.demo,
  };
}

function marketSummary(symbol: string) {
  const c = contractOf(symbol)!;
  const e = eventOf(c.eventTicker);
  const t = latestTicks([symbol]).get(symbol) ?? null;
  const b = latestBias(symbol);
  const f = latestForecast(symbol);
  return {
    symbol, label: c.label, eventTicker: c.eventTicker, title: e?.title ?? c.eventTicker, category: c.category, expiryDate: c.expiryDate, status: c.status,
    tracked: c.tracked, depth: depth.get(symbol) ?? 0, tick: t, irrationality: b?.irrationality ?? null, edgeBps: b?.edgeBps ?? null,
    topSignature: b?.signatures.find((s) => s.score > 0) ?? null, councilBps: f?.pBps ?? null, forecastId: f?.id ?? null, source: t?.source ?? geminiSource,
  };
}

let ownerCache: { v: string | null; at: number } = { v: null, at: 0 };
/** Re-read at most every 30 s so a transferOwnership shows up without a restart. */
async function ownerOf() {
  if (Date.now() - ownerCache.at > 30_000) ownerCache = { v: await ops.policyOwner().catch(() => ownerCache.v), at: Date.now() };
  return ownerCache.v;
}
const forcedRuns = new Map<string, number>();
export async function buildServer() {
  const app = Fastify({ logger: false, trustProxy: true });
  await app.register(cors, { origin: true });

  app.get("/health", async () => ({ ok: true, service: "engine", ts: Date.now() }));
  app.get("/api/capabilities", capabilities);
  app.get("/api/markets", async () => trackedContracts().map((c) => marketSummary(c.symbol)));
  app.get<{ Params: { symbol: string } }>("/api/markets/:symbol", async (req, reply) => {
    const c = contractOf(req.params.symbol);
    if (!c) return reply.code(404).send({ error: "unknown symbol" });
    return {
      ...marketSummary(c.symbol), description: eventOf(c.eventTicker)?.description ?? null,
      ticks: ticksFor(c.symbol), bias: latestBias(c.symbol), forecast: latestForecast(c.symbol),
      commits: commitsFor(c.symbol).filter((r) => r.network === network).map(toCommit), trades: tradesFor(c.symbol).map(toTrade),
    };
  });
  app.get<{ Params: { id: string } }>("/api/forecasts/:id", async (req, reply) => {
    const r = db.select().from(schema.forecasts).where(eq(schema.forecasts.id, req.params.id)).get();
    if (!r) return reply.code(404).send({ error: "unknown forecast" });
    const f = toForecast(r);
    return { ...f, canonical: { personas: f.personas, judge: f.judge }, howToVerify: "keccak256(utf8(canonicalJson({ judge, personas }))) with keys sorted, no whitespace, equals reasoningHash" };
  });
  app.get("/api/index", async () => {
    const series = indexSeries();
    return { value: series.at(-1)?.value ?? null, series: series.map((s) => ({ ts: s.ts, value: s.value })) };
  });
  app.get("/api/ledger", async () => {
    const rows = commitsFor().filter((r) => r.network === network).map(toCommit);
    const cal = chainLive ? await ops.calibration().catch(() => null) : null;
    return {
      network, chainId: chain.id, ledger: deployment?.ledger ?? null, explorer: network === "local" ? null : "https://testnet.bscscan.com/tx/",
      onchain: cal ? { count: Number(cal.count), meanBrierBps2: cal.meanBrierBps2 } : null,
      counts: { sealed: rows.filter((r) => r.state !== "pending" && r.state !== "failed").length, revealed: rows.filter((r) => r.state === "revealed" || r.state === "scored").length, scored: rows.filter((r) => r.state === "scored").length },
      commits: rows.map((r) => ({ ...r, title: eventOf(contractOf(r.symbol)?.eventTicker ?? "")?.title ?? r.symbol, label: contractOf(r.symbol)?.label ?? r.symbol })),
    };
  });
  app.get("/api/policy", async () => {
    if (!chainLive) return { live: false, policy: null, trades: tradesFor().map(toTrade), categories: CATEGORY_BITS };
    const p = await ops.getPolicy();
    setPolicyMinEdge(p.minEdgeBps);
    return { live: true, policy: p, agent: agentAccount?.address, owner: await ownerOf(), address: deployment?.policy, trades: tradesFor().map(toTrade), categories: CATEGORY_BITS };
  });
  // Policy writes are signed by the owner's own wallet in the browser; the engine holds no key that can call setPolicy/setPaused.
  // Local anvil only: a JSON-RPC passthrough so a browser wallet can reach the chain, and a one-shot gas faucet.
  // explicit list: anvil also answers eth_sendUnsignedTransaction, which would let anyone send as the owner
  const RPC_ALLOW = new Set(["eth_chainId", "eth_blockNumber", "eth_getBalance", "eth_getCode", "eth_getStorageAt", "eth_call", "eth_estimateGas", "eth_gasPrice", "eth_maxPriorityFeePerGas", "eth_feeHistory", "eth_getTransactionCount", "eth_getTransactionByHash", "eth_getTransactionReceipt", "eth_getBlockByNumber", "eth_getBlockByHash", "eth_getLogs", "eth_sendRawTransaction", "eth_syncing", "net_version", "web3_clientVersion"]);
  const rpcAllowed = (m: unknown) => typeof m === "string" && RPC_ALLOW.has(m);
  app.post("/rpc", async (req, reply) => {
    if (network !== "local") return reply.code(404).send({ error: "rpc passthrough exists only on the local chain" });
    const body = req.body as { method?: unknown; id?: unknown } | { method?: unknown; id?: unknown }[];
    const calls = Array.isArray(body) ? body : [body];
    const bad = calls.find((c) => !rpcAllowed(c?.method));
    if (bad) return reply.code(403).send({ jsonrpc: "2.0", id: bad?.id ?? null, error: { code: -32601, message: `method not allowed: ${String(bad?.method)}` } });
    const r = await fetch(config.chain.localRpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return reply.code(r.status).header("content-type", "application/json").send(await r.text());
  });
  const fauceted = new Set<string>();
  app.post("/api/faucet-local", async (req, reply) => {
    if (network !== "local") return reply.code(404).send({ error: "faucet exists only on the local chain" });
    const { address } = z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }).parse(req.body ?? {});
    const key = address.toLowerCase();
    if (fauceted.has(key) || (await publicClient.getBalance({ address: address as `0x${string}` })) >= BigInt(10) ** BigInt(17)) return reply.code(429).send({ error: "this address was already funded" });
    fauceted.add(key);
    const r = await fetch(config.chain.localRpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "anvil_setBalance", params: [address, "0xde0b6b3a7640000"] }) });
    const j = (await r.json()) as { error?: { message: string } };
    if (j.error) { fauceted.delete(key); return reply.code(502).send({ error: j.error.message }); }
    log("info", `local faucet: 1 test ETH to ${address}`);
    return { funded: address, amountWei: "1000000000000000000" };
  });
  app.post("/api/track", async (req) => {
    const { eventTicker } = z.object({ eventTicker: z.string().min(1) }).parse(req.body);
    return { tracked: await trackEvent(eventTicker) };
  });
  app.post<{ Params: { symbol: string } }>("/api/run/:symbol", async (req, reply) => {
    if (!contractOf(req.params.symbol)) return reply.code(404).send({ error: "unknown symbol" });
    const force = (req.query as { force?: string }).force === "1";
    if (force) {
      const last = forcedRuns.get(req.ip) ?? 0;
      if (Date.now() - last < 120_000) return reply.code(429).send({ error: "One fresh forecast per visitor every 2 minutes." });
      forcedRuns.set(req.ip, Date.now());
    }
    runPipeline(req.params.symbol, { force })
      .then((r) => log("info", `run ${req.params.symbol}: ${r.steps.join(" → ")}`))
      .catch((e) => log("error", `run ${req.params.symbol}: ${(e as Error).message}`));
    return reply.code(202).send({ started: true, symbol: req.params.symbol });
  });
  app.get("/api/events/recent", async () => bus.recent());
  app.get("/api/stream", (req, reply) => {
    reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no", "access-control-allow-origin": "*" });
    reply.raw.write(`retry: 3000\n\n`);
    const off = bus.on((e) => reply.raw.write(`data: ${JSON.stringify(e)}\n\n`));
    const hb = setInterval(() => reply.raw.write(`: hb\n\n`), 15000);
    req.raw.on("close", () => { off(); clearInterval(hb); });
  });
  app.setErrorHandler((err, _req, reply) => {
    const e = err as Error & { statusCode?: number };
    reply.code(e.name === "ZodError" ? 400 : (e.statusCode ?? 500)).send({ error: e.message });
  });
  return app;
}
export { desc };
