"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { api, blocked, marketLabel, pct, usd, BIAS_NAMES, type MarketDetail, type Commit, type Trade, offline, runError } from "@/lib/api";
import { useEvents, useStream } from "@/components/stream";
import { PriceChart } from "@/components/PriceChart";
import { OrderBook } from "@/components/OrderBook";
import { CouncilChamber } from "@/components/Council";
import { SealTimeline } from "@/components/Seal";
import { Badge, Hash, Num, Panel, page } from "@/components/ui";

const pts = (bps: number) => `${(bps / 100).toFixed(1)} pts`;

export function Dossier({ symbol }: { symbol: string }) {
  const [d, setD] = useState<MarketDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [live, setLive] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"forecast" | "bias" | "trades">("forecast");
  const [running, setRunning] = useState(false);
  const [policy, setPolicy] = useState<{ ok: boolean; reason: string; edgeBps: number; notionalCents: number } | null>(null);
  const [runErr, setRunErr] = useState<string | null>(null);
  const { caps } = useStream();
  const explorer = caps?.chain.network === "bscTestnet" ? "https://testnet.bscscan.com/tx/" : null;
  const load = useCallback(() => api<MarketDetail>(`/api/markets/${encodeURIComponent(symbol)}`).then((x) => { setD(x); setErr(null); }).catch((e: Error) => setErr(e.message)), [symbol]);
  useEffect(() => { load(); }, [load]);

  const upCommit = (c: Commit) => setD((x) => x && { ...x, commits: [c, ...x.commits.filter((k) => k.id !== c.id)] });
  const upTrade = (t: Trade) => setD((x) => x && { ...x, trades: [t, ...x.trades.filter((k) => k.id !== t.id)] });
  useEvents((e) => {
    if ("symbol" in e && e.symbol !== symbol) return;
    switch (e.type) {
      case "tick": setD((x) => x && { ...x, ticks: [...x.ticks, { ...(x.ticks.at(-1) ?? x.tick!), midBps: e.midBps, ts: e.ts }] }); break;
      case "council.start": setRunning(!e.cached); setLive({}); setRunErr(null); setPolicy(null); break;
      case "council.delta": setLive((l) => ({ ...l, [e.persona]: (l[e.persona] ?? "") + e.text })); break;
      case "council.final": setRunning(false); setD((x) => x && { ...x, forecast: e.forecast, councilBps: e.forecast.pBps }); break;
      case "council.error": setRunning(false); setRunErr(e.message); break;
      case "policy.checked": setPolicy(e); break;
    }
    if (e.type === "bias.update" && e.report.symbol === symbol) setD((x) => x && { ...x, bias: e.report, irrationality: e.report.irrationality });
    if ((e.type === "seal.pending" || e.type === "seal.committed" || e.type === "seal.revealed" || e.type === "seal.scored") && e.commit.symbol === symbol) upCommit(e.commit);
    if ((e.type === "trade.authorized" || e.type === "trade.placed" || e.type === "trade.settled" || e.type === "trade.refused") && e.trade.symbol === symbol) upTrade(e.trade);
  });
  const run = async () => {
    setRunErr(null);
    setRunning(true);
    try { await api(`/api/run/${encodeURIComponent(symbol)}?force=1`, { method: "POST", body: "{}" }); } catch (e) { setRunning(false); setRunErr((e as Error).message); }
  };

  if (err) return <div className="mx-auto max-w-3xl px-6 py-24 text-center text-muted">{err === "unknown symbol" ? "This contract isn't tracked." : offline(err)} <Link className="text-oracle" href="/">Back to markets</Link></div>;
  const commit = d?.commits.find((c) => c.forecastId === d.forecast?.id) ?? d?.commits[0] ?? null;
  const trade = (d?.forecast ? d.trades.find((t) => t.forecastId === d.forecast!.id) : d?.trades[0]) ?? null;
  const tradePolicy = policy ?? (trade ? { ok: trade.policyOk, reason: trade.policyReason, edgeBps: trade.edgeBps, notionalCents: trade.notionalCents } : null);

  // the side the executor actually chose (from the trade-time book) wins over the side implied by today's moving price
  const tradedSide = trade && d?.forecast && trade.forecastId === d.forecast.id ? trade.outcome : undefined;
  const side = tradedSide ? (tradedSide === "yes" ? "YES" : "NO") : d?.forecast && d.tick ? (d.forecast.pBps >= d.tick.midBps ? "YES" : "NO") : null;
  const gap = d?.forecast && d.tick ? (d.forecast.pBps - d.tick.midBps) / 100 : null;
  const closes = d?.expiryDate ? new Date(d.expiryDate).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
  const tabs = [["forecast", "Forecast"], ["bias", "Price biases"], ["trades", `Trades (${d?.trades.length ?? 0})`]] as const;
  return (
    <motion.div {...page} className="px-3 pb-10 pt-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-2 rounded-md border border-hairline bg-surface px-4 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-2 text-[0.6rem] font-semibold">{d?.eventTicker.match(/^[A-Z]+/)?.[0]?.slice(0, 4) ?? ""}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[0.95rem] font-semibold leading-tight">{d ? marketLabel(d.symbol) : <span className="skeleton inline-block h-4 w-24 rounded" />}{d && d.source !== "live" && <Badge kind="fixture">{d.source}</Badge>}</div>
            <Link href="/" className="block max-w-[300px] truncate text-xs text-muted hover:text-ink">{d?.title ?? "…"}</Link>
          </div>
        </div>
        <Stat k="Market"><Num value={d?.tick ? d.tick.midBps / 100 : null} format={(v) => `${v.toFixed(1)}%`} /></Stat>
        <Stat k="Cassandra"><Num value={d?.forecast ? d.forecast.pBps / 100 : null} format={(v) => `${v.toFixed(1)}%`} className="text-oracle" /></Stat>
        <Stat k="Gap"><span className={gap == null ? "text-muted" : gap > 0 ? "text-long" : "text-short"}>{gap != null ? `${gap > 0 ? "+" : ""}${gap.toFixed(1)} pts` : "—"}</span></Stat>
        <Stat k="Bid / Ask"><span className="text-long">{d?.tick?.bidBps != null ? (d.tick.bidBps / 100).toFixed(1) : "—"}</span><span className="text-muted"> / </span><span className="text-short">{d?.tick?.askBps != null ? (d.tick.askBps / 100).toFixed(1) : "—"}</span></Stat>
        {d?.forecast && <Stat k="80% range">{pct(d.forecast.loBps, 0)} – {pct(d.forecast.hiBps, 0)}</Stat>}
        <Stat k="Irrationality"><Num value={d?.irrationality} format={(v) => v.toFixed(0)} /><span className="text-muted">/100</span></Stat>
        {closes && <Stat k="Resolves">{closes}</Stat>}
      </div>
      {runErr && <div className="mt-2 rounded-md border border-refused/30 bg-refused/10 px-3 py-2 text-sm text-refused">{runError(runErr)}{d?.forecast && <span className="text-muted"> Below is the previous forecast from {new Date(d.forecast.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.</span>}</div>}

      <div className="mt-2 grid gap-2 xl:grid-cols-[minmax(0,1fr)_260px_340px]">
        <Panel className="min-w-0" title={<span className="flex items-center gap-4"><span>Price</span><span className="flex items-center gap-1.5 text-xs font-normal text-muted"><span className="h-2 w-2 rounded-sm bg-long" />Market mid</span><span className="flex items-center gap-1.5 text-xs font-normal text-muted"><span className="h-0 w-3 border-t border-dashed border-oracle" />Cassandra</span></span>}>
          <div className="px-2 py-2"><PriceChart ticks={d?.ticks ?? []} forecast={d?.forecast ?? null} bias={d?.bias ?? null} /></div>
        </Panel>
        <Panel className="min-w-0" title="Order book" right={<span className="text-xs text-muted">YES</span>}>
          {d && <OrderBook symbol={d.symbol} />}
        </Panel>

        <div className="space-y-2 xl:row-span-2">
          <Panel title="Trade" right={trade?.source && trade.source !== "live" ? <Badge kind="fixture">{trade.source}</Badge> : null}>
            <div className="p-4">
              <div className="grid grid-cols-2 gap-1 rounded-md bg-surface-2 p-1">
                <div className={`rounded px-3 py-2 text-center text-sm font-semibold ${side === "YES" ? "bg-long text-bg" : "text-muted"}`}>Buy YES</div>
                <div className={`rounded px-3 py-2 text-center text-sm font-semibold ${side === "NO" ? "bg-short text-white" : "text-muted"}`}>Buy NO</div>
              </div>
              <dl className="mt-4 space-y-2 text-[0.82rem]">
                <Row k="Gap vs market">{gap != null ? `${gap > 0 ? "+" : ""}${gap.toFixed(1)} pts` : "—"}</Row>
                <Row k="Edge after spread and fees">{tradePolicy ? pts(tradePolicy.edgeBps) : d?.bias ? pts(d.bias.edgeBps) : "—"}</Row>
                <Row k="Order size">{usd(tradePolicy?.notionalCents)}</Row>
                {!trade && <Row k="Trade"><span className={tradePolicy ? (tradePolicy.ok ? "text-scored" : "text-refused") : "text-muted"}>{tradePolicy ? (tradePolicy.ok ? "Approved on-chain" : blocked(tradePolicy.reason)) : d?.forecast ? "None for this forecast" : "No forecast yet"}</span></Row>}
                {trade?.orderId && <Row k="Fill">{trade.orderStatus ?? "sent"} · {trade.filledQuantity ?? "0"} of {trade.quantity} {trade.outcome.toUpperCase()} @ {pct(trade.priceBps, 0)}</Row>}
              </dl>
              {trade && <div className="mt-4 border-t border-hairline pt-3"><Steps t={trade} explorer={explorer} /></div>}
              {trade?.error && trade.state !== "refused" && <p className="mt-3 text-xs text-refused">{trade.error}</p>}
              <button onClick={run} disabled={running || caps?.llm.mode !== "live"} className="mt-4 w-full rounded-md bg-long px-4 py-3 text-sm font-semibold text-bg transition-colors hover:bg-long/85 disabled:opacity-50">{running ? "Running forecast…" : "Run a new forecast"}</button>
              {caps?.llm.mode !== "live" && <p className="mt-2 text-center text-xs text-muted">LLM is in dry-run; no forecasts are generated.</p>}
              <p className="mt-3 text-[0.7rem] leading-snug text-muted">Orders go to the Gemini sandbox from one shared demo account, only after the spending-limits contract approves them.</p>
            </div>
          </Panel>

          <Panel title="On-chain record" right={commit?.replay ? <Badge kind="replay">replay</Badge> : caps?.chain.network === "local" ? <Badge kind="fixture">local chain</Badge> : null}>
            <div className="px-4 pb-4 pt-3 text-sm"><SealTimeline commit={commit} explorer={explorer} /></div>
            {commit && <div className="border-t border-hairline px-4 py-2.5 text-xs text-muted">Reasoning hash <Hash value={commit.reasoningHash} /></div>}
          </Panel>
        </div>

        <section className="min-w-0 rounded-md border border-hairline bg-surface xl:col-span-2">
          <div className="flex items-center justify-between gap-3 border-b border-hairline px-4">
            <div className="flex gap-5">
              {tabs.map(([k, label]) => <button key={k} onClick={() => setTab(k)} className={`-mb-px border-b-2 py-2.5 text-sm ${tab === k ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink"}`}>{label}</button>)}
            </div>
            {tab === "forecast" && d?.forecast && <a href={`${process.env.NEXT_PUBLIC_ENGINE_URL ?? "http://localhost:4000"}/api/forecasts/${d.forecast.id}`} className="text-xs text-muted hover:text-ink" target="_blank" rel="noreferrer">Raw JSON</a>}
          </div>
          {tab === "forecast" && <div className="p-3"><CouncilChamber forecast={d?.forecast ?? null} live={live} running={running} /></div>}
          {tab === "bias" && (
            <ul className="divide-y divide-hairline px-4">
              {!d?.bias && <li className="py-3 text-sm text-muted">Waiting for enough price history.</li>}
              {d?.bias?.signatures.map((s) => (
                <li key={s.kind} className="py-3">
                  <div className="flex items-baseline justify-between gap-2 text-sm"><span className={s.score > 0 ? "font-medium" : "text-muted"}>{BIAS_NAMES[s.kind]}</span><span className="num text-xs text-muted">{s.magnitudeBps ? <span className="mr-2 font-medium text-oracle">{(s.magnitudeBps / 100).toFixed(1)} pts</span> : null}{(s.score * 100).toFixed(0)} / 100</span></div>
                  <div className="mt-1.5 h-1 rounded-full bg-surface-2"><motion.div className="h-full rounded-full bg-oracle" initial={{ width: 0 }} animate={{ width: `${s.score * 100}%` }} /></div>
                  {s.score > 0 && <p className="mt-1.5 text-[0.8rem] leading-snug text-muted">{s.explanation}</p>}
                </li>
              ))}
            </ul>
          )}
          {tab === "trades" && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-[0.8rem]">
                <thead><tr className="text-left text-[0.7rem] text-muted">{["Time", "Side", "Size", "Edge", "Gemini order", "Status"].map((h) => <th key={h} className="px-4 py-2 font-normal">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-hairline">
                  {!d?.trades.length && <tr><td colSpan={6} className="px-4 py-6 text-center text-muted">No trades on this market yet.</td></tr>}
                  {d?.trades.map((t) => (
                    <tr key={t.id}>
                      <td className="num px-4 py-2 text-muted">{new Date(t.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</td>
                      <td className={`px-4 py-2 font-medium ${t.outcome === "yes" ? "text-long" : "text-short"}`}>{t.outcome.toUpperCase()}</td>
                      <td className="num px-4 py-2">{t.quantity} @ {pct(t.priceBps, 0)} <span className="text-muted">· {usd(t.notionalCents)}</span></td>
                      <td className="num px-4 py-2">{pts(t.edgeBps)}</td>
                      <td className="mono px-4 py-2 text-xs">{t.orderId ?? <span className="text-muted">—</span>}</td>
                      <td className={`px-4 py-2 ${t.state === "refused" ? "text-refused" : t.state === "failed" ? "text-refused" : "text-ink"}`}>{t.state === "refused" ? "Blocked by your limits" : t.orderStatus ?? t.state}{t.filledQuantity && Number(t.filledQuantity) > 0 ? ` · ${t.filledQuantity} filled` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </motion.div>
  );
}

function Stat({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="shrink-0"><div className="text-[0.68rem] text-muted">{k}</div><div className="num text-[0.85rem] font-medium">{children}</div></div>;
}

function Steps({ t, explorer }: { t: Trade; explorer: string | null }) {
  if (t.state === "refused") return <p className="text-sm font-medium text-refused">{blocked(t.policyReason)}</p>;
  const link = (h: string | null) => (h ? <Hash value={h} href={explorer ? `${explorer}${h}` : null} /> : null);
  const steps: [string, React.ReactNode][] = [["Approved on-chain", link(t.authorizeTx)], ["Order sent to Gemini", t.orderId ? <span className="mono text-xs">{t.orderId}</span> : null], ["Fill recorded", link(t.recordTx)]];
  return (
    <ol className="space-y-2 text-sm">
      {steps.map(([k, v], i) => (
        <li key={k} className="flex items-baseline justify-between gap-3">
          <span className={v ? "text-ink" : "text-muted"}><span className="num mr-2 text-muted">{i + 1}</span>{k}</span>
          <span className="num min-w-0 truncate">{v ?? "—"}</span>
        </li>
      ))}
    </ol>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="flex items-baseline justify-between gap-3"><dt className="shrink-0 text-muted">{k}</dt><dd className="num min-w-0 truncate text-right font-medium">{children}</dd></div>;
}
