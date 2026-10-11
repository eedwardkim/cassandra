import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// Local fallback for wallets generated outside the repo (never committed). Env always wins.
const keyFile = join(homedir(), ".cassandra", "keys.env");
if (existsSync(keyFile)) {
  for (const line of readFileSync(keyFile, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !isPrivateKey(process.env[m[1]!])) process.env[m[1]!] = m[2]!;
  }
}

function isPrivateKey(v: string | undefined): v is `0x${string}` {
  return !!v && /^0x[0-9a-fA-F]{64}$/.test(v.trim());
}
const bool = (v: string | undefined, d = false) => (v == null || v === "" ? d : /^(1|true|yes)$/i.test(v));
const num = (v: string | undefined, d: number) => (v == null || v === "" || Number.isNaN(Number(v)) ? d : Number(v));

const demo = bool(process.env.DEMO_MODE);
const llmKey = process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.OPENAI_API_KEY ? "openai" : null;

export const config = {
  port: num(process.env.PORT ?? process.env.ENGINE_PORT, 4000),
  demo,
  tickSeconds: demo ? 20 : num(process.env.TICK_SECONDS, 120),
  quoteSeconds: 5,
  revealDelaySeconds: num(process.env.REVEAL_DELAY_SECONDS, 0),
  councilMaxRunsPerHour: num(process.env.COUNCIL_MAX_RUNS_PER_HOUR, 40),
  trackedTarget: num(process.env.TRACKED_CONTRACTS, 24),
  dbPath: process.env.ENGINE_DB ?? new URL("../engine.db", import.meta.url).pathname,
  fixturesDir: new URL("../../../fixtures/", import.meta.url).pathname,
  deploymentsDir: process.env.DEPLOYMENTS_DIR ?? new URL("../../../packages/shared/deployments/", import.meta.url).pathname,
  gemini: {
    apiKey: process.env.GEMINI_API_KEY ?? "",
    account: process.env.GEMINI_ACCOUNT ?? "primary",
    dryRun: bool(process.env.DRY_RUN_GEMINI) || !process.env.GEMINI_API_KEY,
  },
  llm: {
    provider: llmKey,
    model: process.env.LLM_MODEL ?? (llmKey === "openai" ? "gpt-5" : "claude-sonnet-5-5"),
    dryRun: bool(process.env.DRY_RUN_LLM) || !llmKey,
  },
  contextDevKey: process.env.CONTEXT_DEV_API_KEY ?? "",
  chain: {
    network: (process.env.CHAIN_NETWORK ?? "bscTestnet") as "bscTestnet" | "local",
    rpcUrl: process.env.BSC_TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.bnbchain.org:8545",
    rpcFallback: "https://bsc-testnet-rpc.publicnode.com",
    localRpcUrl: process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545",
    ownerKey: isPrivateKey(process.env.OWNER_PRIVATE_KEY) ? (process.env.OWNER_PRIVATE_KEY.trim() as `0x${string}`) : null,
    resolverKey: isPrivateKey(process.env.RESOLVER_PRIVATE_KEY) ? (process.env.RESOLVER_PRIVATE_KEY.trim() as `0x${string}`) : isPrivateKey(process.env.OWNER_PRIVATE_KEY) ? (process.env.OWNER_PRIVATE_KEY.trim() as `0x${string}`) : null,
    ownerAddress: /^0x[0-9a-fA-F]{40}$/.test(process.env.OWNER_ADDRESS ?? "") ? (process.env.OWNER_ADDRESS as `0x${string}`) : null,
    agentKey: isPrivateKey(process.env.AGENT_PRIVATE_KEY) ? (process.env.AGENT_PRIVATE_KEY.trim() as `0x${string}`) : null,
    dryRun: bool(process.env.DRY_RUN_CHAIN),
  },
};
export type Config = typeof config;
