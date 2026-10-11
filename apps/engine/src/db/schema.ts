import { index, integer, real, sqliteTable, text, primaryKey } from "drizzle-orm/sqlite-core";

export const events = sqliteTable("events", {
  ticker: text("ticker").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category").notNull(),
  rawCategory: text("raw_category"),
  status: text("status").notNull(),
  volume: real("volume").notNull().default(0),
  expiryDate: text("expiry_date"),
  exclusive: integer("exclusive", { mode: "boolean" }).notNull().default(false),
  source: text("source").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const contracts = sqliteTable("contracts", {
  symbol: text("symbol").primaryKey(),
  eventTicker: text("event_ticker").notNull(),
  label: text("label").notNull(),
  category: text("category").notNull(),
  expiryDate: text("expiry_date"),
  status: text("status").notNull(),
  tracked: integer("tracked", { mode: "boolean" }).notNull().default(false),
  resolutionSide: text("resolution_side"),
  resolvedAt: text("resolved_at"),
  source: text("source").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const ticks = sqliteTable("ticks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull(),
  ts: integer("ts").notNull(),
  bidBps: integer("bid_bps"),
  askBps: integer("ask_bps"),
  noAskBps: integer("no_ask_bps"),
  midBps: integer("mid_bps").notNull(),
  lastBps: integer("last_bps"),
  volume: real("volume"),
  source: text("source").notNull(),
}, (t) => [index("ticks_symbol_ts").on(t.symbol, t.ts)]);

export const biasReports = sqliteTable("bias_reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull(),
  ts: integer("ts").notNull(),
  irrationality: real("irrationality").notNull(),
  edgeBps: integer("edge_bps").notNull(),
  json: text("json").notNull(),
}, (t) => [index("bias_symbol_ts").on(t.symbol, t.ts)]);

export const forecasts = sqliteTable("forecasts", {
  id: text("id").primaryKey(),
  symbol: text("symbol").notNull(),
  ts: integer("ts").notNull(),
  cacheKey: text("cache_key").notNull(),
  pBps: integer("p_bps").notNull(),
  loBps: integer("lo_bps").notNull(),
  hiBps: integer("hi_bps").notNull(),
  midBps: integer("mid_bps").notNull(),
  reasoningHash: text("reasoning_hash").notNull(),
  model: text("model").notNull(),
  source: text("source").notNull(),
  json: text("json").notNull(),
}, (t) => [index("forecasts_symbol_ts").on(t.symbol, t.ts), index("forecasts_cache").on(t.cacheKey)]);

export const commits = sqliteTable("commits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  forecastId: text("forecast_id").notNull(),
  symbol: text("symbol").notNull(),
  marketKey: text("market_key").notNull(),
  network: text("network").notNull(),
  chainId: integer("chain_id").notNull(),
  onchainId: integer("onchain_id"),
  probabilityBps: integer("probability_bps").notNull(),
  reasoningHash: text("reasoning_hash").notNull(),
  salt: text("salt").notNull(),
  commitment: text("commitment").notNull(),
  state: text("state").notNull(),
  commitTx: text("commit_tx"),
  commitBlock: integer("commit_block"),
  revealTx: text("reveal_tx"),
  outcomeYes: integer("outcome_yes", { mode: "boolean" }),
  brierBps2: integer("brier_bps2"),
  scoreTx: text("score_tx"),
  source: text("source").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const trades = sqliteTable("trades", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  symbol: text("symbol").notNull(),
  forecastId: text("forecast_id"),
  outcome: text("outcome").notNull(),
  side: text("side").notNull(),
  priceBps: integer("price_bps").notNull(),
  quantity: integer("quantity").notNull(),
  notionalCents: integer("notional_cents").notNull(),
  edgeBps: integer("edge_bps").notNull(),
  category: integer("category").notNull(),
  state: text("state").notNull(),
  reason: text("reason"),
  clientOrderId: text("client_order_id").notNull(),
  orderId: text("order_id"),
  orderStatus: text("order_status"),
  filledQuantity: text("filled_quantity"),
  recordTx: text("record_tx"),
  recordBlock: integer("record_block"),
  network: text("network").notNull(),
  source: text("source").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const indexHistory = sqliteTable("index_history", {
  ts: integer("ts").primaryKey(),
  value: real("value").notNull(),
  contracts: integer("contracts").notNull(),
});

export const agentRuns = sqliteTable("agent_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(),
  symbol: text("symbol"),
  ts: integer("ts").notNull(),
  status: text("status").notNull(),
  detail: text("detail"),
});

export const chainTxs = sqliteTable("chain_txs", {
  hash: text("hash").notNull(),
  network: text("network").notNull(),
  kind: text("kind").notNull(),
  ref: text("ref"),
  state: text("state").notNull(),
  block: integer("block"),
  createdAt: integer("created_at").notNull(),
}, (t) => [primaryKey({ columns: [t.hash, t.network] })]);
