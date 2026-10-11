import type { Category, Signature, Tick } from "../schemas.js";
export interface BiasInput {
  contract: { symbol: string; category: Category; expiryDate: string | null; exclusive: boolean };
  ticks: Tick[];
  siblings: { symbol: string; midBps: number }[];
  council: { pBps: number; loBps: number; hiBps: number } | null;
  liquidityScore: number;
  now?: number;
}
export type Detector = (input: BiasInput) => Signature;
export const last = <T>(xs: T[]): T | undefined => xs[xs.length - 1];
export const quiet = (kind: Signature["kind"], explanation: string, evidence: Record<string, number> = {}): Signature => ({
  kind, score: 0, direction: "n/a", magnitudeBps: 0, evidence, explanation,
});
