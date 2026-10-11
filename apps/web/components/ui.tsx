"use client";
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { useEffect, useState } from "react";

export function Badge({ kind, children }: { kind: "fixture" | "replay" | "live" | "refused" | "scored"; children: React.ReactNode }) {
  const c = { fixture: "border-oracle/50 text-oracle bg-oracle/10", replay: "border-crowd/40 text-crowd bg-crowd/10", live: "border-hairline text-muted", refused: "border-refused/50 text-refused bg-refused/10", scored: "border-scored/50 text-scored bg-scored/10" }[kind];
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.66rem] uppercase tracking-[0.12em] ${c}`}>{children}</span>;
}

/** Spring-tweened number. */
export function Num({ value, format = (v: number) => v.toFixed(0), className = "" }: { value: number | null | undefined; format?: (v: number) => string; className?: string }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(value ?? 0);
  const text = useTransform(mv, (v) => format(v));
  useEffect(() => {
    if (value == null) return;
    if (reduce) { mv.set(value); return; }
    const a = animate(mv, value, { type: "spring", stiffness: 90, damping: 20 });
    return () => a.stop();
  }, [value, reduce, mv]);
  if (value == null) return <span className={`num text-muted ${className}`}>—</span>;
  return <motion.span className={`num ${className}`}>{text}</motion.span>;
}

export function Hash({ value, href }: { value?: string | null; href?: string | null }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="num text-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      {href ? <a href={href} target="_blank" rel="noreferrer" className="num text-oracle hover:underline">{value.slice(0, 6)}…{value.slice(-4)}</a> : <span className="num">{value.slice(0, 6)}…{value.slice(-4)}</span>}
      <button aria-label="copy" onClick={() => { navigator.clipboard?.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1200); }} className="text-muted hover:text-ink">
        {copied ? <span className="text-[0.65rem] text-scored">copied</span> : (
          <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="5" y="5" width="9" height="9" rx="1.5" /><path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" /></svg>
        )}
      </button>
    </span>
  );
}

export function Panel({ title, right, children, className = "" }: { title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`hair rounded-lg bg-surface/80 ${className}`}>
      {title && <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5"><span className="label">{title}</span>{right}</div>}
      {children}
    </section>
  );
}

export const page = { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0, transition: { duration: 0.32, ease: "easeOut" as const } } };
