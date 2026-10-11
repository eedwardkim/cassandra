import { clamp, round } from "./math.js";
import { last, quiet, type Detector } from "./types.js";
/** Far-dated contracts priced near certainty while the forecast interval is wide. */
export const horizonNeglect: Detector = ({ contract, ticks, council, now }) => {
  const t = last(ticks);
  if (!t || !council || !contract.expiryDate) return quiet("horizonNeglect", "Needs a forecast and an expiry date.");
  const days = (Date.parse(contract.expiryDate) - (now ?? t.ts)) / 86_400_000;
  const m = t.midBps / 10000, width = council.hiBps - council.loBps;
  const evidence = { daysToResolution: round(days, 1), marketMid: round(m, 4), intervalBps: width };
  if (days <= 60 || (m <= 0.85 && m >= 0.15) || width <= 2500) return quiet("horizonNeglect", "Not a far-dated, near-certain price with a wide forecast interval.", evidence);
  return {
    kind: "horizonNeglect", score: clamp((width - 2500) / 2500), direction: m > 0.85 ? "overpriced" : "underpriced", magnitudeBps: Math.round(Math.abs(m - council.pBps / 10000) * 10000), evidence,
    explanation: `${Math.round(days)} days out and priced at ${(m * 100).toFixed(0)}%, yet the forecast's 80% interval spans ${(width / 100).toFixed(0)} points.`,
  };
};
