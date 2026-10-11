"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { api, pct, BIAS_NAMES, type MarketSummary } from "@/lib/api";
import { Field } from "@/components/Field";
import { Gauge } from "@/components/Gauge";
import { Ticker } from "@/components/Ticker";
import { useEvents, useStream } from "@/components/stream";
import { Badge, page } from "@/components/ui";

export default function Home() {
  const [markets, setMarkets] = useState<MarketSummary[] | null>(null);
  const [index, setIndex] = useState<{ value: number | null; series: { ts: number; value: number }[] }>({ value: null, series: [] });
  const [pulses, setPulses] = useState<Record<string, number>>({});
  const [err, setErr] = useState<string | null>(null);
  const { caps } = useStream();
  const load = useCallback(() => {
    api<MarketSummary[]>("/api/markets").then((m) => { setMarkets(m); setErr(null); }).catch((e: Error) => setErr(e.message));
    api<typeof index>("/api/index").then(setIndex).catch(() => {});
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  useEvents((e) => {
    if (e.type === "tick") {
      setPulses((p) => ({ ...p, [e.symbol]: performance.now() }));
      setMarkets((ms) => ms?.map((m) => (m.symbol === e.symbol && m.tick && m.tick.midBps !== e.midBps ? { ...m, tick: { ...m.tick, midBps: e.midBps, ts: e.ts } } : m)) ?? ms);
    }
    if (e.type === "bias.update") setMarkets((ms) => ms?.map((m) => (m.symbol === e.report.symbol ? { ...m, irrationality: e.report.irrationality, edgeBps: e.report.edgeBps, topSignature: e.report.signatures.find((s) => s.score > 0) ?? null } : m)) ?? ms);
    if (e.type === "council.final") setMarkets((ms) => ms?.map((m) => (m.symbol === e.symbol ? { ...m, councilBps: e.forecast.pBps, forecastId: e.forecast.id } : m)) ?? ms);
    if (e.type === "index.update") setIndex((i) => ({ value: e.value, series: [...i.series, { ts: e.ts, value: e.value }] }));
  });
  const sorted = [...(markets ?? [])].sort((a, b) => (b.irrationality ?? 0) - (a.irrationality ?? 0));

  return (
    <motion.div {...page} className="mx-auto max-w-[1500px] px-4 pb-10 pt-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="display fluid-hero text-ink">The Probability <span className="italic text-oracle">Field</span></h1>
          <p className="mt-2 max-w-xl text-sm text-muted">Every point is a live contract on Gemini&apos;s prediction-market sandbox. Cyan is a calm price; amber is a price the Bias Spectrometer can explain. A gold core means Cassandra has sealed a forecast.</p>
        </div>
        <div className="flex items-center gap-4">
          {caps && caps.gemini.mode !== "live" && <Badge kind="fixture">fixture prices</Badge>}
          <Gauge value={index.value} series={index.series} />
        </div>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="hair relative hidden h-[min(68vh,700px)] overflow-hidden rounded-lg bg-surface/40 md:block">
          {markets === null ? <FieldSkeleton err={err} /> : markets.length === 0 ? <Empty /> : <Field markets={markets} pulses={pulses} />}
        </div>
        <ol className="space-y-2 md:hidden">
          {markets === null && Array.from({ length: 6 }).map((_, i) => <li key={i} className="skeleton h-16 rounded-lg" />)}
          {sorted.map((m) => (
            <li key={m.symbol}><Link href={`/m/${m.symbol}`} className="hair flex items-center justify-between gap-3 rounded-lg bg-surface/80 px-3 py-2.5">
              <div className="min-w-0"><div className="truncate text-sm">{m.title}</div><div className="truncate text-xs text-muted">{m.label}{m.topSignature ? ` · ${BIAS_NAMES[m.topSignature.kind]}` : ""}</div></div>
              <div className="text-right text-xs"><div className="num text-crowd">{pct(m.tick?.midBps)}</div><div className="num text-oracle">{pct(m.councilBps)}</div></div>
            </Link></li>
          ))}
        </ol>
        <aside className="hair h-[min(68vh,700px)] overflow-hidden rounded-lg bg-surface/60"><Ticker /></aside>
      </div>

      {sorted.length > 0 && (
        <div className="mt-6 hidden md:block">
          <div className="label mb-2">Most irrational right now</div>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            {sorted.slice(0, 4).map((m, i) => (
              <motion.div key={m.symbol} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { delay: i * 0.04 } }}>
                <Link href={`/m/${m.symbol}`} className="hair block rounded-lg bg-surface/70 px-3 py-2.5 transition-colors hover:border-white/20">
                  <div className="truncate text-sm">{m.title}</div>
                  <div className="truncate text-xs text-muted">{m.label}</div>
                  <div className="mt-2 flex items-baseline justify-between text-xs">
                    <span className="num text-crowd">{pct(m.tick?.midBps)}</span>
                    <span className="text-muted">{m.topSignature ? BIAS_NAMES[m.topSignature.kind] : "no signature"}</span>
                    <span className="num">{m.irrationality?.toFixed(0) ?? "—"}<span className="text-muted">/100</span></span>
                  </div>
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function FieldSkeleton({ err }: { err: string | null }) {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="relative h-48 w-48">{Array.from({ length: 9 }).map((_, i) => <span key={i} className="skeleton absolute rounded-full" style={{ width: 18 + (i % 3) * 10, height: 18 + (i % 3) * 10, left: `${(i * 37) % 80}%`, top: `${(i * 53) % 80}%` }} />)}</div>
      <p className="absolute bottom-6 text-xs text-muted">{err ? `Engine unreachable (${err}). Start it with pnpm dev.` : "Awaiting first tick"}</p>
    </div>
  );
}
function Empty() {
  return <div className="absolute inset-0 grid place-items-center text-sm text-muted">No contracts tracked yet. The engine tracks the most liquid sandbox markets on boot.</div>;
}
