import { describe, expect, it } from "vitest";
import type { Tick } from "../src/schemas.js";
import {
  composite, edgeBps, favoriteLongshot, herding, horizonNeglect, overround, recencyShock, roundNumberAnchoring, spectrometer, wishfulThinking,
  type BiasInput,
} from "../src/bias/index.js";

const T0 = Date.parse("2026-10-11T00:00:00Z");
const tick = (ts: number, midBps: number, extra: Partial<Tick> = {}): Tick => ({
  symbol: "GEMI-TEST-YES", ts, bidBps: midBps - 100, askBps: midBps + 100, noAskBps: 10000 - midBps + 100, midBps, lastBps: midBps, volume: 1000, source: "live", ...extra,
});
const base = (over: Partial<BiasInput> = {}): BiasInput => ({
  contract: { symbol: "GEMI-TEST-YES", category: "economics", expiryDate: "2026-10-30T00:00:00Z", exclusive: false },
  ticks: [tick(T0, 5000)], siblings: [], council: null, liquidityScore: 1, now: T0, ...over,
});
// deterministic pseudo-random walk
const lcg = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);

describe("overround", () => {
  it("fires when an exclusive event's YES mids sum well above 1", () => {
    const s = overround(base({ contract: { ...base().contract, exclusive: true }, siblings: [{ symbol: "A", midBps: 4500 }, { symbol: "B", midBps: 4000 }, { symbol: "C", midBps: 2500 }] }));
    expect(s.evidence.impliedSum).toBeCloseTo(1.1);
    expect(s.score).toBeCloseTo(0.8);
    expect(s.direction).toBe("overpriced");
  });
  it("stays quiet on a tight binary book", () => {
    const s = overround(base({ ticks: [tick(T0, 5000, { askBps: 5050, noAskBps: 5050 })] }));
    expect(s.score).toBe(0);
  });
});

describe("favoriteLongshot", () => {
  it("fires on an overpriced longshot", () => {
    const s = favoriteLongshot(base({ ticks: [tick(T0, 1200)], council: { pBps: 500, loBps: 300, hiBps: 900 } }));
    expect(s.score).toBeGreaterThan(0.9);
    expect(s.direction).toBe("overpriced");
    expect(s.magnitudeBps).toBe(700);
  });
  it("stays quiet mid-range and when the gap runs against the pattern", () => {
    expect(favoriteLongshot(base({ ticks: [tick(T0, 5000)], council: { pBps: 3000, loBps: 2000, hiBps: 4000 } })).score).toBe(0);
    expect(favoriteLongshot(base({ ticks: [tick(T0, 1200)], council: { pBps: 2000, loBps: 1500, hiBps: 2500 } })).score).toBe(0);
  });
});

describe("roundNumberAnchoring", () => {
  it("fires when most distinct prices land on 5-point marks", () => {
    const mids = [4500, 5000, 4500, 5500, 5000, 4500, 5000, 4700, 5000, 5500, 4500, 5000];
    const s = roundNumberAnchoring(base({ ticks: mids.map((m, i) => tick(T0 + i * 5000, m)) }));
    expect(s.score).toBeGreaterThan(0.5);
  });
  it("stays quiet when marks appear at the chance rate", () => {
    const mids = [4100, 4200, 4300, 4400, 4500, 4600, 4700, 4800, 4900, 5000, 5100, 5200, 5300, 5400, 5500];
    expect(roundNumberAnchoring(base({ ticks: mids.map((m, i) => tick(T0 + i * 5000, m)) })).score).toBe(0);
  });
});

describe("herding", () => {
  it("fires on a long one-way trend", () => {
    const mids = Array.from({ length: 30 }, (_, i) => 3000 + i * 50 + (i % 3 === 0 ? 10 : 0));
    const s = herding(base({ ticks: mids.map((m, i) => tick(T0 + i * 5000, m)) }));
    expect(s.score).toBeGreaterThan(0.5);
    expect(s.direction).toBe("overpriced");
  });
  it("stays quiet on mean-reverting noise", () => {
    const mids = Array.from({ length: 40 }, (_, i) => 5000 + (i % 2 === 0 ? 100 : -100) + (i % 5));
    expect(herding(base({ ticks: mids.map((m, i) => tick(T0 + i * 5000, m)) })).score).toBe(0);
  });
});

describe("recencyShock", () => {
  const day = (jumpBps: number) => {
    const rnd = lcg(7); const ticks: Tick[] = []; let m = 5000;
    for (let ts = T0; ts <= T0 + 24 * 3600e3; ts += 5 * 60e3) {
      m += Math.round((rnd() - 0.5) * 40);
      ticks.push(tick(ts, ts > T0 + 23.5 * 3600e3 ? m + jumpBps : m));
    }
    return ticks;
  };
  it("fires on a 60-minute jump the forecast ignored", () => {
    const ticks = day(1500);
    const before = ticks[ticks.length - 13]!.midBps;
    const s = recencyShock(base({ ticks, council: { pBps: before + 100, loBps: before - 500, hiBps: before + 600 } }));
    expect(s.score).toBeGreaterThan(0.5);
    expect(s.direction).toBe("overpriced");
  });
  it("stays quiet on an ordinary day", () => {
    expect(recencyShock(base({ ticks: day(0), council: { pBps: 5000, loBps: 4000, hiBps: 6000 } })).score).toBe(0);
  });
});

describe("wishfulThinking", () => {
  const sports = { ...base().contract, category: "sports" as const };
  it("fires when the crowd overprices the popular side in sports", () => {
    const s = wishfulThinking(base({ contract: sports, ticks: [tick(T0, 7500)], council: { pBps: 6000, loBps: 5000, hiBps: 7000 } }));
    expect(s.score).toBeGreaterThan(0.6);
    expect(s.explanation).toMatch(/^Possible/);
  });
  it("stays quiet outside politics and sports", () => {
    expect(wishfulThinking(base({ ticks: [tick(T0, 7500)], council: { pBps: 6000, loBps: 5000, hiBps: 7000 } })).score).toBe(0);
  });
});

describe("horizonNeglect", () => {
  const far = { ...base().contract, expiryDate: "2027-06-01T00:00:00Z" };
  it("fires on a far-dated near-certainty with a wide interval", () => {
    const s = horizonNeglect(base({ contract: far, ticks: [tick(T0, 9200)], council: { pBps: 8000, loBps: 5500, hiBps: 9500 } }));
    expect(s.score).toBeCloseTo(0.6);
  });
  it("stays quiet when resolution is near", () => {
    expect(horizonNeglect(base({ ticks: [tick(T0, 9200)], council: { pBps: 8000, loBps: 5500, hiBps: 9500 } })).score).toBe(0);
  });
});

describe("composite and edge", () => {
  it("combines weighted scores as 1 − Π(1 − w·s)", () => {
    const sig = (kind: "overround" | "favoriteLongshot", score: number) => ({ kind, score, direction: "n/a" as const, magnitudeBps: 0, evidence: {}, explanation: "" });
    expect(composite([sig("overround", 1), sig("favoriteLongshot", 1)])).toBeCloseTo(100 * (1 - 0.75 * 0.75));
    expect(composite([])).toBe(0);
  });
  it("subtracts half the spread and a 100 bps fee buffer", () => {
    expect(edgeBps(5100, 6200, 6100, 6300)).toBe(1100 - 100 - 100);
    expect(edgeBps(6200, 6200, 6100, 6300)).toBe(-200);
  });
  it("marks a report tradeable only above the policy's minimum edge with liquidity", () => {
    const input = base({ ticks: [tick(T0, 6200)], council: { pBps: 5100, loBps: 4500, hiBps: 5800 } });
    expect(spectrometer(input, 300).tradeable).toBe(true);
    expect(spectrometer(input, 1000).tradeable).toBe(false);
    expect(spectrometer({ ...input, liquidityScore: 0.1 }, 300).tradeable).toBe(false);
  });
});
