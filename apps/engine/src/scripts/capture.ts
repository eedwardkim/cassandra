/** pnpm capture [--settled] — saves real sandbox responses to fixtures/gemini/ for DRY_RUN_GEMINI=true. */
import * as g from "../gemini/index.js";

async function main() {
  const events = await g.rawActiveEvents();
  g.writeFixture("events", events);
  const symbols = events.flatMap((e) => (e.contracts ?? []).map((k) => k.instrumentSymbol).filter((s): s is string => !!s));
  const books: Record<string, unknown> = {};
  for (let i = 0; i < symbols.length; i += 10) {
    await Promise.all(symbols.slice(i, i + 10).map(async (s) => { const b = await g.rawBook(s).catch(() => null); if (b && (b.bids.length || b.asks.length)) books[s] = b; }));
  }
  g.writeFixture("books", books);
  console.log(`captured ${events.length} events, ${Object.keys(books).length} non-empty books → fixtures/gemini/`);
  if (process.argv.includes("--settled")) {
    const settled = await g.rawSettled();
    g.writeFixture("settled", settled);
    console.log(`captured ${settled.length} settled events`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
