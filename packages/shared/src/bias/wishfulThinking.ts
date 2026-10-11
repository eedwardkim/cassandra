import { clamp, round } from "./math.js";
import { last, quiet, type Detector } from "./types.js";
/** Politics and sports only: the market leans toward the side it already favors by more than 6 points against the forecast. */
export const wishfulThinking: Detector = ({ contract, ticks, council }) => {
  if (contract.category !== "politics" && contract.category !== "sports") return quiet("wishfulThinking", "Only applies to politics and sports.");
  const t = last(ticks);
  if (!t || !council) return quiet("wishfulThinking", "Needs a council forecast.");
  const m = t.midBps / 10000, p = council.pBps / 10000;
  const favoredYes = m >= 0.5;
  const lean = favoredYes ? m - p : p - m;
  const evidence = { marketMid: round(m, 4), councilP: round(p, 4), leanBps: Math.round(lean * 10000) };
  if (lean <= 0.06) return quiet("wishfulThinking", "No lean toward the popular side beyond 6 points.", evidence);
  return {
    kind: "wishfulThinking", score: clamp((lean - 0.06) / 0.14), direction: favoredYes ? "overpriced" : "underpriced", magnitudeBps: Math.round(lean * 10000), evidence,
    explanation: `Possible: the crowd prices the popular side ${(lean * 100).toFixed(1)} points above the forecast.`,
  };
};
