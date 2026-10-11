"use client";
import { useMemo, useRef, useState, useEffect } from "react";
import * as d3 from "d3";
import { BIAS_NAMES, type BiasReport, type Forecast, type Tick } from "@/lib/api";

/** 24 h market line (cyan), council point + 80% band (amber), bias flags on the time axis. */
export function PriceChart({ ticks, forecast, bias }: { ticks: Tick[]; forecast: Forecast | null; bias: BiasReport | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(360);
  useEffect(() => { const ro = new ResizeObserver(([e]) => setW(e!.contentRect.width)); if (ref.current) ro.observe(ref.current); return () => ro.disconnect(); }, []);
  const h = 260, m = { t: 14, r: 40, b: 30, l: 8 };
  const { x, y, line, area } = useMemo(() => {
    const now = Date.now();
    const t0 = ticks.length ? Math.min(ticks[0]!.ts, forecast?.createdAt ?? Infinity) : now - 3600_000;
    const x = d3.scaleTime().domain([t0, Math.max(now, ticks.at(-1)?.ts ?? now)]).range([m.l, w - m.r]);
    const y = d3.scaleLinear().domain([0, 100]).range([h - m.b, m.t]);
    const line = d3.line<Tick>().x((d) => x(d.ts)).y((d) => y(d.midBps / 100)).curve(d3.curveStepAfter)(ticks) ?? "";
    const area = d3.area<Tick>().x((d) => x(d.ts)).y0((d) => y((d.bidBps ?? d.midBps) / 100)).y1((d) => y((d.askBps ?? d.midBps) / 100)).curve(d3.curveStepAfter)(ticks) ?? "";
    return { x, y, line, area };
  }, [ticks, forecast, w]);
  const flags = (bias?.signatures ?? []).filter((s) => s.score > 0.15).slice(0, 4);
  return (
    <div ref={ref} className="w-full">
      {ticks.length === 0 ? <div className="skeleton h-[260px] rounded" /> : (
        <svg width={w} height={h} className="overflow-visible">
          {[0, 25, 50, 75, 100].map((v) => (<g key={v}><line x1={m.l} x2={w - m.r} y1={y(v)} y2={y(v)} stroke="rgba(16,24,40,0.1)" /><text x={w - m.r + 6} y={y(v) + 3} fontSize="10" fill="#667085" className="num">{v}%</text></g>))}
          {x.ticks(4).map((t) => <text key={+t} x={x(t)} y={h - 10} fontSize="10" fill="#667085" textAnchor="middle" className="num">{d3.timeFormat("%H:%M")(t)}</text>)}
          <path d={area} fill="rgba(59,91,219,0.08)" />
          <path d={line} fill="none" stroke="#3B5BDB" strokeWidth="1.5" />
          {forecast && (() => {
            const fx = Math.min(x(forecast.createdAt), w - m.r - 4);
            return (<g>
              <rect x={fx - 5} width={10} y={y(forecast.hiBps / 100)} height={Math.max(2, y(forecast.loBps / 100) - y(forecast.hiBps / 100))} fill="rgba(229,83,10,0.18)" rx="2" />
              <circle cx={fx} cy={y(forecast.pBps / 100)} r="4.5" fill="#E5530A" />
              <text x={fx - 8} y={y(forecast.pBps / 100) + 4} textAnchor="end" fontSize="11" fill="#E5530A" className="num">{(forecast.pBps / 100).toFixed(0)}%</text>
            </g>);
          })()}
          {flags.map((s, i) => {
            const fx = w - m.r - 6 - i * 16;
            return (<g key={s.kind}><line x1={fx} x2={fx} y1={h - m.b} y2={h - m.b - 16} stroke="#E5530A" strokeOpacity="0.6" /><path d={`M${fx} ${h - m.b - 16} l7 3 l-7 3 z`} fill="#E5530A" fillOpacity={0.4 + s.score * 0.6}><title>{BIAS_NAMES[s.kind]}: {s.explanation}</title></path></g>);
          })}
        </svg>
      )}
    </div>
  );
}
