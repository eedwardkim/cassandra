"use client";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { pct, short, type StreamEvent } from "@/lib/api";
import { useStream } from "./stream";

function line(e: StreamEvent): { sym?: string; text: string; tone: string } | null {
  switch (e.type) {
    case "council.start": return { sym: e.symbol, text: e.cached ? "council (cached)" : "council convened", tone: "text-muted" };
    case "council.final": return { sym: e.symbol, text: `judge ${pct(e.forecast.pBps)} vs market ${pct(e.forecast.marketMidBps)}`, tone: "text-oracle" };
    case "council.error": return { sym: e.symbol, text: "council failed", tone: "text-refused" };
    case "seal.committed": return { sym: e.commit.symbol, text: `sealed ${short(e.commit.commitTx)}`, tone: "text-oracle" };
    case "seal.revealed": return { sym: e.commit.symbol, text: `revealed ${pct(e.commit.pBps)}`, tone: "text-oracle" };
    case "seal.scored": return { sym: e.commit.symbol, text: `scored Brier ${e.commit.brierBps2 != null ? (e.commit.brierBps2 / 1e8).toFixed(3) : "—"}`, tone: "text-scored" };
    case "policy.checked": return { sym: e.symbol, text: e.ok ? `policy ok, edge ${e.edgeBps} bps` : `policy: ${e.reason}`, tone: e.ok ? "text-scored" : "text-refused" };
    case "trade.placed": return { sym: e.trade.symbol, text: `order ${e.trade.orderId} ${e.trade.orderStatus ?? ""}`, tone: "text-crowd" };
    case "trade.recorded": return { sym: e.trade.symbol, text: `TradeRecorded ${short(e.trade.recordTx)}`, tone: "text-oracle" };
    case "trade.refused": return { sym: e.trade.symbol, text: `refused: ${e.trade.policyReason ?? "—"}`, tone: "text-refused" };
    case "policy.updated": return { text: `policy set ${short(e.txHash)}`, tone: "text-oracle" };
    case "bias.update": return e.report.irrationality >= 35 ? { sym: e.report.symbol, text: `irrationality ${e.report.irrationality.toFixed(0)}`, tone: "text-ink" } : null;
    case "log": return e.level === "error" ? { text: e.message.slice(0, 80), tone: "text-refused" } : null;
    default: return null;
  }
}

export function Ticker() {
  const { feed, connected } = useStream();
  const rows = feed.map((e, i) => ({ e, l: line(e), k: `${feed.length - i}-${e.type}` })).filter((r) => r.l).slice(0, 18);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5"><span className="label">Wire</span><span className={`text-[0.66rem] ${connected ? "text-scored" : "text-muted"}`}>{connected ? "streaming" : "reconnecting"}</span></div>
      <ol className="flex-1 space-y-px overflow-hidden px-2 py-2 text-xs">
        {!rows.length && <li className="px-2 py-3 text-muted">Awaiting the first council, seal or trade.</li>}
        <AnimatePresence initial={false}>
          {rows.map(({ e, l, k }) => (
            <motion.li key={k} layout initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} className="rounded px-2 py-1.5 hover:bg-white/[0.03]">
              {l!.sym ? <Link href={`/m/${l!.sym}`} className="num block truncate text-[0.68rem] text-muted hover:text-ink">{l!.sym.replace("GEMI-", "")}</Link> : <span className="num block text-[0.68rem] text-muted">{e.type}</span>}
              <span className={`${l!.tone} num`}>{l!.text}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </div>
  );
}
