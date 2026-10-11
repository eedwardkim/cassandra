import type { BiasReport, Signature, SignatureKind } from "../schemas.js";
import { clamp } from "./math.js";
import { favoriteLongshot } from "./favoriteLongshot.js";
import { herding } from "./herding.js";
import { horizonNeglect } from "./horizonNeglect.js";
import { overround } from "./overround.js";
import { recencyShock } from "./recencyShock.js";
import { roundNumberAnchoring } from "./roundNumberAnchoring.js";
import { wishfulThinking } from "./wishfulThinking.js";
import { last, type BiasInput } from "./types.js";

export * from "./math.js";
export type { BiasInput } from "./types.js";
export { favoriteLongshot, herding, horizonNeglect, overround, recencyShock, roundNumberAnchoring, wishfulThinking };

export const WEIGHTS: Record<SignatureKind, number> = {
  overround: 0.25, favoriteLongshot: 0.25, recencyShock: 0.2, herding: 0.1, wishfulThinking: 0.1, roundNumberAnchoring: 0.05, horizonNeglect: 0.05,
};
export const DETECTORS = [overround, favoriteLongshot, roundNumberAnchoring, herding, recencyShock, wishfulThinking, horizonNeglect];
export const FEE_BUFFER_BPS = 100;

export function composite(signatures: Signature[]): number {
  return 100 * (1 - signatures.reduce((acc, s) => acc * (1 - WEIGHTS[s.kind] * s.score), 1));
}

export function edgeBps(councilBps: number, midBps: number, bidBps: number | null, askBps: number | null): number {
  const halfSpread = bidBps != null && askBps != null ? (askBps - bidBps) / 2 : 0;
  return Math.round(Math.abs(councilBps - midBps) - halfSpread - FEE_BUFFER_BPS);
}

/** 0–1: resting depth in contracts (1 at 99+) times a spread penalty (0 at a 30-point spread). */
export function liquidityScore(depthContracts: number, bidBps: number | null, askBps: number | null): number {
  const depth = clamp(Math.log10(1 + Math.max(0, depthContracts)) / 2);
  const spread = bidBps != null && askBps != null ? askBps - bidBps : 3000;
  return clamp(depth * clamp(1 - spread / 3000));
}

export function spectrometer(input: BiasInput, minEdgeBps = 300): BiasReport {
  const t = last(input.ticks);
  if (!t) throw new Error(`no ticks for ${input.contract.symbol}`);
  const signatures = DETECTORS.map((d) => d(input));
  const edge = input.council ? edgeBps(input.council.pBps, t.midBps, t.bidBps, t.askBps) : 0;
  return {
    symbol: input.contract.symbol,
    ts: t.ts,
    midBps: t.midBps,
    irrationality: Math.round(composite(signatures) * 10) / 10,
    edgeBps: edge,
    tradeable: input.council != null && edge >= minEdgeBps && input.liquidityScore >= 0.3,
    liquidityScore: Math.round(input.liquidityScore * 1000) / 1000,
    councilBps: input.council?.pBps ?? null,
    signatures: signatures.sort((a, b) => WEIGHTS[b.kind] * b.score - WEIGHTS[a.kind] * a.score),
  };
}
