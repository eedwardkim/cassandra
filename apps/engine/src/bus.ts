import { EventEmitter } from "node:events";
import type { StreamEvent } from "@cassandra/shared";

const emitter = new EventEmitter();
emitter.setMaxListeners(200);
const recent: StreamEvent[] = [];

export const bus = {
  emit(e: StreamEvent) {
    recent.push(e);
    if (recent.length > 200) recent.shift();
    emitter.emit("e", e);
  },
  on(fn: (e: StreamEvent) => void) {
    emitter.on("e", fn);
    return () => emitter.off("e", fn);
  },
  recent: () => recent.slice(-60),
};

export const log = (level: "info" | "warn" | "error", message: string) => {
  (level === "error" ? console.error : console.log)(`[${level}] ${message}`);
  bus.emit({ type: "log", level, message, ts: Date.now() });
};
