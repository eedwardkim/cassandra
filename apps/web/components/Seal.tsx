"use client";
import { motion, useReducedMotion } from "framer-motion";
import { BSCSCAN, type Commit } from "@/lib/api";
import { Hash } from "./ui";

/** Wax seal: stamps down, a ring ripples out (600 ms). Keyed on the commit tx so it fires on each new receipt. */
export function WaxSeal({ stampKey }: { stampKey: string | null }) {
  const reduce = useReducedMotion();
  if (!stampKey) return <div className="grid h-24 w-24 place-items-center rounded-full border border-dashed border-hairline text-[0.65rem] text-muted">unsealed</div>;
  return (
    <div className="relative h-24 w-24" key={stampKey}>
      {!reduce && <motion.span className="absolute inset-0 rounded-full border border-oracle" initial={{ scale: 0.8, opacity: 0.9 }} animate={{ scale: 1.9, opacity: 0 }} transition={{ duration: 0.6, delay: 0.25, ease: "easeOut" }} />}
      <motion.svg viewBox="0 0 100 100" className="absolute inset-0" initial={reduce ? false : { scale: 1.8, opacity: 0, rotate: -18 }} animate={{ scale: 1, opacity: 1, rotate: 0 }} transition={{ duration: 0.3, ease: [0.6, 0, 0.9, 0.5] }}>
        <defs><radialGradient id="wax" cx="40%" cy="35%"><stop offset="0" stopColor="#FFCB6B" /><stop offset="0.6" stopColor="#f0c14b" /><stop offset="1" stopColor="#9C6512" /></radialGradient></defs>
        <path d="M50 4 C62 6 66 2 74 10 C84 14 86 22 92 30 C96 40 94 46 96 54 C94 66 90 72 84 80 C76 88 70 90 60 94 C50 98 42 94 32 92 C22 88 16 82 10 74 C4 64 6 56 4 46 C6 36 8 28 16 20 C24 10 34 8 50 4 Z" fill="url(#wax)" />
        <circle cx="50" cy="50" r="30" fill="none" stroke="#7A4E0E" strokeWidth="1.2" opacity="0.6" />
        <text x="50" y="62" textAnchor="middle" fontSize="34" fontStyle="italic" fill="#7A4E0E" fontFamily="Georgia, serif">C</text>
      </motion.svg>
    </div>
  );
}

const STEPS = [
  { key: "sealed", label: "Sealed", tx: (c: Commit) => c.commitTx, sub: (c: Commit) => (c.commitBlock ? `block ${c.commitBlock}` : "") },
  { key: "revealed", label: "Revealed", tx: (c: Commit) => c.revealTx, sub: (c: Commit) => `p = ${(c.pBps / 100).toFixed(1)}%` },
  { key: "scored", label: "Scored", tx: (c: Commit) => c.scoreTx, sub: (c: Commit) => (c.brierBps2 != null ? `Brier ${(c.brierBps2 / 1e8).toFixed(3)} · ${c.outcomeYes ? "YES" : "NO"}` : "at resolution") },
] as const;

export function SealTimeline({ commit, explorer }: { commit: Commit | null; explorer: string | null }) {
  const order = ["pending", "sealed", "revealed", "scored"];
  const at = commit ? order.indexOf(commit.state) : -1;
  return (
    <ol className="relative space-y-4 pl-5">
      <span className="absolute bottom-2 left-[5px] top-2 w-px bg-hairline" />
      {STEPS.map((s, i) => {
        const done = at >= i + 1;
        const tx = commit ? s.tx(commit) : null;
        return (
          <li key={s.key} className="relative">
            <motion.span className={`absolute -left-5 top-1 h-2.5 w-2.5 rounded-full border ${done ? (s.key === "scored" ? "border-scored bg-scored" : "border-oracle bg-oracle") : "border-hairline bg-bg"}`} animate={done ? { scale: [1.6, 1] } : {}} />
            <div className="flex items-baseline justify-between gap-2"><span className={done ? "text-ink" : "text-muted"}>{s.label}</span>{commit?.state === "pending" && i === 0 && <span className="text-[0.68rem] text-oracle">awaiting receipt</span>}</div>
            <div className="mt-0.5 text-xs">{tx ? <Hash value={tx} href={explorer ? `${explorer}${tx}` : null} /> : <span className="text-muted">—</span>}</div>
            {commit && done && <div className="num mt-0.5 text-[0.68rem] text-muted">{s.sub(commit)}</div>}
          </li>
        );
      })}
    </ol>
  );
}
export { BSCSCAN };
