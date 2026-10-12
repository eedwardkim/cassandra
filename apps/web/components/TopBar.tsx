"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, marketLabel, pct, type MarketSummary, type PolicyState } from "@/lib/api";
import { useEvents, useStream } from "./stream";
import { Badge } from "./ui";
import { ownerWrite, sameAddress, useWallet } from "@/lib/wallet";

const NAV = [{ href: "/", label: "Markets" }, { href: "/ledger", label: "Track record" }, { href: "/policy", label: "Spending limits" }];

export function Logo() {
  return (
    <svg width="20" height="20" viewBox="0 0 14 14" aria-hidden><circle cx="7" cy="7" r="5.5" fill="none" stroke="#fafafa" strokeWidth="1.6" /><circle cx="7" cy="7" r="2.2" fill="#f0c14b" /></svg>
  );
}

export function TopBar() {
  const { caps, block, connected } = useStream();
  const path = usePathname();
  const [paused, setPaused] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<PolicyState>("/api/policy").then((p) => setPaused(p.policy?.paused ?? null)).catch(() => {}); }, []);
  useEvents((e) => { if (e.type === "policy.updated") setPaused(e.policy.paused); });
  const w = useWallet();
  const owner = caps?.chain.owner ?? null;
  const isOwner = sameAddress(w.address, owner);
  const toggle = async () => {
    if (!isOwner) { window.location.assign("/policy"); return; }
    if (paused == null || busy || !caps?.chain.policy) return;
    setBusy(true);
    try { await ownerWrite(caps.chain.network, caps.chain.policy, "setPaused", [caps.chain.agent, !paused]); setPaused(!paused); } catch { /* wallet shows the error */ } finally { setBusy(false); }
  };
  const net = caps?.chain.network === "bscTestnet" ? "BSC Testnet" : caps?.chain.network === "local" ? "Local chain" : "Chain";
  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-bg/95 backdrop-blur">
      <div className="flex h-14 items-center gap-6 px-4 sm:px-5">
        <Link href="/" className="flex items-center gap-2 text-[1.15rem] font-semibold tracking-tight"><Logo />Cassandra</Link>
        <nav className="flex gap-1 text-sm font-medium">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" || path.startsWith("/m/") : path.startsWith(n.href);
            return <Link key={n.href} href={n.href} className={`px-2.5 py-1.5 transition-colors ${active ? "text-ink" : "text-muted hover:text-ink"}`}>{n.label}</Link>;
          })}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-xs">
          {caps && caps.gemini.mode !== "live" && <Badge kind="fixture">Gemini fixture</Badge>}
          {caps && caps.llm.mode !== "live" && <Badge kind="fixture">LLM dry-run</Badge>}
          {caps && caps.chain.mode !== "live" && <Badge kind="fixture">chain dry-run</Badge>}
          <span className="hidden items-center gap-1.5 text-muted lg:flex" title="Gemini prediction-market sandbox">
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-scored" : "bg-muted"}`} />Gemini sandbox
          </span>
          <span className="hidden items-center gap-1.5 text-muted md:flex" title={caps?.chain.network === "local" ? "Contracts run on a local anvil chain until the testnet wallet is funded" : undefined}>
            {net} <span className="num mono text-ink">#{block ?? "—"}</span>
          </span>
          {caps?.chain.agent && (
            <button onClick={toggle} disabled={busy || (isOwner && paused == null)} className={`flex items-center gap-2 rounded-md px-3 py-1.5 font-semibold disabled:opacity-60 ${paused ? "border border-short/50 text-short" : "bg-long text-bg hover:bg-long/85"}`} title={!isOwner ? `Only the owner ${owner ? `${owner.slice(0, 6)}…${owner.slice(-4)}` : ""} can pause the agent. Connect the owner wallet on Spending limits.` : paused ? "Agent paused on-chain. Click to resume." : "Agent can trade within your limits. Click to pause."}>
              {busy ? "Signing…" : paused ? "Agent paused" : "Agent active"}
            </button>
          )}
        </div>
      </div>
      <Strip />
    </header>
  );
}

/** Tracked contracts with market and Cassandra prices, like an exchange ticker bar. */
function Strip() {
  const [ms, setMs] = useState<MarketSummary[]>([]);
  useEffect(() => {
    const load = () => api<MarketSummary[]>("/api/markets").then(setMs).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  useEvents((e) => { if (e.type === "tick") setMs((xs) => xs.map((m) => (m.symbol === e.symbol && m.tick ? { ...m, tick: { ...m.tick, midBps: e.midBps } } : m))); });
  const rows = ms.filter((m) => m.tick).sort((a, b) => b.depth - a.depth).slice(0, 16);
  if (!rows.length) return null;
  return (
    <div className="flex h-9 items-center gap-6 overflow-x-auto border-t border-hairline px-4 text-xs [scrollbar-width:none] sm:px-5">
      {rows.map((m) => {
        const gap = m.councilBps != null && m.tick ? (m.councilBps - m.tick.midBps) / 100 : null;
        return (
          <Link key={m.symbol} href={`/m/${m.symbol}`} className="flex shrink-0 items-center gap-2 hover:text-ink">
            <span className="font-medium">{marketLabel(m.symbol)}</span>
            <span className="num text-muted">{pct(m.tick!.midBps, 1)}</span>
            {gap != null && Math.abs(gap) >= 0.5 && <span className={`num ${gap > 0 ? "text-long" : "text-short"}`}>{gap > 0 ? "+" : ""}{gap.toFixed(1)}</span>}
          </Link>
        );
      })}
    </div>
  );
}
