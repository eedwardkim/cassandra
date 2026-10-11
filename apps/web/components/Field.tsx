"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import * as d3 from "d3";
import { BIAS_NAMES, pct, type MarketSummary } from "@/lib/api";
import { Badge } from "./ui";

type Node = d3.SimulationNodeDatum & { m: MarketSummary; r: number; pulse: number };
const color = d3.interpolateRgb("#5DD6F2", "#F5B041");

/** Canvas force simulation of every tracked contract, clustered by category. */
export function Field({ markets, pulses }: { markets: MarketSummary[]; pulses: Record<string, number> }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<Node[]>([]);
  const pulsesRef = useRef(pulses);
  pulsesRef.current = pulses;
  const [hover, setHover] = useState<{ n: Node; x: number; y: number } | null>(null);
  const [size, setSize] = useState({ w: 900, h: 560 });
  const router = useRouter();
  const groups = useMemo(() => [...new Set(markets.map((m) => m.category))].sort(), [markets]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e!.contentRect.width, h: Math.max(420, e!.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const wells = useMemo(() => {
    const n = Math.max(1, groups.length);
    return Object.fromEntries(groups.map((g, i) => {
      const a = (i / n) * Math.PI * 2 - Math.PI / 2;
      const rad = n === 1 ? 0 : Math.min(size.w, size.h) * 0.24;
      return [g, { x: size.w / 2 + Math.cos(a) * rad * 1.3, y: size.h / 2 + Math.sin(a) * rad }];
    }));
  }, [groups, size]);

  useEffect(() => {
    const prev = new Map(nodesRef.current.map((n) => [n.m.symbol, n]));
    const nodes: Node[] = markets.map((m) => {
      const p = prev.get(m.symbol);
      const r = 6 + Math.log1p(Math.max(0, m.tick?.volume ?? m.depth ?? 0)) * 3.2;
      return p ? Object.assign(p, { m, r }) : { m, r, pulse: 0, x: wells[m.category]?.x ?? size.w / 2, y: wells[m.category]?.y ?? size.h / 2 };
    });
    nodesRef.current = nodes;
    const sim = d3.forceSimulation(nodes)
      .force("x", d3.forceX<Node>((d) => wells[d.m.category]?.x ?? size.w / 2).strength(0.07))
      .force("y", d3.forceY<Node>((d) => wells[d.m.category]?.y ?? size.h / 2).strength(0.07))
      .force("collide", d3.forceCollide<Node>((d) => d.r + 3))
      .alpha(prev.size ? 0.3 : 1).alphaDecay(0.03);
    const cv = canvas.current!;
    const dpr = window.devicePixelRatio || 1;
    cv.width = size.w * dpr; cv.height = size.h * dpr;
    const ctx = cv.getContext("2d")!;
    let raf = 0;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const draw = () => {
      const now = performance.now();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);
      for (const g of groups) {
        const w = wells[g]!;
        const grd = ctx.createRadialGradient(w.x, w.y, 0, w.x, w.y, 130);
        grd.addColorStop(0, "rgba(255,255,255,0.035)"); grd.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(w.x, w.y, 130, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "rgba(139,143,154,0.7)"; ctx.font = "500 10px var(--font-geist-sans), sans-serif"; ctx.textAlign = "center";
        ctx.fillText(g.toUpperCase().split("").join(" "), w.x, w.y - 118);
      }
      for (const n of nodes) {
        const irr = (n.m.irrationality ?? 0) / 100;
        const c = color(Math.min(1, irr * 1.6));
        const pt = pulsesRef.current[n.m.symbol];
        if (pt && !reduce) {
          const age = (now - pt) / 1200;
          if (age < 1) { ctx.strokeStyle = d3.color(c)!.copy({ opacity: 0.5 * (1 - age) }).formatRgb(); ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(n.x!, n.y!, n.r + 2 + age * 14, 0, Math.PI * 2); ctx.stroke(); }
        }
        ctx.fillStyle = d3.color(c)!.copy({ opacity: 0.18 }).formatRgb();
        ctx.beginPath(); ctx.arc(n.x!, n.y!, n.r, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = c; ctx.lineWidth = n.m.councilBps != null ? 1.6 : 0.8; ctx.stroke();
        if (n.m.councilBps != null) { ctx.fillStyle = "#F5B041"; ctx.beginPath(); ctx.arc(n.x!, n.y!, 2, 0, Math.PI * 2); ctx.fill(); }
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); sim.stop(); };
  }, [markets, wells, groups, size]);

  const pick = (ev: React.MouseEvent) => {
    const rect = canvas.current!.getBoundingClientRect();
    const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
    const n = nodesRef.current.find((d) => Math.hypot(d.x! - x, d.y! - y) <= d.r + 3);
    return n ? { n, x, y } : null;
  };

  return (
    <div ref={wrap} className="relative h-full min-h-[420px] w-full">
      <canvas ref={canvas} style={{ width: size.w, height: size.h }} className={hover ? "cursor-pointer" : ""}
        onMouseMove={(e) => setHover(pick(e))} onMouseLeave={() => setHover(null)}
        onClick={(e) => { const h = pick(e); if (h) router.push(`/m/${h.n.m.symbol}`); }} aria-label="Probability field of tracked Gemini contracts" role="img" />
      {hover && (
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="hair pointer-events-none absolute z-10 w-64 rounded-lg bg-surface/95 p-3 text-xs shadow-none backdrop-blur"
          style={{ left: Math.min(hover.x + 16, size.w - 270), top: Math.max(8, hover.y - 20) }}>
          <div className="text-[0.8rem] leading-snug text-ink">{hover.n.m.title}</div>
          <div className="mt-0.5 text-muted">{hover.n.m.label}</div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <div><div className="label">Market</div><div className="num text-crowd">{pct(hover.n.m.tick?.midBps)}</div></div>
            <div><div className="label">Cassandra</div><div className="num text-oracle">{pct(hover.n.m.councilBps)}</div></div>
            <div><div className="label">Irrational</div><div className="num">{hover.n.m.irrationality?.toFixed(0) ?? "—"}</div></div>
          </div>
          {hover.n.m.topSignature && <div className="mt-2 text-muted">Top bias <span className="text-ink">{BIAS_NAMES[hover.n.m.topSignature.kind]}</span> <span className="num">{(hover.n.m.topSignature.score * 100).toFixed(0)}/100</span></div>}
          {hover.n.m.source !== "live" && <div className="mt-2"><Badge kind="fixture">{hover.n.m.source}</Badge></div>}
        </motion.div>
      )}
    </div>
  );
}
