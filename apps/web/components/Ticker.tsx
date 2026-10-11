"use client";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { blocked, marketLabel, pct, short, type StreamEvent } from "@/lib/api";
import { useStream } from "./stream";

function line(e: StreamEvent): { sym?: string; text: string; tone: string } | null {
  switch (e.type) {
    case "council.start": return { sym: e.symbol, text: e.cached ? "council (cached)" : "council convened", tone: "text-muted" };
    case "council.final": return { sym: e.symbol, text: `judge ${pct(e.forecast.pBps)} vs market ${pct(e.forecast.marketMidBps)}`, tone: "text-oracle" };
    case "council.error": return { sym: e.symbol, text: "council failed", tone: "text-refused" };
    case "seal.committed": return { sym: e.commit.symbol, text: `sealed ${short(e.commit.commitTx)}`, tone: "text-oracle" };
    case "seal.revealed": return { sym: e.commit.symbol, text: `revealed ${pct(e.commit.pBps)}`, tone: "text-oracle" };
    case "seal.scored": return { sym: e.commit.symbol, text: `scored Brier ${e.commit.brierBps2 != null ? (e.commit.brierBps2 / 1e8).toFixed(3) : "—"}`, tone: "text-scored" };
    case "policy.checked": return { sym: e.symbol, text: e.ok ? `within limits, edge ${e.edgeBps} bps` : blocked(e.reason), tone: e.ok ? "text-scored" : "text-refused" };
    case "trade.placed": return { sym: e.trade.symbol, text: `order ${e.trade.orderId} ${e.trade.orderStatus ?? ""}`, tone: "text-crowd" };
    case "trade.authorized": return { sym: e.trade.symbol, text: `approved on-chain ${short(e.trade.authorizeTx)}`, tone: "text-scored" };
    case "trade.settled": return { sym: e.trade.symbol, text: `fill recorded ${short(e.trade.recordTx)}`, tone: "text-oracle" };
    case "trade.refused": return { sym: e.trade.symbol, text: e.trade.orderId ? `order failed: ${e.trade.error ?? "—"}` : blocked(e.trade.policyReason), tone: "text-refused" };
    case "policy.updated": return { text: `limits updated ${short(e.txHash)}`, tone: "text-oracle" };
    case "bias.update": return e.report.irrationality >= 35 ? { sym: e.report.symbol, text: `irrationality ${e.report.irrationality.toFixed(0)}`, tone: "text-ink" } : null;
    case "log": return e.level === "error" ? { text: e.message.slice(0, 80), tone: "text-refused" } : null;
    default: return null;
  }
}

const market = marketLabel;
const stamp = (e: StreamEvent): number | null => {
  if ("ts" in e) return e.ts;
  if ("report" in e) return e.report.ts;
  if ("forecast" in e) return e.forecast.createdAt;
  if ("trade" in e) return e.trade.createdAt;
  if ("commit" in e) return e.commit.createdAt;
  return null;
};
const time = (e: StreamEvent) => { const t = stamp(e); return t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }) : ""; };

export function Ticker({ seed = [] }: { seed?: StreamEvent[] }) {
  const { feed: live, connected } = useStream();
  const feed = live.some((e) => line(e)) ? live : seed;
  const rows = feed.map((e, i) => ({ e, l: line(e), k: `${feed.length - i}-${e.type}` })).filter((r) => r.l).slice(0, 18);
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
        <h2 className="text-sm font-semibold">Activity</h2>
        <span className="flex items-center gap-1.5 text-xs text-muted"><span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-scored" : "bg-muted"}`} />{connected ? "Live" : "Reconnecting"}</span>
      </div>
      <ol className="max-h-[560px] divide-y divide-hairline overflow-hidden text-xs">
        {!rows.length && <li className="px-4 py-6 text-center text-muted">No activity yet.</li>}
        <AnimatePresence initial={false}>
          {rows.map(({ e, l, k }) => (
            <motion.li key={k} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex gap-3 px-4 py-2.5">
              <span className="num w-10 shrink-0 text-muted">{time(e)}</span>
              <span className="min-w-0 flex-1">
                {l!.sym && <Link href={`/m/${l!.sym}`} className="num block truncate font-medium text-ink hover:text-oracle">{market(l!.sym)}</Link>}
                <span className={`${l!.tone} num block truncate`}>{l!.text}</span>
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>
    </div>
  );
}
