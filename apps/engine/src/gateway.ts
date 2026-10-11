/**
 * The only module that holds the Gemini API secret or sends orders.
 * An order goes out only for a TradeAuthorized event read back from the chain, never on a caller's word.
 */
import { createClient, HmacAuth } from "@gemini-markets/sdk/server";
import { decodeEventLog, keccak256, toBytes, type Hex } from "viem";
import { and, eq } from "drizzle-orm";
import { agentPolicyAbi } from "@cassandra/shared";
import { config } from "./config.js";
import { log } from "./bus.js";
import { db, schema } from "./db/index.js";
import { deployment, network, publicClient } from "./chain/index.js";
import { fromBps, json, orderHistory } from "./gemini/index.js";

type Client = Awaited<ReturnType<typeof createClient>>;
let clientP: Promise<Client> | null = null;
export function client(): Promise<Client> {
  if (config.gemini.dryRun) throw new Error("Gemini is in fixture mode");
  clientP ??= createClient({
    env: "sandbox",
    auth: new HmacAuth({ apiKey: config.gemini.apiKey, apiSecret: process.env.GEMINI_API_SECRET ?? "", nonceMode: "time-based" }),
    skipWsInit: true,
  });
  return clientP;
}

export interface PlacedOrder { orderId: string; status: string; filledQuantity: string; clientOrderId: string; raw: unknown }

async function placeIoc(p: { symbol: string; outcome: "yes" | "no"; priceBps: number; quantity: number; clientOrderId: string }): Promise<PlacedOrder> {
  const c = await client();
  const input = {
    symbol: p.symbol, orderType: "limit" as const, side: "buy" as const, outcome: p.outcome, quantity: String(p.quantity),
    price: fromBps(p.priceBps), timeInForce: "immediate-or-cancel" as const, makerOrCancel: false, clientOrderId: p.clientOrderId, account: config.gemini.account,
  };
  let r;
  try {
    r = await c.predictions.placeOrder(input);
  } catch (err) {
    const e = err as { name?: string; field?: string; rule?: string; message?: string };
    if (!/AcceptTerms/i.test(`${e.name} ${e.message}`)) {
      if (e.name === "ValidationError") log("error", `Gemini ValidationError field=${e.field} rule=${e.rule}`);
      throw err;
    }
    log("warn", "Gemini terms not accepted; accepting once and retrying");
    await c.predictions.acceptTerms({ account: config.gemini.account } as never);
    r = await c.predictions.placeOrder(input);
  }
  const o = r as unknown as { orderId: bigint | string; status: string; filledQuantity?: string };
  return { orderId: String(o.orderId), status: o.status, filledQuantity: o.filledQuantity ?? "0", clientOrderId: p.clientOrderId, raw: JSON.parse(json(r)) };
}

/** Place the IOC order that a confirmed authorizeTrade transaction reserved budget for. */
export async function placeAuthorized(authorizeTx: Hex): Promise<PlacedOrder | null> {
  if (config.gemini.dryRun) throw new Error("Gemini is in fixture mode; no orders are placed");
  const receipt = await publicClient.getTransactionReceipt({ hash: authorizeTx });
  if (receipt.status !== "success") throw new Error(`authorization ${authorizeTx} did not succeed`);
  const ev = receipt.logs
    .filter((l) => l.address.toLowerCase() === deployment!.policy.toLowerCase())
    .map((l) => { try { return decodeEventLog({ abi: agentPolicyAbi, ...l }); } catch { return null; } })
    .find((e) => e?.eventName === "TradeAuthorized");
  if (!ev || ev.eventName !== "TradeAuthorized") throw new Error("receipt carries no TradeAuthorized event");
  const { tradeId, marketKey, notional, clientOrderIdHash } = ev.args;
  const row = db.select().from(schema.trades).where(and(eq(schema.trades.network, network), eq(schema.trades.authorizeTx, authorizeTx))).get();
  if (!row) throw new Error("no stored trade for this authorization");
  if (keccak256(toBytes(row.clientOrderId)) !== clientOrderIdHash) throw new Error("clientOrderId does not match the authorized hash");
  if (keccak256(toBytes(row.symbol)) !== marketKey) throw new Error("market does not match the authorized marketKey");
  if (BigInt(Math.ceil((row.quantity * row.priceBps) / 100)) > notional) throw new Error("order notional exceeds the authorized notional");
  // claim the on-chain tradeId; the unique index rejects a second order for the same authorization
  db.update(schema.trades).set({ onchainTradeId: Number(tradeId), state: "placing", updatedAt: Date.now() }).where(eq(schema.trades.id, row.id)).run();
  try {
    return await placeIoc({ symbol: row.symbol, outcome: row.outcome as "yes" | "no", priceBps: row.priceBps, quantity: row.quantity, clientOrderId: row.clientOrderId });
  } catch (err) {
    // never resend: look the order up by clientOrderId first
    const found = (await orderHistory(row.symbol).catch(() => [])).find((o) => o.clientOrderId === row.clientOrderId);
    if (found) return { orderId: found.orderId, status: found.status, filledQuantity: found.filledQuantity ?? "0", clientOrderId: row.clientOrderId, raw: found };
    throw err;
  }
}
