"use client";
import { useMemo, useRef, useState, useEffect } from "react";
import * as d3 from "d3";
import { BIAS_NAMES, type BiasReport, type Forecast, type Tick } from "@/lib/api";

const LONG = "#1cada6", SHORT = "#ef4444", GOLD = "#f0c14b", GRID = "rgba(255,255,255,0.06)", AXIS = "#71717a";

interface Candle { t: number; o: number; h: number; l: number; c: number }

/** Market mid as candles (bucketed from stored quotes), Cassandra's forecast as a dashed line with its 80% band. */
export function PriceChart({ ticks, forecast, bias, height = 380 }: { ticks: Tick[]; forecast: Forecast | null; bias: BiasReport | null; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useEffect(() => { const ro = new ResizeObserver(([e]) => setW(e!.contentRect.width)); if (ref.current) ro.observe(ref.current); return () => ro.disconnect(); }, []);
  const h = height, m = { t: 12, r: 58, b: 26, l: 6 };
  const { candles, x, y, bw } = useMemo(() => {
    const ts = ticks.filter((t) => t.midBps != null);
    const span = ts.length > 1 ? ts.at(-1)!.ts - ts[0]!.ts : 60_000;
    const step = Math.max(60_000, Math.ceil(span / 70 / 60_000) * 60_000);
    const by = new Map<number, Candle>();
    for (const t of ts) {
      const k = Math.floor(t.ts / step) * step, v = t.midBps / 100;
      const c = by.get(k);
      if (!c) by.set(k, { t: k, o: v, h: v, l: v, c: v });
      else { c.h = Math.max(c.h, v); c.l = Math.min(c.l, v); c.c = v; }
    }
    const candles = [...by.values()].sort((a, b) => a.t - b.t);
    const t0 = candles[0]?.t ?? Date.now() - 3600_000, t1 = (candles.at(-1)?.t ?? Date.now()) + step;
    const x = d3.scaleTime().domain([t0, t1]).range([m.l, w - m.r]);
    const vals = candles.flatMap((c) => [c.h, c.l]);
    if (forecast) vals.push(forecast.pBps / 100, forecast.loBps / 100, forecast.hiBps / 100);
    const lo = Math.min(...vals, 100), hi = Math.max(...vals, 0);
    const pad = Math.max(2, (hi - lo) * 0.08);
    const y = d3.scaleLinear().domain([Math.max(0, lo - pad), Math.min(100, hi + pad)]).range([h - m.b, m.t]).nice();
    const bw = Math.max(2, Math.min(10, ((w - m.l - m.r) / Math.max(candles.length, 1)) * 0.65));
    return { candles, x, y, bw };
  }, [ticks, forecast, w, h, m.b, m.l, m.r, m.t]);
  const last = candles.at(-1);
  const up = last ? last.c >= (candles[0]?.o ?? last.c) : true;
  const flags = (bias?.signatures ?? []).filter((s) => s.score > 0.15).slice(0, 4);
  const tag = (v: number, fill: string, text: string, dark = false) => (
    <g transform={`translate(${w - m.r + 2},${y(v) - 9})`}><rect width={m.r - 4} height={18} rx={2} fill={fill} /><text x={(m.r - 4) / 2} y={12.5} textAnchor="middle" fontSize="10.5" fontWeight={600} fill={dark ? "#0a0a0a" : "#fff"} className="num">{text}</text></g>
  );
  return (
    <div ref={ref} className="w-full">
      {candles.length === 0 ? <div className="skeleton rounded" style={{ height: h }} /> : (
        <svg width={w} height={h}>
          {y.ticks(6).map((v) => (<g key={v}><line x1={m.l} x2={w - m.r} y1={y(v)} y2={y(v)} stroke={GRID} /><text x={w - m.r + 8} y={y(v) + 3} fontSize="10" fill={AXIS} className="num">{v.toFixed(1)}</text></g>))}
          {x.ticks(6).filter((t) => x(t) > m.l + 18 && x(t) < w - m.r - 18).map((t) => <text key={+t} x={x(t)} y={h - 8} fontSize="10" fill={AXIS} textAnchor="middle" className="num">{d3.timeFormat("%H:%M")(t)}</text>)}
          {forecast && <rect x={m.l} width={w - m.l - m.r} y={y(forecast.hiBps / 100)} height={Math.max(1, y(forecast.loBps / 100) - y(forecast.hiBps / 100))} fill="rgba(240,193,75,0.06)" />}
          {candles.map((c) => {
            const col = c.c >= c.o ? LONG : SHORT, cx = x(c.t) + bw / 2;
            return (<g key={c.t}>
              <line x1={cx} x2={cx} y1={y(c.h)} y2={y(c.l)} stroke={col} />
              <rect x={cx - bw / 2} width={bw} y={y(Math.max(c.o, c.c))} height={Math.max(1, Math.abs(y(c.o) - y(c.c)))} fill={col} />
            </g>);
          })}
          {last && <line x1={m.l} x2={w - m.r} y1={y(last.c)} y2={y(last.c)} stroke={up ? LONG : SHORT} strokeDasharray="1 3" />}
          {forecast && <line x1={m.l} x2={w - m.r} y1={y(forecast.pBps / 100)} y2={y(forecast.pBps / 100)} stroke={GOLD} strokeDasharray="5 4" />}
          {flags.map((s, i) => {
            const fx = m.l + 8 + i * 16;
            return (<path key={s.kind} d={`M${fx} ${h - m.b - 2} l5 -8 l5 8 z`} fill={GOLD} fillOpacity={0.35 + s.score * 0.6}><title>{BIAS_NAMES[s.kind]}: {s.explanation}</title></path>);
          })}
          {last && tag(last.c, up ? LONG : SHORT, last.c.toFixed(1))}
          {forecast && tag(forecast.pBps / 100, GOLD, (forecast.pBps / 100).toFixed(1), true)}
        </svg>
      )}
    </div>
  );
}
