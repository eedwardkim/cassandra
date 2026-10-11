import { changePoints, clamp, round } from "./math.js";
import { quiet, type Detector } from "./types.js";
const TICK_BPS = 100; // Gemini prediction contracts trade in 1-cent increments
/** Share of recent distinct prices on 5-point marks versus the share a uniform 1-cent grid predicts (1 in 5). */
export const roundNumberAnchoring: Detector = ({ ticks }) => {
  const prices = changePoints(ticks.map((t) => Math.round((t.lastBps ?? t.midBps) / TICK_BPS) * TICK_BPS)).slice(-50);
  const n = prices.length;
  if (n < 8) return quiet("roundNumberAnchoring", `Only ${n} distinct prices; need 8.`, { n });
  const expected = TICK_BPS / 500;
  const share = prices.filter((p) => p % 500 === 0).length / n;
  const z = (share - expected) / Math.sqrt((expected * (1 - expected)) / n);
  const score = clamp((z - 1) / 3);
  return {
    kind: "roundNumberAnchoring", score, direction: "n/a", magnitudeBps: 0,
    evidence: { n, share: round(share, 3), expected, z: round(z, 2) },
    explanation: `${(share * 100).toFixed(0)}% of the last ${n} distinct prices sit on 5-point marks versus ${(expected * 100).toFixed(0)}% by chance (z = ${z.toFixed(1)}).`,
  };
};
