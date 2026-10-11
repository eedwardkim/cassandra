"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, type PolicyState } from "@/lib/api";
import { useEvents, useStream } from "./stream";
import { Badge } from "./ui";
import { ownerWrite, sameAddress, useWallet } from "@/lib/wallet";

const NAV = [{ href: "/", label: "Markets" }, { href: "/ledger", label: "Track record" }, { href: "/policy", label: "Spending limits" }];

export function Logo() {
  return (
    <span className="grid h-7 w-7 place-items-center rounded-lg bg-ink">
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden><circle cx="7" cy="7" r="5.5" fill="none" stroke="#fff" strokeWidth="1.5" /><circle cx="7" cy="7" r="2.2" fill="#E5530A" /></svg>
    </span>
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
    <header className="sticky top-0 z-40 border-b border-hairline bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1280px] items-center gap-6 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-[1.05rem] font-semibold tracking-tight"><Logo />Cassandra</Link>
        <nav className="flex gap-1 text-sm font-medium">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" || path.startsWith("/m/") : path.startsWith(n.href);
            return <Link key={n.href} href={n.href} className={`rounded-lg px-3 py-1.5 transition-colors ${active ? "bg-surface-2 text-ink" : "text-muted hover:text-ink"}`}>{n.label}</Link>;
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
            <button onClick={toggle} disabled={busy || (isOwner && paused == null)} className="flex items-center gap-2 rounded-full border border-hairline bg-white px-3 py-1.5 font-medium hover:border-ink/30 disabled:opacity-60" title={!isOwner ? `Only the owner ${owner ? `${owner.slice(0, 6)}…${owner.slice(-4)}` : ""} can pause the agent. Connect the owner wallet on Spending limits.` : paused ? "Agent paused on-chain. Click to resume." : "Agent can trade within your limits. Click to pause."}>
              <span className={`h-1.5 w-1.5 rounded-full ${paused ? "bg-refused" : "bg-scored"}`} />
              {busy ? "Signing…" : paused ? "Agent paused" : "Agent active"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
