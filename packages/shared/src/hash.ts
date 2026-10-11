import { encodeAbiParameters, keccak256, toBytes, type Hex } from "viem";

/** Deterministic JSON: sorted keys, no whitespace. Anyone can recompute reasoningHash from /api/forecasts/:id. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).filter((k) => obj[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}
export const reasoningHash = (personas: unknown, judge: unknown): Hex => keccak256(toBytes(canonicalJson({ judge, personas })));
export const marketKey = (symbol: string): Hex => keccak256(toBytes(symbol));
export const commitmentHash = (mKey: Hex, probabilityBps: number, rHash: Hex, salt: Hex): Hex =>
  keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "uint16" }, { type: "bytes32" }, { type: "bytes32" }], [mKey, probabilityBps, rHash, salt]));
export const orderIdHash = (orderId: string): Hex => keccak256(toBytes(orderId));
