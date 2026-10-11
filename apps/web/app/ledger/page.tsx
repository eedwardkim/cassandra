"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import * as d3 from "d3";
import { commitmentHash } from "@cassandra/shared/hash";
import { api, pct, type Ledger, type LedgerRow } from "@/lib/api";
import { useEvents, useStream } from "@/components/stream";
import { Badge, Hash, Num, Panel, page } from "@/components/ui";

export default function LedgerPage() {
  const [l, setL] = useState<Ledger | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const { caps } = useStream();
  const load = useCallback(() => api<Ledger>("/api/ledger").then(setL).catch((e: Error) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useEvents((e) => { if (e.type.startsWith("seal.") && e.type !== "seal.pending") load(); });
  const explorer = caps?.chain.network === "bscTestnet" ? "https://testnet.bscscan.com/tx/" : null;
  const scored = (l?.commits ?? []).filter((c) => c.state === "scored" && c.brierBps2 != null);
  const meanBrier = scored.length ? scored.reduce((s, c) => s + c.brierBps2!, 0) / scored.length / 1e8 : null;

  return (
    <motion.div {...page} className="mx-auto max-w-[1300px] px-4 pb-12 pt-6 sm:px-6">
      <h1 className="display fluid-hero">Proof of <span className="italic text-oracle">Calibration</span></h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">Each forecast is committed as a hash before resolution, revealed, then scored on-chain by the CalibrationLedger contract. Brier score: lower is better; 0.25 is a coin flip.</p>
      {caps?.chain.network === "local" && <div className="mt-3"><Badge kind="fixture">local anvil chain, not BSC Testnet</Badge></div>}

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_1fr_1.2fr]">
        <Panel title="Mean Brier (scored)">
          <div className="p-5">
            <Num value={meanBrier} format={(v) => v.toFixed(3)} className="text-6xl text-oracle" />
            <div className="mt-2 text-xs text-muted">{l?.onchain ? <>on-chain <span className="num">{(Number(l.onchain.meanBrierBps2) / 1e8).toFixed(3)}</span> over <span className="num">{l.onchain.count}</span> scored commits</> : "on-chain read pending"}</div>
          </div>
        </Panel>
        <Panel title="Commitments">
          <div className="grid grid-cols-3 gap-2 p-5">
            {(["sealed", "revealed", "scored"] as const).map((k) => <div key={k}><div className="label">{k}</div><Num value={l?.counts[k] ?? null} className={`text-4xl ${k === "scored" ? "text-scored" : ""}`} /></div>)}
          </div>
        </Panel>
        <Panel title="Reliability (10 bins)"><div className="p-3"><Reliability rows={scored} /></div></Panel>
      </div>

      <Panel title="Every commitment, newest first" className="mt-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead><tr className="text-left">{["Time", "Market", "p", "Outcome", "Brier", "Commit", "Reveal", "Score", ""].map((h) => <th key={h} className="label px-4 py-2 font-normal">{h}</th>)}</tr></thead>
            <tbody className="divide-y divide-hairline">
              {!l && !err && Array.from({ length: 4 }).map((_, i) => <tr key={i}><td colSpan={9} className="px-4 py-2"><div className="skeleton h-5 rounded" /></td></tr>)}
              {err && <tr><td colSpan={9} className="px-4 py-6 text-center text-muted">Engine unreachable ({err})</td></tr>}
              {l && l.commits.length === 0 && <tr><td colSpan={9} className="px-4 py-6 text-center text-muted">No sealed forecasts yet. Run the council on any market.</td></tr>}
              {l?.commits.map((c, i) => (
                <motion.tr key={c.id} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: { delay: Math.min(i, 20) * 0.04 } }} className="hover:bg-white/[0.02]">
                  <td className="num px-4 py-2 text-xs text-muted">{new Date(c.createdAt).toISOString().slice(5, 16).replace("T", " ")}</td>
                  <td className="max-w-[260px] px-4 py-2"><Link href={`/m/${c.symbol}`} className="block truncate hover:text-oracle">{c.title}</Link><span className="text-xs text-muted">{c.label}</span> {c.replay && <Badge kind="replay">replay</Badge>}</td>
                  <td className="num px-4 py-2 text-oracle">{pct(c.pBps)}</td>
                  <td className="px-4 py-2 text-xs">{c.outcomeYes == null ? <span className="text-muted">open</span> : c.outcomeYes ? "YES" : "NO"}</td>
                  <td className={`num px-4 py-2 ${c.brierBps2 != null ? (c.brierBps2 / 1e8 < 0.25 ? "text-scored" : "text-refused") : "text-muted"}`}>{c.brierBps2 != null ? (c.brierBps2 / 1e8).toFixed(3) : "—"}</td>
                  <td className="px-4 py-2 text-xs"><Hash value={c.commitTx} href={explorer && c.commitTx ? explorer + c.commitTx : null} /></td>
                  <td className="px-4 py-2 text-xs"><Hash value={c.revealTx} href={explorer && c.revealTx ? explorer + c.revealTx : null} /></td>
                  <td className="px-4 py-2 text-xs"><Hash value={c.scoreTx} href={explorer && c.scoreTx ? explorer + c.scoreTx : null} /></td>
                  <td className="px-4 py-2"><Verify c={c} /></td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </motion.div>
  );
}

function Verify({ c }: { c: LedgerRow }) {
  const [open, setOpen] = useState(false);
  const result = useMemo(() => {
    if (!open || !c.salt || c.state === "sealed" || c.state === "pending") return null;
    const h = commitmentHash(c.marketKey as `0x${string}`, c.pBps, c.reasoningHash as `0x${string}`, c.salt as `0x${string}`);
    return { h, ok: h.toLowerCase() === c.commitment.toLowerCase() };
  }, [open, c]);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="rounded border border-hairline px-2 py-0.5 text-xs text-muted hover:border-oracle/50 hover:text-oracle">verify</button>
      {open && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="hair absolute right-0 top-8 z-20 w-[380px] rounded-lg bg-surface-2 p-3 text-xs">
          <div className="label mb-1">recomputed in your browser</div>
          <code className="num block break-all text-[0.68rem] text-muted">keccak256(abi.encode(marketKey, {c.pBps}, reasoningHash, salt))</code>
          {result ? (<>
            <div className="mt-2 break-all"><span className="text-muted">computed </span><span className="num">{result.h}</span></div>
            <div className="mt-1 break-all"><span className="text-muted">on-chain </span><span className="num">{c.commitment}</span></div>
            <div className={`mt-2 ${result.ok ? "text-scored" : "text-refused"}`}>{result.ok ? "Match. The revealed forecast is the one sealed before resolution." : "Mismatch."}</div>
          </>) : <div className="mt-2 text-muted">Not revealed yet; the salt stays secret until reveal.</div>}
        </motion.div>
      )}
    </div>
  );
}

function Reliability({ rows }: { rows: LedgerRow[] }) {
  const w = 320, h = 200, m = 26;
  const bins = Array.from({ length: 10 }, (_, i) => {
    const inBin = rows.filter((r) => Math.min(9, Math.floor(r.pBps / 1000)) === i);
    return { i, n: inBin.length, obs: inBin.length ? inBin.filter((r) => r.outcomeYes).length / inBin.length : null };
  });
  const x = d3.scaleLinear().domain([0, 1]).range([m, w - 6]);
  const y = d3.scaleLinear().domain([0, 1]).range([h - m, 6]);
  if (!rows.length) return <div className="grid h-[200px] place-items-center text-xs text-muted">Fills in as markets resolve</div>;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 3" />
      {[0, 0.5, 1].map((v) => <g key={v}><text x={x(v)} y={h - 8} fontSize="9" fill="#8B8F9A" textAnchor="middle">{v * 100}%</text><text x={4} y={y(v) + 3} fontSize="9" fill="#8B8F9A">{v * 100}</text></g>)}
      {bins.map((b) => b.obs != null && <circle key={b.i} cx={x((b.i + 0.5) / 10)} cy={y(b.obs)} r={3 + Math.sqrt(b.n) * 2} fill="rgba(245,176,65,0.35)" stroke="#F5B041" />)}
      <text x={w - 8} y={h - m - 4} fontSize="9" fill="#8B8F9A" textAnchor="end">predicted</text>
    </svg>
  );
}
