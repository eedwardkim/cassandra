"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Level { priceBps: number; amount: number }
interface Book { bids: Level[]; asks: Level[]; ts: number; source: string }

/** YES order book from the Gemini sandbox, refreshed every 4 s. Prices are % (¢ per $1 contract). */
export function OrderBook({ symbol, rows = 9 }: { symbol: string; rows?: number }) {
  const [book, setBook] = useState<Book | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    const load = () => api<Book>(`/api/markets/${encodeURIComponent(symbol)}/book`).then((b) => { if (on) { setBook(b); setErr(null); } }).catch((e: Error) => on && setErr(e.message));
    load();
    const t = setInterval(load, 4000);
    return () => { on = false; clearInterval(t); };
  }, [symbol]);
  const cum = (ls: Level[]) => { let s = 0; return ls.slice(0, rows).map((l) => ({ ...l, total: (s += l.amount) })); };
  const asks = cum(book?.asks ?? []), bids = cum(book?.bids ?? []);
  const max = Math.max(asks.at(-1)?.total ?? 0, bids.at(-1)?.total ?? 0, 1);
  const spread = book?.asks[0] && book?.bids[0] ? (book.asks[0].priceBps - book.bids[0].priceBps) / 100 : null;
  const mid = book?.asks[0] && book?.bids[0] ? (book.asks[0].priceBps + book.bids[0].priceBps) / 200 : null;
  const row = (l: Level & { total: number }, side: "ask" | "bid") => (
    <div key={`${side}${l.priceBps}`} className="relative grid grid-cols-3 px-3 py-[3px] text-[0.72rem]">
      <span className={`absolute inset-y-0 right-0 ${side === "ask" ? "bg-short/15" : "bg-long/15"}`} style={{ width: `${(l.total / max) * 100}%` }} />
      <span className={`num relative ${side === "ask" ? "text-short" : "text-long"}`}>{(l.priceBps / 100).toFixed(1)}</span>
      <span className="num relative text-right">{l.amount.toLocaleString("en-US")}</span>
      <span className="num relative text-right text-muted">{l.total.toLocaleString("en-US")}</span>
    </div>
  );
  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-3 px-3 py-2 text-[0.68rem] text-muted"><span>Price (%)</span><span className="text-right">Contracts</span><span className="text-right">Total</span></div>
      {err && <div className="px-3 py-6 text-center text-xs text-muted">Order book unavailable</div>}
      {!err && book && !asks.length && !bids.length && <div className="px-3 py-6 text-center text-xs text-muted">No orders on the book right now</div>}
      {!book && !err && <div className="space-y-1 px-3">{Array.from({ length: 10 }).map((_, i) => <div key={i} className="skeleton h-4 rounded" />)}</div>}
      <div className="flex flex-col-reverse">{asks.map((l) => row(l, "ask"))}</div>
      {(asks.length > 0 || bids.length > 0) && (
        <div className="flex items-baseline justify-between border-y border-hairline px-3 py-1.5">
          <span className="num text-base font-semibold">{mid != null ? mid.toFixed(1) : "—"}</span>
          <span className="num text-[0.68rem] text-muted">{spread != null ? `spread ${spread.toFixed(1)}` : ""}</span>
        </div>
      )}
      <div>{bids.map((l) => row(l, "bid"))}</div>
    </div>
  );
}
