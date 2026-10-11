import { clamp, round, std } from "./math.js";
import { last, quiet, type Detector } from "./types.js";
const H = 60 * 60 * 1000;
const at = (ticks: { ts: number; midBps: number }[], ts: number) => {
  let best: { ts: number; midBps: number } | undefined;
  for (const t of ticks) { if (t.ts <= ts) best = t; else break; }
  return best;
};
/** A 60-minute move above 2σ of the day's 60-minute moves while the forecast stayed near the old price. */
export const recencyShock: Detector = ({ ticks, council }) => {
  const now = last(ticks);
  if (!now || ticks.length < 3) return quiet("recencyShock", "Not enough history.");
  const first = ticks[0]!;
  if (now.ts - first.ts < 2 * H) return quiet("recencyShock", "Needs at least two hours of ticks.", { hours: round((now.ts - first.ts) / H, 2) });
  const changes: number[] = [];
  for (let ts = first.ts + H; ts <= now.ts; ts += 5 * 60 * 1000) {
    const a = at(ticks, ts - H), b = at(ticks, ts);
    if (a && b) changes.push(b.midBps - a.midBps);
  }
  const sigma = Math.max(std(changes), 50);
  const before = at(ticks, now.ts - H)!;
  const move = now.midBps - before.midBps;
  const ratio = Math.abs(move) / sigma;
  const councilMove = council ? Math.abs(council.pBps - before.midBps) : null;
  const evidence: Record<string, number> = { move60Bps: move, sigma60Bps: round(sigma, 1), sigmas: round(ratio, 2) };
  if (councilMove != null) evidence.councilMoveBps = councilMove;
  if (ratio <= 2) return quiet("recencyShock", `60-minute move of ${(move / 100).toFixed(1)} points is ${ratio.toFixed(1)}σ; threshold is 2σ.`, evidence);
  if (councilMove != null && councilMove >= Math.abs(move) / 2) return quiet("recencyShock", "Large move, but the forecast moved with it.", evidence);
  const score = clamp((ratio - 2) / 2) * (council ? 1 : 0.5);
  return {
    kind: "recencyShock", score, direction: move > 0 ? "overpriced" : "underpriced", magnitudeBps: Math.abs(move), evidence,
    explanation: `Price moved ${(move / 100).toFixed(1)} points in 60 minutes (${ratio.toFixed(1)}σ)${councilMove != null ? ` while the forecast moved ${(councilMove / 100).toFixed(1)}` : ""}.`,
  };
};
