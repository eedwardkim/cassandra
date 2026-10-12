"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, pct, marketLabel, BIAS_NAMES, type Ledger, type MarketSummary, type StreamEvent, offline } from "@/lib/api";
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
const strike = (label: string) => Number(label.replace(/[^0-9.]/g, "")) || 0;
const asset = (e: string) => e.match(/^[A-Z]+/)?.[0] ?? e.slice(0, 3);

interface Group { ticker: string; title: string; category: string; expiryDate: string | null; markets: MarketSummary[]; score: number }

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
  const groups = useMemo(() => {
    const by = new Map<string, Group>();
    for (const m of markets ?? []) {
      if (cat !== "All" && m.category !== cat) continue;
      const g = by.get(m.eventTicker) ?? { ticker: m.eventTicker, title: m.title, category: m.category, expiryDate: m.expiryDate, markets: [], score: 0 };
      g.markets.push(m);
      g.score = Math.max(g.score, m.irrationality ?? 0, Math.abs(gapOf(m) ?? 0));
      by.set(m.eventTicker, g);
    }
    for (const g of by.values()) g.markets.sort((a, b) => strike(a.label) - strike(b.label));
    return [...by.values()].sort((a, b) => b.score - a.score);
  }, [markets, cat]);
  const top = useMemo(() => {
    const withGap = (markets ?? []).filter((m) => gapOf(m) != null).sort((a, b) => Math.abs(gapOf(b)!) - Math.abs(gapOf(a)!));
    return withGap[0] ?? [...(markets ?? [])].sort((a, b) => (b.irrationality ?? 0) - (a.irrationality ?? 0))[0];
  }, [markets]);
  const brier = ledger?.onchain && ledger.onchain.count > 0 ? Number(ledger.onchain.meanBrierBps2) / 1e8 : null;
  const seed = useMemo<StreamEvent[]>(() => (ledger?.commits ?? []).slice(0, 18).map((c) => ({ type: c.state === "scored" ? "seal.scored" : c.state === "revealed" ? "seal.revealed" : "seal.committed", commit: c })), [ledger]);
  const fixture = caps && caps.gemini.mode !== "live";

  return (
    <div className="px-3 pb-10 pt-3 sm:px-4">
      <section className="flex flex-wrap items-center gap-x-10 gap-y-3 rounded-md border border-hairline bg-surface px-4 py-3">
        <div className="mr-auto min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">Markets</h1>
          <p className="text-xs text-muted">Gemini sandbox prediction markets. Cassandra's forecast is recorded on-chain before each market closes.</p>
        </div>
        <Stat label="Forecasts sealed" value={ledger?.counts.sealed ?? null} />
        <Stat label="Scored on-chain" value={ledger?.onchain?.count ?? ledger?.counts.scored ?? null} />
        <Stat label="Mean Brier" value={brier} fmt={(v) => v.toFixed(3)} />
        <Stat label="Market irrationality" value={index} fmt={(v) => v.toFixed(0)} suffix="/100" />
        {top && <Link href={`/m/${top.symbol}`} className="rounded-md bg-long px-3 py-2 text-xs font-semibold text-bg hover:bg-long/85">Largest gap: {marketLabel(top.symbol)}</Link>}
      </section>

      <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0 overflow-hidden rounded-md border border-hairline bg-surface">
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-4">
            <div className="flex gap-5">
              {cats.map((c) => <button key={c} onClick={() => setCat(c)} className={`-mb-px border-b-2 py-2.5 text-sm capitalize ${cat === c ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}>{c}</button>)}
            </div>
            {fixture && <Badge kind="fixture">fixture prices</Badge>}
          </div>
          {markets === null && !err && <div className="space-y-1 p-3">{Array.from({ length: 10 }).map((_, i) => <div key={i} className="skeleton h-8 rounded" />)}</div>}
          {err && <div className="p-8 text-center text-sm text-muted">{offline(err)}</div>}
          {markets?.length === 0 && <div className="p-8 text-center text-sm text-muted">No markets tracked yet. The engine picks the most liquid sandbox markets on boot.</div>}
          {groups.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="text-[0.7rem] text-muted">
                    <th className="py-2 pl-4 text-left font-normal">Market</th>
                    <th className="py-2 text-right font-normal">Market</th>
                    <th className="py-2 text-right font-normal">Cassandra</th>
                    <th className="py-2 text-right font-normal">Gap</th>
                    <th className="py-2 text-right font-normal">Bid / Ask</th>
                    <th className="py-2 text-right font-normal">Irrationality</th>
                    <th className="py-2 pr-4 text-right font-normal">Flag</th>
                  </tr>
                </thead>
                {groups.map((g) => <EventRows key={g.ticker} g={g} />)}
              </table>
            </div>
          )}
        </section>
        <aside className="h-fit overflow-hidden rounded-md border border-hairline bg-surface lg:sticky lg:top-[6.5rem]">
          <Ticker seed={seed} />
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, fmt = (v: number) => v.toFixed(0), suffix }: { label: string; value: number | null; fmt?: (v: number) => string; suffix?: string }) {
  return (
    <div>
      <dt className="text-[0.7rem] text-muted">{label}</dt>
      <dd className="num text-[0.95rem] font-semibold"><Num value={value} format={fmt} />{suffix && value != null && <span className="ml-0.5 text-xs font-normal text-muted">{suffix}</span>}</dd>
    </div>
  );
}

function EventRows({ g }: { g: Group }) {
  return (
    <tbody className="border-t border-hairline">
      <tr className="bg-surface-2/50">
        <td colSpan={7} className="px-4 py-1.5">
          <div className="flex items-center gap-2.5 text-xs">
            <span className="grid h-5 w-5 place-items-center rounded-full bg-hairline text-[0.55rem] font-semibold">{asset(g.ticker).slice(0, 3)}</span>
            <span className="font-medium text-ink">{g.title}</span>
            <span className="text-muted">{closesIn(g.expiryDate)}</span>
          </div>
        </td>
      </tr>
      {g.markets.map((m) => {
        const gap = gapOf(m);
        const t = m.tick;
        return (
          <tr key={m.symbol} className="group cursor-pointer hover:bg-white/[0.03]">
            <td className="py-0 pl-4"><Link href={`/m/${m.symbol}`} className="block py-2 pl-7 font-medium group-hover:text-long">{marketLabel(m.symbol)}</Link></td>
            <td className="num py-2 text-right"><Link href={`/m/${m.symbol}`}>{pct(t?.midBps ?? null, 1)}</Link></td>
            <td className="num py-2 text-right"><Link href={`/m/${m.symbol}`} className={m.councilBps != null ? "text-oracle" : "text-muted/50"}>{m.councilBps != null ? pct(m.councilBps, 1) : "—"}</Link></td>
            <td className={`num py-2 text-right ${gap == null || Math.abs(gap) < 0.5 ? "text-muted/50" : gap > 0 ? "text-long" : "text-short"}`}>{gap == null ? "—" : `${gap > 0 ? "+" : ""}${gap.toFixed(1)}`}</td>
            <td className="num py-2 text-right text-muted"><span className="text-long">{t?.bidBps != null ? (t.bidBps / 100).toFixed(1) : "—"}</span> / <span className="text-short">{t?.askBps != null ? (t.askBps / 100).toFixed(1) : "—"}</span></td>
            <td className="num py-2 text-right">{m.irrationality != null ? m.irrationality.toFixed(0) : "—"}</td>
            <td className="max-w-[180px] truncate py-2 pr-4 text-right text-xs text-muted">{m.topSignature ? BIAS_NAMES[m.topSignature.kind] : ""}</td>
          </tr>
        );
      })}
    </tbody>
  );
}
