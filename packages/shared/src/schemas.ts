import { z } from "zod";

export const Bps = z.number().int().min(0).max(10000);
export const Source = z.enum(["live", "fixture", "replay"]);
export type Source = z.infer<typeof Source>;

export const Category = z.enum(["politics", "sports", "crypto", "economics", "commodities", "culture", "weather", "other"]);
export type Category = z.infer<typeof Category>;
export const CATEGORY_BITS: Record<Category, number> = {
  politics: 0, sports: 1, crypto: 2, economics: 3, commodities: 4, culture: 5, weather: 6, other: 7,
};

export const Event = z.object({
  ticker: z.string(),
  title: z.string(),
  category: Category,
  rawCategory: z.string(),
  type: z.string(),
  status: z.string(),
  description: z.string(),
  expiryDate: z.string().nullable(),
  volume: z.number(),
  volume24h: z.number(),
  exclusive: z.boolean(),
  sandboxListed: z.boolean(),
  source: Source,
});
export type Event = z.infer<typeof Event>;

export const Contract = z.object({
  symbol: z.string(),
  eventTicker: z.string(),
  label: z.string(),
  rules: z.string(),
  category: Category,
  expiryDate: z.string().nullable(),
  sandboxListed: z.boolean(),
  status: z.string(),
  resolutionSide: z.enum(["yes", "no"]).nullable(),
  resolvedAt: z.string().nullable(),
});
export type Contract = z.infer<typeof Contract>;

export const Tick = z.object({
  symbol: z.string(),
  ts: z.number().int(),
  bidBps: Bps.nullable(),
  askBps: Bps.nullable(),
  noAskBps: Bps.nullable(),
  midBps: Bps,
  lastBps: Bps.nullable(),
  volume: z.number().nullable(),
  source: Source,
});
export type Tick = z.infer<typeof Tick>;

export const SignatureKind = z.enum([
  "overround", "favoriteLongshot", "roundNumberAnchoring", "herding", "recencyShock", "wishfulThinking", "horizonNeglect",
]);
export type SignatureKind = z.infer<typeof SignatureKind>;

export const Signature = z.object({
  kind: SignatureKind,
  score: z.number().min(0).max(1),
  direction: z.enum(["overpriced", "underpriced", "n/a"]),
  magnitudeBps: z.number(),
  evidence: z.record(z.number()),
  explanation: z.string(),
});
export type Signature = z.infer<typeof Signature>;

export const BiasReport = z.object({
  symbol: z.string(),
  ts: z.number().int(),
  midBps: Bps,
  irrationality: z.number().min(0).max(100),
  edgeBps: z.number(),
  tradeable: z.boolean(),
  liquidityScore: z.number(),
  councilBps: Bps.nullable(),
  signatures: z.array(Signature),
});
export type BiasReport = z.infer<typeof BiasReport>;

export const PersonaName = z.enum(["actuary", "decomposer", "skeptic", "reporter"]);
export type PersonaName = z.infer<typeof PersonaName>;

export const PersonaOutput = z.object({
  probability: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  argument: z.string(),
  cruxes: z.array(z.string()).max(3),
});
export type PersonaOutput = z.infer<typeof PersonaOutput>;

export const JudgeOutput = z.object({
  probability: z.number().min(0).max(1),
  lo80: z.number().min(0).max(1),
  hi80: z.number().min(0).max(1),
  rationale: z.string(),
  whatWouldChangeMyMind: z.array(z.string()),
  biasHints: z.array(z.string()),
});
export type JudgeOutput = z.infer<typeof JudgeOutput>;

export const Forecast = z.object({
  id: z.string(),
  symbol: z.string(),
  createdAt: z.number().int(),
  marketMidBps: Bps,
  pBps: Bps,
  loBps: Bps,
  hiBps: Bps,
  personas: z.record(PersonaOutput),
  judge: JudgeOutput,
  reasoningHash: z.string(),
  model: z.string(),
  source: z.enum(["live", "dry-run", "replay"]),
});
export type Forecast = z.infer<typeof Forecast>;

export const ChainState = z.enum(["pending", "confirmed", "failed"]);

export const Commit = z.object({
  id: z.string(),
  forecastId: z.string(),
  symbol: z.string(),
  marketKey: z.string(),
  chainId: z.number().nullable(),
  ledgerId: z.number().nullable(),
  pBps: Bps,
  reasoningHash: z.string(),
  commitment: z.string(),
  salt: z.string().nullable(),
  commitTx: z.string().nullable(),
  commitBlock: z.number().nullable(),
  revealTx: z.string().nullable(),
  revealBlock: z.number().nullable(),
  scoreTx: z.string().nullable(),
  outcomeYes: z.boolean().nullable(),
  brierBps2: z.number().nullable(),
  state: z.enum(["pending", "sealed", "revealed", "scored", "failed"]),
  replay: z.boolean(),
  createdAt: z.number().int(),
});
export type Commit = z.infer<typeof Commit>;

export const Trade = z.object({
  id: z.string(),
  symbol: z.string(),
  forecastId: z.string().nullable(),
  createdAt: z.number().int(),
  outcome: z.enum(["yes", "no"]),
  priceBps: Bps,
  quantity: z.string(),
  notionalCents: z.number().int(),
  edgeBps: z.number().int(),
  category: Category,
  policyOk: z.boolean(),
  policyReason: z.string(),
  orderId: z.string().nullable(),
  orderStatus: z.string().nullable(),
  filledQuantity: z.string().nullable(),
  recordTx: z.string().nullable(),
  state: z.enum(["checking", "refused", "placing", "placed", "recorded", "failed"]),
  error: z.string().nullable(),
  source: Source,
});
export type Trade = z.infer<typeof Trade>;

export const Policy = z.object({
  maxNotionalPerTrade: z.number().int(),
  maxDailyNotional: z.number().int(),
  minEdgeBps: z.number().int(),
  allowedCategoryMask: z.number().int(),
  paused: z.boolean(),
});
export type Policy = z.infer<typeof Policy>;

export const Capabilities = z.object({
  gemini: z.object({ mode: z.enum(["live", "fixture"]), priceFeed: z.string(), orders: z.enum(["sandbox", "dry-run"]), events: z.number() }),
  llm: z.object({ mode: z.enum(["live", "dry-run"]), model: z.string() }),
  chain: z.object({ mode: z.enum(["live", "dry-run"]), network: z.string(), chainId: z.number(), block: z.number().nullable(), ledger: z.string().nullable(), policy: z.string().nullable(), agent: z.string().nullable(), owner: z.string().nullable() }),
  contextDev: z.boolean(),
  demoMode: z.boolean(),
});
export type Capabilities = z.infer<typeof Capabilities>;

export type StreamEvent =
  | { type: "tick"; symbol: string; midBps: number; ts: number }
  | { type: "bias.update"; report: BiasReport }
  | { type: "council.start"; symbol: string; runId: string; cached: boolean }
  | { type: "council.delta"; symbol: string; runId: string; persona: PersonaName | "judge"; text: string }
  | { type: "council.persona"; symbol: string; runId: string; persona: PersonaName; output: PersonaOutput }
  | { type: "council.final"; symbol: string; runId: string; forecast: Forecast }
  | { type: "council.error"; symbol: string; runId: string; message: string }
  | { type: "seal.pending"; commit: Commit }
  | { type: "seal.committed"; commit: Commit }
  | { type: "seal.revealed"; commit: Commit }
  | { type: "seal.scored"; commit: Commit }
  | { type: "policy.checked"; symbol: string; ok: boolean; reason: string; edgeBps: number; notionalCents: number }
  | { type: "trade.refused"; trade: Trade }
  | { type: "trade.placed"; trade: Trade }
  | { type: "trade.recorded"; trade: Trade }
  | { type: "policy.updated"; policy: Policy; txHash: string }
  | { type: "index.update"; value: number; ts: number }
  | { type: "block"; number: number }
  | { type: "log"; level: "info" | "warn" | "error"; message: string; ts: number };
