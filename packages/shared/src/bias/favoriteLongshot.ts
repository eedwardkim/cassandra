import { clamp, logit, round } from "./math.js";
import { last, quiet, type Detector } from "./types.js";
/** Classic pattern: longshots (<20%) priced above the forecast, favorites (>80%) priced below it. */
export const favoriteLongshot: Detector = ({ ticks, council, liquidityScore }) => {
  const t = last(ticks);
  if (!t || !council) return quiet("favoriteLongshot", "Needs a council forecast.");
  const m = t.midBps / 10000, p = council.pBps / 10000;
  const longshot = m < 0.2 && m > p, favorite = m > 0.8 && m < p;
  const dLogit = logit(m) - logit(p);
  const evidence = { marketMid: round(m, 4), councilP: round(p, 4), deltaLogit: round(dLogit, 3), liquidity: round(liquidityScore, 2) };
  if (!longshot && !favorite) return quiet("favoriteLongshot", "Price is not in the longshot or favorite tail, or the gap runs against the classic pattern.", evidence);
  const score = clamp(Math.abs(dLogit) / 1.0) * liquidityScore;
  const gap = Math.abs(t.midBps - council.pBps);
  return {
    kind: "favoriteLongshot", score, direction: longshot ? "overpriced" : "underpriced", magnitudeBps: gap, evidence,
    explanation: longshot
      ? `Longshot at ${(m * 100).toFixed(1)}% against a forecast of ${(p * 100).toFixed(1)}%: ${(gap / 100).toFixed(1)} points of favorite-longshot bias (${Math.abs(dLogit).toFixed(2)} logits).`
      : `Favorite at ${(m * 100).toFixed(1)}% against a forecast of ${(p * 100).toFixed(1)}%: underpriced by ${(gap / 100).toFixed(1)} points (${Math.abs(dLogit).toFixed(2)} logits).`,
  };
};
