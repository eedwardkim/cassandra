"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { api, pct, BIAS_NAMES, type Ledger, type MarketSummary, offline } from "@/lib/api";
import { Ticker } from "@/components/Ticker";
import { useEvents, useStream } from "@/components/stream";
import { Badge, Num } from "@/components/ui";

const closesIn = (iso: string | null) => {
  if (!iso) return null;
  const m = Math.round((Date.parse(iso) - Date.now()) / 60_000);
  if (m <= 0) return "Closed";
  return m < 60 ? `Closes in ${m}m` : m < 2880 ? `Closes in ${Math.round(m / 60)}h` : `Closes in ${Math.round(m / 1440)}d`;
};
const gapOf = (m: MarketSummary) => (m.councilBps != null && m.tick ? (m.councilBps - m.tick.midBps) / 100 : null);

export default function Home() {
  const [markets, setMarkets] = useState<MarketSummary[] | null>(null);
  const [index, setIndex] = useState<number | null>(null);
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [cat, setCat] = useState("All");
  const [err, setErr] = useState<string | null>(null);
  const { caps } = useStream();
  const load = useCallback(() => {
    api<MarketSummary[]>("/api/markets").then((m) => { setMarkets(m); setErr(null); }).catch((e: Error) => setErr(e.message));
    api<{ value: number | null }>("/api/index").then((i) => setIndex(i.value)).catch(() => {});
    api<Ledger>("/api/ledger").then(setLedger).catch(() => {});
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);
  useEvents((e) => {
    if (e.type === "tick") setMarkets((ms) => ms?.map((m) => (m.symbol === e.symbol && m.tick && m.tick.midBps !== e.midBps ? { ...m, tick: { ...m.tick, midBps: e.midBps, ts: e.ts } } : m)) ?? ms);
    if (e.type === "bias.update") setMarkets((ms) => ms?.map((m) => (m.symbol === e.report.symbol ? { ...m, irrationality: e.report.irrationality, edgeBps: e.report.edgeBps, topSignature: e.report.signatures.find((s) => s.score > 0) ?? null } : m)) ?? ms);
    if (e.type === "council.final") setMarkets((ms) => ms?.map((m) => (m.symbol === e.symbol ? { ...m, councilBps: e.forecast.pBps, forecastId: e.forecast.id } : m)) ?? ms);
    if (e.type === "index.update") setIndex(e.value);
  });
  const cats = useMemo(() => ["All", ...new Set((markets ?? []).map((m) => m.category))], [markets]);
  const sorted = [...(markets ?? [])].filter((m) => cat === "All" || m.category === cat).sort((a, b) => (b.irrationality ?? 0) - (a.irrationality ?? 0));
  const top = sorted[0];
  const brier = ledger?.onchain && ledger.onchain.count > 0 ? Number(ledger.onchain.meanBrierBps2) / 1e8 : null;

  return (
    <div className="mx-auto max-w-[1280px] px-4 pb-16 pt-10 sm:px-6">
      <section className="grid gap-8 lg:grid-cols-[1fr_420px] lg:items-end">
        <div>
          <h1 className="display fluid-hero max-w-2xl">AI forecasts you can audit, on Gemini prediction markets.</h1>
          <p className="mt-3 max-w-xl text-[0.95rem] leading-relaxed text-muted">Four AI forecasters debate each Gemini market. Their probability is sealed on-chain before the market resolves, then scored. The agent trades the gap only inside limits you set.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {top && <Link href={`/m/${top.symbol}`} className="rounded-lg bg-ink px-4 py-2.5 text-sm font-medium text-white hover:bg-ink/85">Open the most mispriced market</Link>}
            <Link href="/ledger" className="rounded-lg border border-hairline bg-white px-4 py-2.5 text-sm font-medium hover:border-ink/30">See the track record</Link>
          </div>
        </div>
        <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-hairline bg-white">
          <Stat label="Markets tracked" value={markets?.length ?? null} />
          <Stat label="Forecasts sealed" value={ledger?.counts.sealed ?? null} />
          <Stat label="Market irrationality" value={index} fmt={(v) => `${v.toFixed(0)} / 100`} />
          <Stat label="Mean Brier score" value={brier} fmt={(v) => v.toFixed(3)} hint={brier == null ? "after first resolution" : "lower is better"} />
        </dl>
      </section>

      <div className="mt-10 grid gap-6 lg:grid-cols-[1fr_320px]">
        <section>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1">
              {cats.map((c) => <button key={c} onClick={() => setCat(c)} className={`rounded-full px-3 py-1.5 text-sm font-medium capitalize ${cat === c ? "bg-ink text-white" : "text-muted hover:bg-surface-2 hover:text-ink"}`}>{c}</button>)}
            </div>
            <span className="text-xs text-muted">Sorted by how mispriced the bias engine thinks they are{caps && caps.gemini.mode !== "live" ? " · " : ""}{caps && caps.gemini.mode !== "live" && <Badge kind="fixture">fixture prices</Badge>}</span>
          </div>
          {markets === null && !err && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="skeleton h-44 rounded-xl" />)}</div>}
          {err && <div className="rounded-xl border border-hairline bg-white p-8 text-center text-sm text-muted">{offline(err)}</div>}
          {markets?.length === 0 && <div className="rounded-xl border border-hairline bg-white p-8 text-center text-sm text-muted">No markets tracked yet. The engine picks the most liquid sandbox markets on boot.</div>}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {sorted.map((m, i) => <MarketCard key={m.symbol} m={m} i={i} />)}
          </div>
        </section>
        <aside className="h-fit overflow-hidden rounded-xl border border-hairline bg-white lg:sticky lg:top-20">
          <div className="flex items-center justify-between px-4 pt-4 pb-2"><h2 className="text-[0.95rem] font-semibold">Live activity</h2><span className="flex items-center gap-1.5 text-xs text-muted"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-scored" />streaming</span></div>
          <div className="h-[560px]"><Ticker /></div>
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, fmt = (v: number) => v.toFixed(0), hint }: { label: string; value: number | null; fmt?: (v: number) => string; hint?: string }) {
  return (
    <div className="border-hairline p-4 [&:nth-child(-n+2)]:border-b [&:nth-child(odd)]:border-r">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tracking-tight"><Num value={value} format={fmt} /></dd>
      {hint && <dd className="text-[0.7rem] text-muted">{hint}</dd>}
    </div>
  );
}

function MarketCard({ m, i }: { m: MarketSummary; i: number }) {
  const gap = gapOf(m);
  const sig = m.topSignature;
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 12) * 0.03 } }}>
      <Link href={`/m/${m.symbol}`} className="flex h-full flex-col rounded-xl border border-hairline bg-white p-4 transition-shadow hover:border-ink/20 hover:shadow-[0_2px_12px_rgba(16,24,40,0.06)]">
        <div className="flex items-center justify-between text-xs text-muted"><span className="capitalize">{m.category}</span><span>{closesIn(m.expiryDate)}</span></div>
        <div className="mt-2 line-clamp-2 text-[0.95rem] font-medium leading-snug">{m.title}</div>
        <div className="text-sm text-muted">{m.label}</div>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="rounded-lg bg-surface-2 px-3 py-2"><div className="text-[0.7rem] text-muted">Market</div><div className="num text-lg font-semibold">{pct(m.tick?.midBps, 0)}</div></div>
          <div className="rounded-lg bg-orange-50 px-3 py-2"><div className="text-[0.7rem] text-oracle/80">Cassandra</div><div className="num text-lg font-semibold text-oracle">{pct(m.councilBps, 0)}</div></div>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="truncate text-muted">{sig ? `${BIAS_NAMES[sig.kind]}${sig.magnitudeBps ? ` · ${(sig.magnitudeBps / 100).toFixed(1)} pts` : ""}` : "No bias detected"}</span>
          {gap != null && Math.abs(gap) >= 0.5 && <span className={`num shrink-0 font-medium ${gap > 0 ? "text-scored" : "text-refused"}`}>{gap > 0 ? "+" : ""}{gap.toFixed(1)} pts</span>}
        </div>
      </Link>
    </motion.div>
  );
}
