import { changePoints, clamp, mean, round } from "./math.js";
import { quiet, type Detector } from "./types.js";
/** Momentum beyond a martingale: lag-1 autocorrelation of price changes plus the longest same-sign run. */
export const herding: Detector = ({ ticks }) => {
  const mids = changePoints(ticks.map((t) => t.midBps));
  const r = mids.slice(1).map((m, i) => m - mids[i]!);
  const n = r.length;
  if (n < 10) return quiet("herding", `Only ${n} price changes; need 10.`, { n });
  const mu = mean(r);
  const den = r.reduce((a, x) => a + (x - mu) ** 2, 0);
  let num = 0; for (let i = 1; i < n; i++) num += (r[i]! - mu) * (r[i - 1]! - mu);
  const rho = den === 0 ? 0 : num / den;
  let longest = 1, run = 1;
  for (let i = 1; i < n; i++) { run = Math.sign(r[i]!) === Math.sign(r[i - 1]!) ? run + 1 : 1; longest = Math.max(longest, run); }
  const zRho = rho * Math.sqrt(n);
  const zRun = (longest - Math.log2(n)) / 1.87;
  const z = (zRho + zRun) / Math.SQRT2;
  const score = clamp((z - 1) / 3);
  let tail = 0; const lastSign = Math.sign(r[n - 1]!); for (let i = n - 1; i >= 0 && Math.sign(r[i]!) === lastSign; i--) tail += r[i]!;
  return {
    kind: "herding", score, direction: score > 0 ? (lastSign > 0 ? "overpriced" : "underpriced") : "n/a", magnitudeBps: Math.abs(tail),
    evidence: { n, rho: round(rho, 3), longestRun: longest, expectedRun: round(Math.log2(n), 2), z: round(z, 2) },
    explanation: `Lag-1 autocorrelation ${rho.toFixed(2)} and a ${longest}-move same-direction run (a random walk expects about ${Math.log2(n).toFixed(1)}): z = ${z.toFixed(1)}.`,
  };
};
