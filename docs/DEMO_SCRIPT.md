# Demo script (≈115 s, one take)

**Before recording**
1. `curl -s $ENGINE/api/capabilities` shows gemini `live`, llm `live`, chain `live`, `demoMode: true`.
2. `curl -s $ENGINE/api/markets | jq length` returns 24.
3. `curl -s $ENGINE/api/ledger | jq .counts` shows `scored ≥ 3`; if not, run `pnpm demo:replay` after a tracked market expires.
4. Pick the top card under "Most irrational right now" on `/`. Click **Run council now** on its Dossier once so the cache is warm.
5. Open `/policy` in a second tab, max per trade at $25.00.

| Time | Click | Line |
| --- | --- | --- |
| 0:00–0:15 | `/`: gauge settles; hover two nodes | "Every dot is a live Gemini prediction market. Color is how irrational its price is right now." |
| 0:15–0:45 | Click the hottest node, **Run council now**; personas stream, the Judge card flips | "Market says N%. Four forecasters argue; the Judge lands at M% and names the bias." Read the top Bias Spectrometer row. |
| 0:45–1:05 | Wax seal stamps; point at the Sealed tx hash and block | "Sealed on-chain before the world finds out. Cassandra can't rewrite her forecast later." |
| 1:05–1:25 | Trade card: policy result + Gemini sandbox order id. `/policy`: drag **Max per trade** to $1.00, **Sign setPolicy**; back, Run council now: Trade card turns red with the contract's reason | "The agent trades inside limits the human set on-chain. Tighten the leash, and the chain refuses the next trade." |
| 1:25–1:50 | `/ledger`: Brier, replay rows, **verify** on a revealed row | "Resolved markets score her. Anyone can recompute the hash and see she was right before it was obvious." |
| 1:50–2:00 | README "What we build next" | "Next: Gemini settlement as the resolver, staked forecaster reputation, an open registry." |

Afterwards restore max per trade to $25.00.
