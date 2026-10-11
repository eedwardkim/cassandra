"use client";
import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { api, ENGINE, type Capabilities, type StreamEvent } from "@/lib/api";

interface StreamCtx { caps: Capabilities | null; block: number | null; connected: boolean; feed: StreamEvent[]; subscribe: (fn: (e: StreamEvent) => void) => () => void; refreshCaps: () => void }
const Ctx = createContext<StreamCtx | null>(null);

export function StreamProvider({ children }: { children: React.ReactNode }) {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [block, setBlock] = useState<number | null>(null);
  const [connected, setConnected] = useState(false);
  const [feed, setFeed] = useState<StreamEvent[]>([]);
  const subs = useRef(new Set<(e: StreamEvent) => void>());
  const refreshCaps = useCallback(() => { api<Capabilities>("/api/capabilities").then((c) => { setCaps(c); if (c.chain.block) setBlock(c.chain.block); }).catch(() => setCaps(null)); }, []);

  useEffect(() => {
    refreshCaps();
    api<StreamEvent[]>("/api/events/recent").then((r) => setFeed((f) => (f.length ? f : r.filter((e) => e.type !== "council.delta" && e.type !== "tick" && e.type !== "block").reverse().slice(0, 40)))).catch(() => {});
    const es = new EventSource(`${ENGINE}/api/stream`);
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => {
      let e: StreamEvent;
      try { e = JSON.parse(m.data) as StreamEvent; } catch { return; }
      if (e.type === "block") { setBlock(e.number); return; }
      for (const fn of subs.current) fn(e);
      if (e.type !== "council.delta" && e.type !== "tick") setFeed((f) => [e, ...f].slice(0, 40));
    };
    return () => es.close();
  }, [refreshCaps]);

  const subscribe = useCallback((fn: (e: StreamEvent) => void) => { subs.current.add(fn); return () => { subs.current.delete(fn); }; }, []);
  return <Ctx.Provider value={{ caps, block, connected, feed, subscribe, refreshCaps }}>{children}</Ctx.Provider>;
}

export function useStream() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useStream outside StreamProvider");
  return c;
}
export function useEvents(fn: (e: StreamEvent) => void) {
  const { subscribe } = useStream();
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => subscribe((e) => ref.current(e)), [subscribe]);
}
