import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient, createWalletClient, fallback, http, BaseError, ContractFunctionRevertedError,
  type Hex, type Address, type PublicClient, type WalletClient, type Chain, type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet, foundry } from "viem/chains";
import { agentPolicyAbi, calibrationLedgerAbi } from "@cassandra/shared";
import { config } from "../config.js";

export interface Deployment {
  network: "bscTestnet" | "local"; chainId: number; ledger: Address; policy: Address; owner: Address; agent: Address;
  deployBlock: number; txs: Record<string, Hex>; deployedAt: string;
}

export const network = config.chain.network;
export const chain: Chain = network === "local" ? foundry : bscTestnet;
export const explorerTx = (h: string) => (network === "local" ? null : `https://testnet.bscscan.com/tx/${h}`);
export const deploymentFile = (n: string) => join(config.deploymentsDir, `${n}.json`);

export function loadDeployment(n: string = network): Deployment | null {
  const f = deploymentFile(n);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as Deployment) : null;
}

const transport = network === "local"
  ? http(config.chain.localRpcUrl)
  : fallback([http(config.chain.rpcUrl, { retryCount: 2 }), http(config.chain.rpcFallback, { retryCount: 2 })]);

export const publicClient: PublicClient = createPublicClient({ chain, transport, pollingInterval: network === "local" ? 500 : 1500 });
/** Resolves markets on CalibrationLedger. It is NOT the AgentPolicy owner unless the deploy chose so; policy writes are signed by the human's wallet in the browser. */
export const resolverAccount: Account | null = config.chain.resolverKey ? privateKeyToAccount(config.chain.resolverKey) : null;
export const agentAccount: Account | null = config.chain.agentKey ? privateKeyToAccount(config.chain.agentKey) : null;
const wallet = (a: Account | null): WalletClient | null => (a ? createWalletClient({ account: a, chain, transport }) : null);
export const resolverWallet = wallet(resolverAccount);
export const agentWallet = wallet(agentAccount);

export const deployment = loadDeployment();
export const chainLive = !config.chain.dryRun && !!deployment && !!resolverWallet && !!agentWallet;

/** Pull the revert reason string out of a viem error (e.g. PolicyViolation("daily notional limit reached")). */
export function revertReason(err: unknown): string {
  if (err instanceof BaseError) {
    const r = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (r instanceof ContractFunctionRevertedError) {
      const args = r.data?.args;
      return args?.length ? `${r.data?.errorName}: ${String(args[0])}` : (r.data?.errorName ?? r.shortMessage);
    }
    return err.shortMessage;
  }
  return (err as Error).message;
}

export const isRevert = (err: unknown) => err instanceof BaseError && !!err.walk((e) => e instanceof ContractFunctionRevertedError);

export const ledgerContract = () => ({ address: deployment!.ledger, abi: calibrationLedgerAbi });
export const policyContract = () => ({ address: deployment!.policy, abi: agentPolicyAbi });

export async function blockNumber(): Promise<number | null> {
  try { return Number(await publicClient.getBlockNumber()); } catch { return null; }
}

export async function balances(): Promise<{ owner: string | null; agent: string | null }> {
  const f = async (a: Account | null) => (a ? (Number(await publicClient.getBalance({ address: a.address })) / 1e18).toFixed(4) : null);
  try { return { owner: await f(resolverAccount), agent: await f(agentAccount) }; } catch { return { owner: null, agent: null }; }
}
