"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { api, pct, usd, BIAS_NAMES, type MarketDetail, type Commit, type Trade, offline } from "@/lib/api";
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
    if ((e.type === "trade.authorized" || e.type === "trade.placed" || e.type === "trade.settled" || e.type === "trade.refused") && e.trade.symbol === symbol) upTrade(e.trade);
  });
  const run = async () => {
    setRunErr(null);
    setRunning(true);
    try { await api(`/api/run/${encodeURIComponent(symbol)}?force=1`, { method: "POST", body: "{}" }); } catch (e) { setRunning(false); setRunErr((e as Error).message); }
  };

  if (err) return <div className="mx-auto max-w-3xl px-6 py-24 text-center text-muted">{err === "unknown symbol" ? "This contract isn't tracked." : offline(err)} <Link className="text-oracle" href="/">Back to markets</Link></div>;
  const commit = d?.commits.find((c) => c.forecastId === d.forecast?.id) ?? d?.commits[0] ?? null;
  const trade = d?.trades.find((t) => t.forecastId === d.forecast?.id) ?? d?.trades[0] ?? null;
  const tradePolicy = policy ?? (trade ? { ok: trade.policyOk, reason: trade.policyReason, edgeBps: trade.edgeBps, notionalCents: trade.notionalCents } : null);

  // the side actually traded for this forecast wins over the side implied by today's moving price
  const tradedSide = d?.forecast ? d.trades?.find((t) => t.forecastId === d.forecast!.id && t.state !== "refused")?.outcome : undefined;
  const side = tradedSide ? (tradedSide === "yes" ? "YES" : "NO") : d?.forecast && d.tick ? (d.forecast.pBps >= d.tick.midBps ? "YES" : "NO") : null;
  const gap = d?.forecast && d.tick ? (d.forecast.pBps - d.tick.midBps) / 100 : null;
  return (
    <motion.div {...page} className="mx-auto max-w-[1280px] px-4 pb-16 pt-6 sm:px-6">
      <Link href="/" className="text-sm text-muted hover:text-ink">Markets <span className="mx-1">/</span> <span className="capitalize">{d?.category ?? "…"}</span></Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="display fluid-h1">{d?.title ?? <span className="skeleton inline-block h-8 w-80 rounded" />}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted"><span className="font-medium text-ink">{d?.label}</span>{d?.expiryDate && <span>· resolves {new Date(d.expiryDate).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>}{d && d.source !== "live" && <Badge kind="fixture">{d.source}</Badge>}</div>
        </div>
      </div>
      {runErr && <div className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-refused">{runErr}</div>}

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-5">
          <Panel>
            <div className="flex flex-wrap gap-8 px-5 pt-5">
              <div><div className="text-xs text-muted">Market says</div><Num value={d?.tick ? d.tick.midBps / 100 : null} format={(v) => `${v.toFixed(1)}%`} className="text-3xl font-semibold text-crowd" /></div>
              <div><div className="text-xs text-muted">Cassandra says</div><Num value={d?.forecast ? d.forecast.pBps / 100 : null} format={(v) => `${v.toFixed(1)}%`} className="text-3xl font-semibold text-oracle" /></div>
              {d?.forecast && <div><div className="text-xs text-muted">80% range</div><div className="num pt-2 text-sm font-medium">{pct(d.forecast.loBps, 0)} – {pct(d.forecast.hiBps, 0)}</div></div>}
              <div><div className="text-xs text-muted">Irrationality</div><div className="pt-1 text-xl font-semibold"><Num value={d?.irrationality} format={(v) => v.toFixed(0)} /><span className="text-sm text-muted"> / 100</span></div></div>
            </div>
            <div className="px-3 pb-3"><PriceChart ticks={d?.ticks ?? []} forecast={d?.forecast ?? null} bias={d?.bias ?? null} /></div>
          </Panel>

          <Panel title="The debate" right={d?.forecast && <a href={`${process.env.NEXT_PUBLIC_ENGINE_URL ?? "http://localhost:4000"}/api/forecasts/${d.forecast.id}`} className="text-xs text-muted hover:text-ink" target="_blank" rel="noreferrer">Raw JSON</a>}>
            <div className="p-4 pt-2"><CouncilChamber forecast={d?.forecast ?? null} live={live} running={running} /></div>
          </Panel>

          <Panel title="Why the price may be off">
            <ul className="divide-y divide-hairline px-5 pb-2">
              {!d?.bias && <li className="py-3 text-sm text-muted">Waiting for enough price history.</li>}
              {d?.bias?.signatures.map((s) => (
                <li key={s.kind} className="py-3">
                  <div className="flex items-baseline justify-between gap-2 text-sm"><span className={s.score > 0 ? "font-medium" : "text-muted"}>{BIAS_NAMES[s.kind]}</span><span className="num text-xs text-muted">{s.magnitudeBps ? <span className="mr-2 font-medium text-oracle">{(s.magnitudeBps / 100).toFixed(1)} pts</span> : null}{(s.score * 100).toFixed(0)} / 100</span></div>
                  <div className="mt-1.5 h-1 rounded-full bg-surface-2"><motion.div className="h-full rounded-full bg-oracle" initial={{ width: 0 }} animate={{ width: `${s.score * 100}%` }} /></div>
                  {s.score > 0 && <p className="mt-1.5 text-[0.8rem] leading-snug text-muted">{s.explanation}</p>}
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <div className="space-y-5 lg:sticky lg:top-20 lg:h-fit">
          <Panel title="Cassandra's call" right={trade?.source && trade.source !== "live" ? <Badge kind="fixture">{trade.source}</Badge> : null}>
            <div className="px-5 pb-5">
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div className={`rounded-lg px-3 py-2.5 text-center text-sm font-semibold ${side === "YES" ? "bg-emerald-50 text-scored ring-1 ring-emerald-200" : "bg-surface-2 text-muted"}`}>Buy YES</div>
                <div className={`rounded-lg px-3 py-2.5 text-center text-sm font-semibold ${side === "NO" ? "bg-red-50 text-refused ring-1 ring-red-200" : "bg-surface-2 text-muted"}`}>Buy NO</div>
              </div>
              <dl className="mt-4 space-y-2.5 text-sm">
                <Row k="Gap vs market">{gap != null ? `${gap > 0 ? "+" : ""}${gap.toFixed(1)} pts` : "—"}</Row>
                <Row k="Edge after spread and fees">{tradePolicy ? `${tradePolicy.edgeBps} bps` : d?.bias ? `${d.bias.edgeBps} bps` : "—"}</Row>
                <Row k="Order size">{usd(tradePolicy?.notionalCents)}</Row>
                {!trade && <Row k="Your limits"><span className={tradePolicy ? (tradePolicy.ok ? "text-scored" : "text-refused") : "text-muted"}>{tradePolicy ? (tradePolicy.ok ? "Approved on-chain" : `Refused: ${tradePolicy.reason}`) : "Not checked yet"}</span></Row>}
                {trade?.orderId && <Row k="Fill">{trade.orderStatus ?? "sent"} · {trade.filledQuantity ?? "0"} of {trade.quantity} {trade.outcome.toUpperCase()} @ {pct(trade.priceBps, 0)}</Row>}
              </dl>
              {trade && <div className="mt-4 border-t border-hairline pt-4"><Steps t={trade} explorer={explorer} /></div>}
              {trade?.error && trade.state !== "refused" && <p className="mt-3 text-xs text-refused">{trade.error}</p>}
              <button onClick={run} disabled={running || caps?.llm.mode !== "live"} className="mt-5 w-full rounded-lg bg-ink px-4 py-3 text-sm font-medium text-white transition-colors hover:bg-ink/85 disabled:opacity-50">{running ? "Forecasters are debating…" : "Run a new forecast"}</button>
              {caps?.llm.mode !== "live" && <p className="mt-2 text-center text-xs text-muted">LLM is in dry-run; no forecasts are generated.</p>}
            </div>
          </Panel>

          <Panel title="On-chain record" right={commit?.replay ? <Badge kind="replay">replay</Badge> : caps?.chain.network === "local" ? <Badge kind="fixture">local chain</Badge> : null}>
            <div className="flex gap-4 px-5 pb-4 pt-2">
              <WaxSeal stampKey={commit?.commitTx ?? null} />
              <div className="min-w-0 flex-1 text-sm"><SealTimeline commit={commit} explorer={explorer} /></div>
            </div>
            {commit && <div className="border-t border-hairline px-5 py-3 text-xs text-muted">Reasoning hash <Hash value={commit.reasoningHash} /></div>}
          </Panel>
        </div>
      </div>
    </motion.div>
  );
}

function Steps({ t, explorer }: { t: Trade; explorer: string | null }) {
  if (t.state === "refused") return <p className="text-sm font-medium text-refused">Chain refused: {t.policyReason}. No order sent.</p>;
  const link = (h: string | null) => (h ? <Hash value={h} href={explorer ? `${explorer}${h}` : null} /> : null);
  const steps: [string, React.ReactNode][] = [["Chain approved", link(t.authorizeTx)], ["Order sent to Gemini", t.orderId ? <span className="mono text-xs">{t.orderId}</span> : null], ["Fill recorded", link(t.recordTx)]];
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
