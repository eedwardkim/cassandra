"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api, pct, BIAS_NAMES, type Ledger, type MarketSummary, type StreamEvent, offline } from "@/lib/api";
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
    <div className="mx-auto max-w-[1280px] px-4 pb-16 pt-8 sm:px-6">
      <section className="flex flex-wrap items-end justify-between gap-6 border-b border-hairline pb-6">
        <div className="max-w-xl">
          <h1 className="text-2xl font-semibold tracking-tight">Markets</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">Four AI forecasters price each Gemini sandbox contract. The forecast is sealed on-chain before the market closes and scored when it resolves. The agent trades the gap only inside limits the owner signs.</p>
        </div>
        <dl className="flex flex-wrap gap-x-8 gap-y-3">
          <Stat label="Forecasts sealed" value={ledger?.counts.sealed ?? null} />
          <Stat label="Scored on-chain" value={ledger?.onchain?.count ?? ledger?.counts.scored ?? null} />
          <Stat label="Mean Brier" value={brier} fmt={(v) => v.toFixed(3)} />
          <Stat label="Market irrationality" value={index} fmt={(v) => v.toFixed(0)} suffix="/100" />
        </dl>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-1">
              {cats.map((c) => <button key={c} onClick={() => setCat(c)} className={`rounded-full px-3 py-1.5 text-sm font-medium capitalize ${cat === c ? "bg-ink text-white" : "text-muted hover:bg-surface-2 hover:text-ink"}`}>{c}</button>)}
            </div>
            <div className="flex items-center gap-2 text-xs text-muted">
              {fixture && <Badge kind="fixture">fixture prices</Badge>}
              {top && <Link href={`/m/${top.symbol}`} className="rounded-lg bg-ink px-3 py-2 text-xs font-medium text-white hover:bg-ink/85">Largest gap: {asset(top.eventTicker)} {top.label}</Link>}
            </div>
          </div>
          {markets === null && !err && <div className="grid gap-4 xl:grid-cols-2">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton h-64 rounded-xl" />)}</div>}
          {err && <div className="rounded-xl border border-hairline bg-white p-8 text-center text-sm text-muted">{offline(err)}</div>}
          {markets?.length === 0 && <div className="rounded-xl border border-hairline bg-white p-8 text-center text-sm text-muted">No markets tracked yet. The engine picks the most liquid sandbox markets on boot.</div>}
          <div className="grid items-start gap-4 xl:grid-cols-2">
            {groups.map((g) => <EventCard key={g.ticker} g={g} />)}
          </div>
        </section>
        <aside className="h-fit overflow-hidden rounded-xl border border-hairline bg-white lg:sticky lg:top-20">
          <Ticker seed={seed} />
        </aside>
      </div>
    </div>
  );
}

function Stat({ label, value, fmt = (v: number) => v.toFixed(0), suffix }: { label: string; value: number | null; fmt?: (v: number) => string; suffix?: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-xl font-semibold tracking-tight"><Num value={value} format={fmt} />{suffix && value != null && <span className="ml-0.5 text-sm font-normal text-muted">{suffix}</span>}</dd>
    </div>
  );
}

function EventCard({ g }: { g: Group }) {
  const sig = g.markets.map((m) => m.topSignature).filter((s) => s != null).sort((a, b) => b.score - a.score)[0];
  return (
    <article className="overflow-hidden rounded-xl border border-hairline bg-white">
      <header className="flex items-start gap-3 px-4 pt-4 pb-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-[0.7rem] font-semibold">{asset(g.ticker)}</span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[0.95rem] font-semibold leading-tight">{g.title}</h2>
          <div className="mt-0.5 flex gap-2 text-xs text-muted"><span className="capitalize">{g.category}</span><span>·</span><span>{closesIn(g.expiryDate)}</span><span>·</span><span>{g.markets.length} {g.markets.length === 1 ? "strike" : "strikes"}</span></div>
        </div>
      </header>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-y border-hairline bg-surface-2/60 text-[0.7rem] text-muted">
            <th className="py-1.5 pl-4 text-left font-medium">Strike</th>
            <th className="py-1.5 text-left font-medium">Market</th>
            <th className="py-1.5 text-right font-medium">Cassandra</th>
            <th className="py-1.5 pr-4 text-right font-medium">Gap</th>
          </tr>
        </thead>
        <tbody>
          {g.markets.map((m) => {
            const gap = gapOf(m);
            const mid = m.tick?.midBps ?? null;
            return (
              <tr key={m.symbol} className="group border-b border-hairline last:border-0">
                <td className="py-0 pl-4"><Link href={`/m/${m.symbol}`} className="block py-2.5 font-medium group-hover:text-oracle">{m.label.replace(/ or above$/, "+")}</Link></td>
                <td className="w-[38%] py-2.5 pr-3">
                  <Link href={`/m/${m.symbol}`} className="flex items-center gap-2">
                    <span className="num w-9 shrink-0 font-semibold">{pct(mid, 0)}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"><span className="block h-full rounded-full bg-crowd/70" style={{ width: `${(mid ?? 0) / 100}%` }} /></span>
                  </Link>
                </td>
                <td className="num py-2.5 text-right"><Link href={`/m/${m.symbol}`} className={m.councilBps != null ? "font-semibold text-oracle" : "text-muted/60"}>{m.councilBps != null ? pct(m.councilBps, 0) : "—"}</Link></td>
                <td className="num py-2.5 pr-4 text-right"><Link href={`/m/${m.symbol}`} className={gap == null || Math.abs(gap) < 0.5 ? "text-muted/60" : gap > 0 ? "font-medium text-scored" : "font-medium text-refused"}>{gap == null ? "" : `${gap > 0 ? "+" : ""}${gap.toFixed(1)}`}</Link></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {sig && <footer className="border-t border-hairline px-4 py-2 text-xs text-muted">Flagged: <span className="text-ink">{BIAS_NAMES[sig.kind]}</span>{sig.magnitudeBps ? ` · ${(sig.magnitudeBps / 100).toFixed(1)} pts` : ""}</footer>}
    </article>
  );
}
