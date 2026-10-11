"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { api, pct, usd, BIAS_NAMES, type MarketDetail, type Commit, type Trade } from "@/lib/api";
import { useEvents, useStream } from "@/components/stream";
import { PriceChart } from "@/components/PriceChart";
import { CouncilChamber } from "@/components/Council";
import { SealTimeline, WaxSeal } from "@/components/Seal";
import { Badge, Hash, Num, Panel, page } from "@/components/ui";

export function Dossier({ symbol }: { symbol: string }) {
  const [d, setD] = useState<MarketDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [live, setLive] = useState<Record<string, string>>({});
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
    if ((e.type === "trade.placed" || e.type === "trade.recorded" || e.type === "trade.refused") && e.trade.symbol === symbol) upTrade(e.trade);
  });
  const run = async () => {
    setRunErr(null);
    try { await api(`/api/run/${encodeURIComponent(symbol)}`, { method: "POST", body: "{}" }); setRunning(true); } catch (e) { setRunErr((e as Error).message); }
  };

  if (err) return <div className="mx-auto max-w-3xl px-6 py-24 text-center text-muted">{err === "unknown symbol" ? "This contract isn't tracked." : `Engine unreachable (${err}).`} <Link className="text-oracle" href="/">Back to the Field</Link></div>;
  const commit = d?.commits.find((c) => c.forecastId === d.forecast?.id) ?? d?.commits[0] ?? null;
  const trade = d?.trades.find((t) => t.forecastId === d.forecast?.id) ?? d?.trades[0] ?? null;
  const tradePolicy = policy ?? (trade ? { ok: trade.policyOk, reason: trade.policyReason, edgeBps: trade.edgeBps, notionalCents: trade.notionalCents } : null);

  return (
    <motion.div {...page} className="mx-auto max-w-[1500px] px-4 pb-12 pt-6 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <Link href="/" className="label hover:text-ink">Field / {d?.category ?? "…"}</Link>
          <h1 className="display fluid-h1 mt-1 text-ink">{d?.title ?? <span className="skeleton inline-block h-8 w-80 rounded" />}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted"><span>{d?.label}</span><span className="num text-xs">{symbol}</span>{d?.expiryDate && <span className="text-xs">resolves {new Date(d.expiryDate).toUTCString().slice(5, 22)} UTC</span>}{d && d.source !== "live" && <Badge kind="fixture">{d.source}</Badge>}</div>
        </div>
        <div className="flex items-end gap-6">
          <div><div className="label">Market</div><Num value={d?.tick ? d.tick.midBps / 100 : null} format={(v) => `${v.toFixed(1)}%`} className="text-3xl text-crowd" /></div>
          <div><div className="label">Cassandra</div><Num value={d?.forecast ? d.forecast.pBps / 100 : null} format={(v) => `${v.toFixed(1)}%`} className="text-3xl text-oracle" /></div>
          <div><div className="label">Irrationality</div><Num value={d?.irrationality} format={(v) => v.toFixed(0)} className="text-3xl" /></div>
          <button onClick={run} disabled={running || caps?.llm.mode !== "live"} className="rounded-md border border-oracle/60 bg-oracle/10 px-4 py-2 text-sm text-oracle transition-colors hover:bg-oracle/20 disabled:opacity-50">{running ? "Council in session" : "Run council now"}</button>
        </div>
      </div>
      {runErr && <div className="mt-3 rounded border border-refused/40 bg-refused/10 px-3 py-2 text-xs text-refused">{runErr}</div>}

      <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_340px]">
        <div className="space-y-4">
          <Panel title="24 h price" right={<span className="text-[0.68rem] text-muted"><span className="text-crowd">market</span> · <span className="text-oracle">council 80%</span></span>}>
            <div className="p-3"><PriceChart ticks={d?.ticks ?? []} forecast={d?.forecast ?? null} bias={d?.bias ?? null} /></div>
          </Panel>
          <Panel title="Bias spectrometer" right={d?.bias && <span className="num text-xs text-muted">edge {d.bias.edgeBps} bps</span>}>
            <ul className="divide-y divide-hairline">
              {!d?.bias && <li className="px-4 py-3 text-sm text-muted">Awaiting enough ticks</li>}
              {d?.bias?.signatures.map((s) => (
                <li key={s.kind} className="px-4 py-2.5">
                  <div className="flex items-baseline justify-between gap-2 text-sm"><span className={s.score > 0 ? "text-ink" : "text-muted"}>{BIAS_NAMES[s.kind]}{s.kind === "wishfulThinking" && s.score > 0 ? " (possible)" : ""}</span><span className="num text-xs">{(s.score * 100).toFixed(0)}<span className="text-muted">/100</span>{s.magnitudeBps ? <span className="ml-2 text-oracle">{(s.magnitudeBps / 100).toFixed(1)} pts</span> : null}</span></div>
                  <div className="mt-1 h-0.5 rounded bg-white/5"><motion.div className="h-full rounded bg-oracle" initial={{ width: 0 }} animate={{ width: `${s.score * 100}%` }} /></div>
                  {s.score > 0 && <p className="mt-1 text-[0.72rem] leading-snug text-muted">{s.explanation}</p>}
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <Panel title="Council chamber" right={d?.forecast && <span className="num text-[0.68rem] text-muted">{d.forecast.model} · <Link href={`${process.env.NEXT_PUBLIC_ENGINE_URL ?? "http://localhost:4000"}/api/forecasts/${d.forecast.id}`} className="hover:text-ink" target="_blank">json</Link></span>}>
          <div className="p-3"><CouncilChamber forecast={d?.forecast ?? null} live={live} running={running} /></div>
        </Panel>

        <div className="space-y-4">
          <Panel title="Seal" right={commit?.replay ? <Badge kind="replay">replay</Badge> : caps?.chain.network === "local" ? <Badge kind="fixture">local chain</Badge> : null}>
            <div className="flex gap-4 p-4">
              <WaxSeal stampKey={commit?.commitTx ?? null} />
              <div className="min-w-0 flex-1 text-sm"><SealTimeline commit={commit} explorer={explorer} /></div>
            </div>
            {commit && <div className="border-t border-hairline px-4 py-2 text-[0.68rem] text-muted">reasoning hash <Hash value={commit.reasoningHash} /></div>}
          </Panel>
          <Panel title="Trade" right={trade?.source && trade.source !== "live" ? <Badge kind="fixture">{trade.source}</Badge> : null}>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 p-4 text-sm">
              <div><dt className="label">Edge</dt><dd className="num">{tradePolicy ? `${tradePolicy.edgeBps} bps` : d?.bias ? `${d.bias.edgeBps} bps` : "—"}</dd></div>
              <div><dt className="label">Notional</dt><dd className="num">{usd(tradePolicy?.notionalCents)}</dd></div>
              <div className="col-span-2"><dt className="label">AgentPolicy.check</dt>
                <dd className={tradePolicy ? (tradePolicy.ok ? "text-scored" : "text-refused") : "text-muted"}>{tradePolicy ? (tradePolicy.ok ? "within policy" : `refused: ${tradePolicy.reason}`) : "not yet checked"}</dd></div>
              <div className="col-span-2"><dt className="label">Gemini sandbox order</dt><dd className="num">{trade?.orderId ?? <span className="text-muted">—</span>}{trade?.orderStatus && <span className="ml-2 text-xs text-muted">{trade.orderStatus} · filled {trade.filledQuantity ?? "0"} of {trade.quantity}</span>}</dd></div>
              {trade?.orderId && <div className="col-span-2"><dt className="label">Order</dt><dd className="num text-xs">buy {trade.quantity} {trade.outcome.toUpperCase()} @ {pct(trade.priceBps, 0)} IOC</dd></div>}
              <div className="col-span-2"><dt className="label">TradeRecorded</dt><dd className="text-xs">{trade?.recordTx ? <Hash value={trade.recordTx} href={explorer ? `${explorer}${trade.recordTx}` : null} /> : <span className="text-muted">—</span>}</dd></div>
              {trade?.error && <div className="col-span-2 text-xs text-refused">{trade.error}</div>}
            </dl>
          </Panel>
        </div>
      </div>
    </motion.div>
  );
}
