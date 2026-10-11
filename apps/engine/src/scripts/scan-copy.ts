/** pnpm scan:copy — reports banned phrases in cached council output (engine.db forecasts + fixtures). Reports only; never edits. */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { bannedHits } from "@cassandra/shared";
import { config } from "../config.js";
import { sqlite } from "../db/index.js";

let total = 0;
const report = (where: string, text: string) => {
  const hits = bannedHits(text);
  if (hits.length) { total += hits.length; console.log(`${where}: ${hits.join(", ")}`); }
};
type P = { name?: string; argument?: string; cruxes?: string[] };
const list = (x: unknown): P[] => (Array.isArray(x) ? x : x && typeof x === "object" ? Object.entries(x as Record<string, P>).map(([name, v]) => ({ name, ...v })) : []);
const texts = (j: { personas?: unknown; judge?: { rationale?: string; whatWouldChangeMyMind?: string[] } }) => [
  ...list(j.personas).map((p) => [p.name ?? "persona", [p.argument ?? "", ...(p.cruxes ?? [])].join(" ")] as const),
  ["judge", [j.judge?.rationale ?? "", ...(j.judge?.whatWouldChangeMyMind ?? [])].join(" ")] as const,
];
const rows = sqlite.prepare("SELECT id, symbol, json FROM forecasts").all() as { id: string; symbol: string; json: string }[];
for (const r of rows) for (const [who, t] of texts(JSON.parse(r.json))) report(`forecast ${r.id} ${r.symbol} ${who}`, t);
const dir = join(config.fixturesDir, "council");
const fixtures = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")) : [];
for (const f of fixtures) for (const [who, t] of texts(JSON.parse(readFileSync(join(dir, f), "utf8")))) report(`fixture ${f} ${who}`, t);
console.log(`scanned ${rows.length} cached forecasts and ${fixtures.length} council fixtures: ${total} banned-phrase hits`);
