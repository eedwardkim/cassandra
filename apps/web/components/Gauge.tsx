"use client";
import { motion, useReducedMotion } from "framer-motion";
import { Num } from "./ui";

/** Semicircle Irrationality Index with an eased needle and a 24 h sparkline. */
export function Gauge({ value, series }: { value: number | null; series: { ts: number; value: number }[] }) {
  const reduce = useReducedMotion();
  const v = Math.max(0, Math.min(100, value ?? 0));
  const angle = -90 + (v / 100) * 180;
  const r = 52, cx = 64, cy = 62;
  const arc = (a0: number, a1: number) => {
    const p = (a: number) => [cx + r * Math.cos(((a - 90) * Math.PI) / 180), cy + r * Math.sin(((a - 90) * Math.PI) / 180)];
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
  };
  const pts = series.slice(-288);
  const min = Math.min(...pts.map((p) => p.value), 0), max = Math.max(...pts.map((p) => p.value), 10);
  const spark = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${(i / Math.max(1, pts.length - 1)) * 120} ${22 - ((p.value - min) / Math.max(1, max - min)) * 20}`).join(" ");
  return (
    <div className="flex items-end gap-4">
      <svg width="128" height="72" viewBox="0 0 128 72" aria-label={`Irrationality Index ${v.toFixed(0)} of 100`}>
        <defs><linearGradient id="g-arc" x1="0" x2="1"><stop offset="0" stopColor="#5DD6F2" /><stop offset="1" stopColor="#F5B041" /></linearGradient></defs>
        <path d={arc(-90, 90)} stroke="rgba(255,255,255,0.08)" strokeWidth="6" fill="none" strokeLinecap="round" />
        <motion.path d={arc(-90, 90)} stroke="url(#g-arc)" strokeWidth="6" fill="none" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: v / 100 }} transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 40, damping: 14 }} />
        <motion.g style={{ originX: `${cx}px`, originY: `${cy}px` }} initial={{ rotate: -90 }} animate={{ rotate: angle }} transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 50, damping: 9 }}>
          <line x1={cx} y1={cy} x2={cx} y2={cy - r + 10} stroke="#E8E6E1" strokeWidth="1.5" strokeLinecap="round" />
        </motion.g>
        <circle cx={cx} cy={cy} r="3" fill="#E8E6E1" />
      </svg>
      <div className="pb-1">
        <div className="label">Irrationality Index</div>
        <div className="flex items-baseline gap-2"><Num value={value} format={(x) => x.toFixed(1)} className="text-3xl text-ink" /><span className="text-xs text-muted">/ 100</span></div>
        {pts.length > 1 ? <svg width="120" height="24" className="mt-1"><path d={spark} fill="none" stroke="#8B8F9A" strokeWidth="1" /></svg> : <div className="mt-1 text-[0.7rem] text-muted">24 h history builds every 60 s</div>}
      </div>
    </div>
  );
}
