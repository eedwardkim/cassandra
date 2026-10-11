import Fastify from "fastify";
import cors from "@fastify/cors";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { CATEGORY_BITS, Policy, type Capabilities } from "@cassandra/shared";
import { config } from "./config.js";
import { bus, log } from "./bus.js";
import { db, schema } from "./db/index.js";
import { chainLive, chain, deployment, network, blockNumber, explorerTx, agentAccount, ownerAccount } from "./chain/index.js";
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
    chain: { mode: chainLive ? "live" : "dry-run", network, chainId: chain.id, block: latestBlock, ledger: deployment?.ledger ?? null, policy: deployment?.policy ?? null, agent: agentAccount?.address ?? null, owner: ownerAccount?.address ?? null },
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

export async function buildServer() {
  const app = Fastify({ logger: false });
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
      commits: commitsFor(c.symbol).map(toCommit), trades: tradesFor(c.symbol).map(toTrade),
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
    const rows = commitsFor().map(toCommit);
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
    return { live: true, policy: p, agent: agentAccount?.address, owner: ownerAccount?.address, address: deployment?.policy, trades: tradesFor().map(toTrade), categories: CATEGORY_BITS };
  });
  app.post("/api/policy", async (req, reply) => {
    if (!chainLive) return reply.code(503).send({ error: "chain is in dry-run mode" });
    const p = Policy.parse(req.body);
    const sent = await ops.setPolicy(p);
    setPolicyMinEdge(p.minEdgeBps);
    bus.emit({ type: "policy.updated", policy: p, txHash: sent.hash });
    return { txHash: sent.hash, block: sent.block, explorer: explorerTx(sent.hash) };
  });
  app.post("/api/agent/pause", async (req, reply) => {
    if (!chainLive) return reply.code(503).send({ error: "chain is in dry-run mode" });
    const { paused } = z.object({ paused: z.boolean() }).parse(req.body ?? {});
    const cur = await ops.getPolicy();
    const p = { maxNotionalPerTrade: cur.maxNotionalPerTrade, maxDailyNotional: cur.maxDailyNotional, minEdgeBps: cur.minEdgeBps, allowedCategoryMask: cur.allowedCategoryMask, paused };
    const sent = await ops.setPolicy(p);
    bus.emit({ type: "policy.updated", policy: p, txHash: sent.hash });
    return { txHash: sent.hash, paused };
  });
  app.post("/api/track", async (req) => {
    const { eventTicker } = z.object({ eventTicker: z.string().min(1) }).parse(req.body);
    return { tracked: await trackEvent(eventTicker) };
  });
  app.post<{ Params: { symbol: string } }>("/api/run/:symbol", async (req, reply) => {
    if (!contractOf(req.params.symbol)) return reply.code(404).send({ error: "unknown symbol" });
    const force = (req.query as { force?: string }).force === "1";
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
