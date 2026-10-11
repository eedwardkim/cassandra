# Demo script (about 2 minutes, one take)

**Before recording**
1. `curl -s $ENGINE/api/capabilities` shows gemini `live`, llm `live`, chain `live`.
2. `curl -s $ENGINE/api/markets | jq length` returns at least 20 and most have a `tick`.
3. `curl -s $ENGINE/api/ledger | jq .counts` shows `scored ≥ 3`; if not, run `pnpm demo:replay` after a tracked market expires.
4. Open `/policy` in a second tab with the owner wallet connected; max per trade at $25.00.

| Time | Click | Line |
| --- | --- | --- |
| 0:00–0:15 | `/`: point at one event card, market % next to Cassandra % for each strike | "These are Gemini prediction markets. For each one, Cassandra puts her own probability next to the market's." |
| 0:15–0:45 | Click **Largest gap**, then **Run a new forecast**; the four forecasters stream, the Judge lands | "Market says N%. Four forecasters argue; the Judge lands at M% and names the bias." Read the top row of "Why the price may be off". |
| 0:45–1:05 | On-chain record: point at the Sealed tx hash and block | "Sealed on-chain before the world finds out. Cassandra can't rewrite her forecast later." |
| 1:05–1:25 | Trade card: Approved on-chain → Order sent to Gemini → Fill recorded. `/policy`: drag **Max per trade** down, **Save limits**, sign in the wallet; the next forecast shows "Blocked by your limits: over the per-trade limit. No order sent to Gemini." | "The agent can only trade inside spending limits the owner signs on-chain. Lower the limit, and the chain blocks the trade before it reaches Gemini." |
| 1:25–1:50 | `/ledger`: Brier, replay rows, **verify** on a revealed row | "Resolved markets score her. Anyone can recompute the hash and see she was right before it was obvious." |
| 1:50–2:00 | README "What we build next" | "Next: Gemini settlement as the resolver, staked forecaster reputation, an open registry." |

Afterwards restore max per trade to $25.00.
