"use client";
import { useSyncExternalStore } from "react";
import { createPublicClient, createWalletClient, custom, http, type Address, type Chain, type Hex } from "viem";
import { bscTestnet } from "viem/chains";
import { agentPolicyAbi } from "@cassandra/shared/abi";
import { ENGINE } from "./api";

type Eth = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown>; on?: (e: string, f: (x: unknown) => void) => void };
declare global { interface Window { ethereum?: Eth } }

const localChain: Chain = { id: 31337, name: "Cassandra local (anvil)", nativeCurrency: { name: "Test ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [`${ENGINE}/rpc`] } } };
export const chainFor = (network?: string): Chain => (network === "local" ? localChain : bscTestnet);
const reader = (network?: string) => createPublicClient({ chain: chainFor(network), transport: http(network === "local" ? `${ENGINE}/rpc` : undefined) });

let state: { address: Address | null; error: string | null } = { address: null, error: null };
const subs = new Set<() => void>();
const set = (s: Partial<typeof state>) => { state = { ...state, ...s }; subs.forEach((f) => f()); };
export const useWallet = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => state, () => state);
export const sameAddress = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

async function useChain(eth: Eth, chain: Chain) {
  const chainId = `0x${chain.id.toString(16)}`;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch {
    await eth.request({ method: "wallet_addEthereumChain", params: [{ chainId, chainName: chain.name, nativeCurrency: chain.nativeCurrency, rpcUrls: chain.rpcUrls.default.http, blockExplorerUrls: chain.blockExplorers ? [chain.blockExplorers.default.url] : undefined }] });
  }
}

export async function connectWallet(network?: string) {
  const eth = window.ethereum;
  if (!eth) { set({ error: "No browser wallet found. Install MetaMask or Rabby, then reload." }); return null; }
  try {
    const [address] = (await eth.request({ method: "eth_requestAccounts" })) as Address[];
    await useChain(eth, chainFor(network));
    eth.on?.("accountsChanged", (a) => set({ address: ((a as Address[])[0] ?? null) }));
    set({ address: address ?? null, error: null });
    // local anvil only: the engine tops up a new wallet once so it can pay gas
    if (network === "local" && address && (await reader(network).getBalance({ address })) === BigInt(0)) {
      await fetch(`${ENGINE}/api/faucet-local`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address }) });
    }
    return address ?? null;
  } catch (e) {
    set({ error: (e as Error).message.split("\n")[0] ?? "wallet error" });
    return null;
  }
}

/** The connected wallet signs and sends the AgentPolicy write itself; the engine never sees it. */
export async function ownerWrite(network: string | undefined, policy: string, functionName: "setPolicy" | "setPaused", args: readonly unknown[]): Promise<Hex> {
  const chain = chainFor(network);
  const wallet = createWalletClient({ chain, transport: custom(window.ethereum!) });
  const [account] = await wallet.getAddresses();
  if (!account) throw new Error("Connect a wallet first");
  const hash = await wallet.writeContract({ account, chain, address: policy as Address, abi: agentPolicyAbi, functionName, args } as never);
  const r = await reader(network).waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`Transaction reverted: ${hash}`);
  return hash;
}
