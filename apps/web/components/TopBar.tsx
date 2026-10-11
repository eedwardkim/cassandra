"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { api, short, type PolicyState } from "@/lib/api";
import { useEvents, useStream } from "./stream";
import { Badge } from "./ui";

const NAV = [{ href: "/", label: "Field" }, { href: "/ledger", label: "Ledger" }, { href: "/policy", label: "Leash" }];

export function TopBar() {
  const { caps, block, connected } = useStream();
  const path = usePathname();
  const [paused, setPaused] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<PolicyState>("/api/policy").then((p) => setPaused(p.policy?.paused ?? null)).catch(() => {}); }, []);
  useEvents((e) => { if (e.type === "policy.updated") setPaused(e.policy.paused); });
  const toggle = async () => {
    if (paused == null || busy) return;
    setBusy(true);
    try { await api("/api/agent/pause", { method: "POST", body: JSON.stringify({ paused: !paused }) }); setPaused(!paused); } catch { /* surfaced on /policy */ }
    setBusy(false);
  };
  const net = caps?.chain.network === "bscTestnet" ? "BSC Testnet" : caps?.chain.network === "local" ? "Local anvil" : "Chain";
  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="display text-[1.65rem] italic leading-none text-ink">Cassandra</Link>
        <nav className="ml-2 flex gap-1 text-sm">
          {NAV.map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={`relative rounded px-2.5 py-1 transition-colors ${active ? "text-ink" : "text-muted hover:text-ink"}`}>
                {active && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded bg-white/[0.06]" transition={{ type: "spring", stiffness: 400, damping: 34 }} />}
                <span className="relative">{n.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-xs">
          {caps && caps.gemini.mode !== "live" && <Badge kind="fixture">Gemini fixture</Badge>}
          {caps && caps.llm.mode !== "live" && <Badge kind="fixture">LLM dry-run</Badge>}
          {caps && caps.chain.mode !== "live" && <Badge kind="fixture">chain dry-run</Badge>}
          {caps?.chain.network === "local" && <Badge kind="fixture">local chain</Badge>}
          <span className="hidden items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 md:flex" title="Gemini prediction-market sandbox">
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-crowd" : "bg-muted"}`} />
            <span className="text-muted">Gemini</span><span>{caps?.gemini.mode === "live" ? "sandbox live" : "—"}</span>
          </span>
          <span className="hidden items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-oracle" />
            <span className="text-muted">{net}</span><span className="num">#{block ?? "—"}</span>
          </span>
          {caps?.chain.agent && (
            <button onClick={toggle} disabled={busy || paused == null} className="flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 hover:border-white/20 disabled:opacity-60" title={paused ? "Agent paused on-chain. Click to resume." : "Agent trading within policy. Click to pause on-chain."}>
              <span className="text-muted">agent</span><span className="num">{short(caps.chain.agent)}</span>
              <span className={paused ? "text-refused" : "text-scored"}>{busy ? "signing" : paused ? "paused" : "active"}</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
