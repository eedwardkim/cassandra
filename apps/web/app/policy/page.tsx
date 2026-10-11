"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { api, blocked, offline, pct, short, usd, type Policy, type PolicyState, type Trade } from "@/lib/api";
import { connectWallet, ownerWrite, sameAddress, useWallet } from "@/lib/wallet";
import { useEvents, useStream } from "@/components/stream";
import { Badge, Hash, Panel, page } from "@/components/ui";

const CATS = ["politics", "sports", "crypto", "economics", "commodities", "culture", "weather", "other"] as const;

export default function PolicyPage() {
  const [s, setS] = useState<PolicyState | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [tx, setTx] = useState<{ state: "idle" | "pending" | "confirmed" | "failed"; hash?: string; error?: string }>({ state: "idle" });
  const [err, setErr] = useState<string | null>(null);
  const { caps } = useStream();
  const explorer = caps?.chain.network === "bscTestnet" ? "https://testnet.bscscan.com/tx/" : null;
  const load = useCallback(() => api<PolicyState>("/api/policy").then((x) => { setS(x); setDraft((d) => d ?? x.policy); }).catch((e: Error) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);
  useEvents((e) => { if (e.type.startsWith("trade.") || e.type === "policy.updated") load(); });

  const submit = async () => {
    if (!draft || !isOwner) return;
    setTx({ state: "pending" });
    try {
      const hash = await ownerWrite(caps?.chain.network, s!.address!, "setPolicy", [s!.agent, { ...draft, maxNotionalPerTrade: BigInt(draft.maxNotionalPerTrade), maxDailyNotional: BigInt(draft.maxDailyNotional) }]);
      setTx({ state: "confirmed", hash });
      load();
    } catch (e) { setTx({ state: "failed", error: (e as Error).message }); }
  };
  const w = useWallet();
  const isOwner = sameAddress(w.address, s?.owner);
  const locked = !isOwner;
  const day = Math.floor(Date.now() / 86400_000);
  const spent = (s?.trades ?? []).filter((t) => t.state !== "refused" && t.state !== "failed" && Math.floor(t.createdAt / 86400_000) === day).reduce((a, t) => a + (t.state === "settled" || t.state === "recorded" ? Math.floor((Number(t.filledQuantity ?? 0) * t.priceBps) / 100) : t.notionalCents), 0);
  const maxDaily = s?.policy?.maxDailyNotional ?? 0;
  const dirty = !!draft && !!s?.policy && JSON.stringify(draft) !== JSON.stringify(s.policy);

  return (
    <motion.div {...page} className="mx-auto max-w-[1300px] px-4 pb-12 pt-6 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Spending limits</h1>
      <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">Each trade is checked against these limits on-chain before an order goes to Gemini. Only the owner wallet can change them.</p>
      {err && <div className="mt-4 text-sm text-refused">{offline(err)}</div>}
      {s && !s.live && <div className="mt-4"><Badge kind="fixture">chain dry-run: policy is not on-chain</Badge></div>}

      <div className="mt-6 grid gap-4 lg:grid-cols-[420px_1fr]">
        <Panel title="Limits" right={s?.address && <span className="text-xs text-muted">Contract <Hash value={s.address} /></span>}>
          {!draft ? <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-10 rounded" />)}</div> : (
            <div className="space-y-5 p-4">
              <div className="flex items-center justify-between gap-3 rounded-lg bg-surface-2 px-3 py-2.5 text-sm">
                {w.address ? <span className="min-w-0 truncate">Connected <span className="mono">{short(w.address)}</span>{isOwner && <span className="ml-2 text-scored">owner</span>}</span> : <span className="text-muted">Owner wallet not connected</span>}
                {!w.address && <button onClick={() => connectWallet(caps?.chain.network)} className="shrink-0 rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-ink/85">Connect wallet</button>}
              </div>
              {w.error && <p className="text-xs text-refused">{w.error}</p>}
              {locked && s?.owner && <p className="text-xs text-muted">Only the owner {short(s.owner)} can change these limits.</p>}
              <fieldset disabled={locked} className="space-y-5 disabled:opacity-60">
              <Slider label="Max per trade" value={draft.maxNotionalPerTrade} min={0} max={5000} step={50} fmt={usd} onChange={(v) => setDraft({ ...draft, maxNotionalPerTrade: v })} />
              <Slider label="Max per day" value={draft.maxDailyNotional} min={0} max={50000} step={500} fmt={usd} onChange={(v) => setDraft({ ...draft, maxDailyNotional: v })} />
              <Slider label="Minimum edge after fees" value={draft.minEdgeBps} min={0} max={3000} step={25} fmt={(v) => `${(v / 100).toFixed(2)} pts`} onChange={(v) => setDraft({ ...draft, minEdgeBps: v })} />
              <div>
                <div className="label mb-2">Allowed categories</div>
                <div className="flex flex-wrap gap-1.5">
                  {CATS.map((c) => {
                    const bit = 1 << (s?.categories[c] ?? 0);
                    const on = (draft.allowedCategoryMask & bit) !== 0;
                    return <button key={c} onClick={() => setDraft({ ...draft, allowedCategoryMask: on ? draft.allowedCategoryMask & ~bit : draft.allowedCategoryMask | bit })} className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-oracle/50 text-oracle" : "border-hairline text-muted"}`}>{c}</button>;
                  })}
                </div>
              </div>
              <label className="flex items-center justify-between text-sm"><span>Pause agent</span>
                <button role="switch" aria-checked={draft.paused} onClick={() => setDraft({ ...draft, paused: !draft.paused })} className={`relative h-5 w-9 rounded-full border ${draft.paused ? "border-refused/60 bg-refused/20" : "border-hairline bg-black/5"}`}>
                  <motion.span layout className={`absolute top-0.5 h-3.5 w-3.5 rounded-full ${draft.paused ? "right-0.5 bg-refused" : "left-0.5 bg-muted"}`} />
                </button>
              </label>
              </fieldset>
              <button onClick={submit} disabled={locked || !dirty || tx.state === "pending" || !s?.live} className="w-full rounded-lg bg-ink py-2.5 text-sm font-medium text-white hover:bg-ink/85 disabled:opacity-40">
                {tx.state === "pending" ? "Confirm in your wallet…" : "Save limits (sign in wallet)"}
              </button>
              {tx.state === "confirmed" && <div className="text-xs text-scored">Confirmed <Hash value={tx.hash} href={explorer && tx.hash ? explorer + tx.hash : null} /></div>}
              {tx.state === "failed" && <div className="text-xs text-refused">{tx.error}</div>}
            </div>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title="Spent today (UTC)">
            <div className="p-4">
              <div className="flex items-baseline justify-between text-sm"><span className="num text-2xl">{usd(spent)}</span><span className="num text-muted">of {usd(maxDaily)}</span></div>
              <div className="mt-2 h-1.5 overflow-hidden rounded bg-black/5"><motion.div className={`h-full ${spent > maxDaily * 0.8 ? "bg-refused" : "bg-oracle"}`} initial={{ width: 0 }} animate={{ width: `${maxDaily ? Math.min(100, (spent / maxDaily) * 100) : 0}%` }} /></div>
            </div>
          </Panel>
          <Panel title="Trade history">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead><tr className="text-left">{["Time", "Market", "Order", "Edge", "Size", "Approved on-chain", "Gemini order", "Fill recorded"].map((h) => <th key={h} className="label px-4 py-2 font-normal">{h}</th>)}</tr></thead>
                <tbody className="divide-y divide-hairline">
                  {s && s.trades.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-muted">No trade attempts yet</td></tr>}
                  {s?.trades.map((t) => <Row key={t.id} t={t} explorer={explorer} />)}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      </div>
    </motion.div>
  );
}

function Row({ t, explorer }: { t: Trade; explorer: string | null }) {
  const refused = t.state === "refused" || t.state === "failed";
  return (
    <tr className={refused ? "bg-refused/[0.04]" : ""}>
      <td className="num whitespace-nowrap px-4 py-2 text-xs text-muted">{new Date(t.createdAt).toISOString().slice(11, 19)}</td>
      <td className="whitespace-nowrap px-4 py-2 text-xs"><Link href={`/m/${t.symbol}`} className="num hover:text-oracle">{t.symbol.replace("GEMI-", "")}</Link> {t.source !== "live" && <Badge kind="fixture">{t.source}</Badge>}</td>
      <td className="num whitespace-nowrap px-4 py-2 text-xs">{t.quantity} {t.outcome.toUpperCase()} @ {pct(t.priceBps, 0)}</td>
      <td className="num whitespace-nowrap px-4 py-2 text-xs">{(t.edgeBps / 100).toFixed(1)} pts</td>
      <td className="num px-4 py-2 text-xs">{usd(t.notionalCents)}</td>
      {t.state === "refused" ? <td colSpan={3} className="px-4 py-2 text-xs text-refused">{blocked(t.policyReason)}</td> : (<>
      <td className="px-4 py-2 text-xs">{t.authorizeTx ? <Hash value={t.authorizeTx} href={explorer ? explorer + t.authorizeTx : null} /> : "—"}</td>
      <td className="num px-4 py-2 text-xs">{t.orderId ?? "—"}{t.orderStatus && <span className="ml-1 text-muted">{t.orderStatus}</span>}</td>
      <td className="px-4 py-2 text-xs">{t.state === "failed" && !t.recordTx ? <span className="text-refused">{t.error}</span> : t.recordTx ? <Hash value={t.recordTx} href={explorer ? explorer + t.recordTx : null} /> : <span className="text-muted">{t.state}</span>}</td>
      </>)}
    </tr>
  );
}

function Slider({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <div className="flex items-baseline justify-between"><span className="label">{label}</span><span className="num text-sm text-oracle">{fmt(value)}</span></div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full accent-[#E5530A]" />
    </label>
  );
}
