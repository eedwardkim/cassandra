import { decodeEventLog, type Hex, type TransactionReceipt, type WalletClient } from "viem";
import { eq } from "drizzle-orm";
import { agentPolicyAbi, calibrationLedgerAbi, type Policy } from "@cassandra/shared";
import { db, schema } from "../db/index.js";
import { log } from "../bus.js";
import { agentAccount, agentWallet, chain, deployment, network, resolverWallet, policyContract, ledgerContract, publicClient, revertReason } from "./index.js";

const locks = new Map<WalletClient, Promise<unknown>>();
/** Serialize writes per wallet so nonces never collide. */
function serial<T>(w: WalletClient, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(w) ?? Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  locks.set(w, next);
  return next;
}

export interface Sent { hash: Hex; block: number; receipt: TransactionReceipt }

/** Simulate (surfaces revert reasons without spending gas), send, persist as pending, then wait for the receipt. */
async function send(w: WalletClient | null, kind: string, ref: string, req: { address: Hex; abi: readonly unknown[]; functionName: string; args: readonly unknown[] }): Promise<Sent> {
  if (!w || !deployment) throw new Error("chain not configured");
  return serial(w, async () => {
    const { request } = await publicClient.simulateContract(Object.assign({}, req, { account: w.account! }) as never);
    const hash = await w.writeContract(Object.assign({}, request as object, { chain }) as never);
    db.insert(schema.chainTxs).values({ hash, network, kind, ref, state: "pending", createdAt: Date.now() }).onConflictDoNothing().run();
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
    const state = receipt.status === "success" ? "confirmed" : "failed";
    db.update(schema.chainTxs).set({ state, block: Number(receipt.blockNumber) }).where(eq(schema.chainTxs.hash, hash)).run();
    if (state === "failed") throw new Error(`${kind} reverted on-chain: ${hash}`);
    return { hash, block: Number(receipt.blockNumber), receipt };
  });
}

export async function commitForecast(marketKey: Hex, commitment: Hex, ref: string) {
  const sent = await send(agentWallet, "commit", ref, { ...ledgerContract(), functionName: "commit", args: [marketKey, commitment] });
  const ev = sent.receipt.logs.map((l) => { try { return decodeEventLog({ abi: calibrationLedgerAbi, ...l }); } catch { return null; } }).find((e) => e?.eventName === "Committed");
  const id = ev && ev.eventName === "Committed" ? Number(ev.args.id) : null;
  if (id == null) throw new Error("Committed event missing from receipt");
  return { ...sent, onchainId: id };
}
export const revealForecast = (id: number, pBps: number, rHash: Hex, salt: Hex, ref: string) =>
  send(agentWallet, "reveal", ref, { ...ledgerContract(), functionName: "reveal", args: [BigInt(id), pBps, rHash, salt] });

export async function resolveMarket(marketKey: Hex, outcomeYes: boolean, ref: string) {
  const sent = await send(resolverWallet, "resolve", ref, { ...ledgerContract(), functionName: "resolve", args: [marketKey, outcomeYes] });
  const scored = sent.receipt.logs.flatMap((l) => { try { const e = decodeEventLog({ abi: calibrationLedgerAbi, ...l }); return e.eventName === "Scored" ? [{ id: Number(e.args.id), brierBps2: Number(e.args.brierBps2) }] : []; } catch { return []; } });
  return { ...sent, scored };
}

/** Reserve budget on AgentPolicy before any order exists. A revert means no order may be sent. */
export async function authorizeTrade(marketKey: Hex, notionalCents: number, edgeBps: number, category: number, clientOrderIdHash: Hex, ref: string) {
  try {
    const sent = await send(agentWallet, "authorizeTrade", ref, { ...policyContract(), functionName: "authorizeTrade", args: [marketKey, BigInt(notionalCents), Math.max(0, Math.min(65535, edgeBps)), category, clientOrderIdHash] });
    return { ok: true as const, ...sent };
  } catch (err) {
    return { ok: false as const, reason: revertReason(err).replace(/^PolicyViolation: /, "") };
  }
}

export const settleTrade = (tradeId: number, orderIdHash: Hex, filledNotionalCents: number, ref: string) =>
  send(agentWallet, "settleTrade", ref, { ...policyContract(), functionName: "settleTrade", args: [BigInt(tradeId), orderIdHash, BigInt(filledNotionalCents)] });

export async function policyOwner(): Promise<Hex> {
  return publicClient.readContract({ ...policyContract(), functionName: "owner" });
}

export async function getPolicy(): Promise<Policy & { spentTodayCents: number }> {
  const agent = agentAccount!.address;
  const [p, spent] = await Promise.all([
    publicClient.readContract({ ...policyContract(), functionName: "policies", args: [agent] }),
    publicClient.readContract({ ...policyContract(), functionName: "spentToday", args: [agent] }),
  ]);
  const [maxNotionalPerTrade, maxDailyNotional, minEdgeBps, allowedCategoryMask, paused] = p;
  return { maxNotionalPerTrade: Number(maxNotionalPerTrade), maxDailyNotional: Number(maxDailyNotional), minEdgeBps, allowedCategoryMask, paused, spentTodayCents: Number(spent) };
}

export async function calibration() {
  const [count, sum, mean] = await publicClient.readContract({ ...ledgerContract(), functionName: "calibration", args: [agentAccount!.address] });
  return { count, brierSumBps2: Number(sum), meanBrierBps2: Number(mean) };
}

/** On boot: settle any tx left pending by a crash. Never resend; look the receipt up instead. */
export async function reconcilePending() {
  const pending = db.select().from(schema.chainTxs).where(eq(schema.chainTxs.state, "pending")).all().filter((t) => t.network === network);
  for (const t of pending) {
    try {
      const r = await publicClient.getTransactionReceipt({ hash: t.hash as Hex });
      db.update(schema.chainTxs).set({ state: r.status === "success" ? "confirmed" : "failed", block: Number(r.blockNumber) }).where(eq(schema.chainTxs.hash, t.hash)).run();
      log("info", `reconciled ${t.kind} ${t.hash} → ${r.status}`);
    } catch {
      const age = Date.now() - t.createdAt;
      if (age > 10 * 60_000) db.update(schema.chainTxs).set({ state: "failed" }).where(eq(schema.chainTxs.hash, t.hash)).run();
    }
  }
}
export { agentPolicyAbi };
