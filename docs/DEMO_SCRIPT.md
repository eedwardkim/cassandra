# Demo script (about 2 minutes, one take)

**Before recording**
1. `curl -s $ENGINE/api/capabilities` shows gemini `live`, llm `live`, chain `live`.
2. `curl -s $ENGINE/api/markets | jq length` returns at least 20 and most have a `tick`.
3. `curl -s $ENGINE/api/ledger | jq .counts` shows `scored ≥ 3`; if not, run `pnpm demo:replay` after a tracked market expires.
4. Open `/policy` in a second tab with the owner wallet connected; max per trade at $25.00.

| Time | Click | Line |
| --- | --- | --- |
| 0:00–0:15 | `/`: point at one event card, market % next to Cassandra % for each strike | "These are Gemini prediction markets. Next to each market price is Cassandra's forecast." |
| 0:15–0:45 | Click **Largest gap**, then **Run a new forecast**; the four forecasters stream, the Judge lands | "The market says N%. Four models give their estimates, and the Judge combines them into M%." Read the top row of "Why the price may be off". |
| 0:45–1:05 | On-chain record: point at the Sealed tx hash and block | "This hash went on-chain at block B, before the market closes. The forecast can't be changed after." |
| 1:05–1:25 | Trade card: Approved on-chain → Order sent to Gemini → Fill recorded. `/policy`: drag **Max per trade** down, **Save limits**, sign in the wallet; the next forecast shows "Blocked by your limits: over the per-trade limit. No order sent to Gemini." | "The owner sets spending limits on-chain. I lower the per-trade limit, and the next trade is blocked before any order goes to Gemini." |
| 1:25–1:50 | `/ledger`: Brier, replay rows, **verify** on a revealed row | "When a market resolves, the contract scores the forecast. Verify recomputes the hash in the browser and checks it against the chain." |
| 1:50–2:00 | README "What we build next" | "Next: per-user Gemini accounts, and Gemini checking the limits contract itself." |

Afterwards restore max per trade to $25.00.
