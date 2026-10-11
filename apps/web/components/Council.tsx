"use client";
import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { pct, type Forecast } from "@/lib/api";

export const PERSONAS = [
  { key: "actuary", name: "The Actuary", role: "reference class & base rate" },
  { key: "decomposer", name: "The Decomposer", role: "Fermi decomposition" },
  { key: "skeptic", name: "The Skeptic", role: "argues the crowd is right" },
  { key: "reporter", name: "The Reporter", role: "what changed in 72 h" },
] as const;

/** Pull the streamed argument text out of a partial JSON buffer. */
export function argumentOf(buf: string): string {
  const m = buf.match(/"argument"\s*:\s*"((?:[^"\\]|\\.)*)/);
  return m ? m[1]!.replace(/\\n/g, " ").replace(/\\"/g, '"') : "";
}
const probOf = (buf: string) => { const m = buf.match(/"probability"\s*:\s*([0-9.]+)/); return m ? Number(m[1]) : null; };

export function CouncilChamber({ forecast, live, running }: { forecast: Forecast | null; live: Record<string, string>; running: boolean }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {PERSONAS.map((p, i) => {
          const buf = live[p.key];
          const out = !running ? forecast?.personas[p.key] : undefined;
          const text = out?.argument || (buf != null ? argumentOf(buf) : "");
          const prob = out?.probability ?? (buf != null ? probOf(buf) : null);
          const streaming = running && buf != null;
          return (
            <motion.article key={p.key} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}
              className={`rounded-lg border bg-surface p-4 ${streaming ? "border-oracle/40" : "border-hairline"}`}>
              <header className="flex items-start justify-between gap-3">
                <div><div className="text-sm font-semibold leading-tight">{p.name}</div><div className="mt-0.5 text-[0.7rem] text-muted">{p.role}</div></div>
                <div className={`num rounded-md px-2 py-0.5 text-sm font-semibold ${prob != null ? "bg-orange-50 text-oracle" : "text-muted"}`}>{prob != null ? `${(prob * 100).toFixed(0)}%` : "—"}</div>
              </header>
              <p className={`mt-2.5 text-[0.82rem] leading-relaxed text-ink/80 ${streaming ? "caret" : ""} ${!streaming && !open[p.key] ? "line-clamp-4" : ""}`}>
                {text || <span className="text-muted">{running ? "thinking…" : "Not run yet."}</span>}
              </p>
              {!streaming && text.length > 260 && <button onClick={() => setOpen((o) => ({ ...o, [p.key]: !o[p.key] }))} className="mt-1 text-xs font-medium text-muted hover:text-ink">{open[p.key] ? "Show less" : "Show more"}</button>}
              {out?.cruxes?.length ? <ul className="mt-2 space-y-0.5 text-[0.7rem] text-muted">{out.cruxes.map((c) => <li key={c}>— {c}</li>)}</ul> : null}
            </motion.article>
          );
        })}
      </div>
      <Judge forecast={running ? null : forecast} running={running} />
    </div>
  );
}

function Judge({ forecast, running }: { forecast: Forecast | null; running: boolean }) {
  const p = forecast ? forecast.pBps / 10000 : null;
  return (
    <div className="mt-3">
      <AnimatePresence mode="wait">
        {forecast ? (
          <motion.div key={forecast.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
            className="rounded-lg border border-hairline bg-surface-2/60 p-4">
            <div className="flex flex-wrap items-center gap-5">
              <Dial p={p!} lo={forecast.loBps / 10000} hi={forecast.hiBps / 10000} market={forecast.marketMidBps / 10000} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-3"><span className="text-base font-semibold">Judge</span><span className="label">80% interval {pct(forecast.loBps, 0)}–{pct(forecast.hiBps, 0)}</span></div>
                <p className="mt-1 text-[0.82rem] leading-relaxed text-ink/85">{forecast.judge.rationale}</p>
                {forecast.judge.biasHints.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{forecast.judge.biasHints.map((b) => <span key={b} className="rounded-full border border-oracle/30 px-2 py-0.5 text-[0.68rem] text-oracle">{b}</span>)}</div>}
                {forecast.judge.whatWouldChangeMyMind.length > 0 && <div className="mt-2 text-[0.72rem] text-muted"><span className="label mr-1">Would change the forecast</span>{forecast.judge.whatWouldChangeMyMind.join(" · ")}</div>}
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div key="wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="hair grid h-28 place-items-center rounded-lg bg-surface/50 text-sm text-muted">
            {running ? "Trimmed mean of 4 forecasts, log-odds" : "No forecast yet"}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Dial({ p, lo, hi, market }: { p: number; lo: number; hi: number; market: number }) {
  const r = 38, c = 2 * Math.PI * r;
  const pos = (x: number) => ({ x: 48 + r * Math.sin(x * 2 * Math.PI), y: 48 - r * Math.cos(x * 2 * Math.PI) });
  const m = pos(market);
  return (
    <svg width="96" height="96" viewBox="0 0 96 96" aria-label={`Judge ${(p * 100).toFixed(0)}%`}>
      <circle cx="48" cy="48" r={r} stroke="rgba(16,24,40,0.1)" strokeWidth="6" fill="none" />
      <circle cx="48" cy="48" r={r} stroke="rgba(229,83,10,0.25)" strokeWidth="6" fill="none" strokeDasharray={`${(hi - lo) * c} ${c}`} transform={`rotate(${lo * 360 - 90} 48 48)`} />
      <motion.circle cx="48" cy="48" r={r} stroke="#E5530A" strokeWidth="2.5" fill="none" strokeLinecap="round" initial={{ strokeDasharray: `0 ${c}` }} animate={{ strokeDasharray: `${p * c} ${c}` }} transition={{ duration: 0.9, ease: "easeOut" }} transform="rotate(-90 48 48)" />
      <circle cx={m.x} cy={m.y} r="3.5" fill="#3B5BDB" />
      <text x="48" y="53" textAnchor="middle" className="num" fill="#0E1116" fontSize="17">{(p * 100).toFixed(0)}%</text>
    </svg>
  );
}
