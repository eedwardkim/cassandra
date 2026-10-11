import { clamp, round } from "./math.js";
import { last, quiet, type Detector } from "./types.js";
/** Sum of implied probabilities minus 1. Exclusive events: sum of YES mids across siblings; binary: YES ask + NO ask. */
export const overround: Detector = ({ contract, ticks, siblings }) => {
  const t = last(ticks);
  if (!t) return quiet("overround", "No ticks yet.");
  let sum: number; let legs: number;
  if (contract.exclusive && siblings.length >= 2) {
    sum = siblings.reduce((a, s) => a + s.midBps, 0) / 10000; legs = siblings.length;
  } else if (t.askBps != null && t.noAskBps != null) {
    sum = (t.askBps + t.noAskBps) / 10000; legs = 2;
  } else return quiet("overround", "Need both a YES ask and a NO ask.");
  const score = clamp((sum - 1.02) / 0.1);
  const magnitudeBps = Math.round((sum - 1) * 10000);
  return {
    kind: "overround", score, direction: score > 0 ? "overpriced" : "n/a", magnitudeBps,
    evidence: { impliedSum: round(sum, 4), legs },
    explanation: `Implied probabilities across ${legs} legs sum to ${(sum * 100).toFixed(1)}%, a ${(magnitudeBps / 100).toFixed(1)}-point overround.`,
  };
};
