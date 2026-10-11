# Cuts and decisions

| # | Decision | Why |
| --- | --- | --- |
| 1 | **Websocket quotes → REST polling** (5 s, order books) | The sandbox prediction contracts carry no prices in `listEvents`; `getCurrentOrderBook` per symbol is reliable. |
| 2 | **`wishfulThinking` and `horizonNeglect` cut from the live composite** (cut line 6) | Both are implemented and tested (`ALL_DETECTORS`), but the sandbox lists only Crypto/Commodities markets resolving within days, so neither can ever fire on live data. Keeping them in the composite would only add zero rows. |
| 3 | **Chain: local anvil instead of BSC Testnet** (cut line 7, last resort) | The `OWNER_PRIVATE_KEY`/`AGENT_PRIVATE_KEY` secrets held addresses, not keys, so two fresh wallets were generated. Every public tBNB faucet (BNB Chain, QuickNode) requires the wallet to hold mainnet BNB; Chainlink's BNB faucet only drips LINK. Contracts, commit/reveal, policy check, `TradeRecorded` and `Scored` all run as real transactions on an anvil chain (chain id 31337), and the UI badges it "local chain". `pnpm deploy:testnet` redeploys to chain 97 in one command once the owner holds ≥ 0.005 tBNB. |
| 4 | **Demo markets are crypto/commodity strike ladders**, not midterms/Fed | The sandbox has no politics or economics events. |
| 5 | **Strike-ladder events are not treated as mutually exclusive** | "$X or above" legs nest, so their YES prices legitimately sum past 100%. Overround uses YES ask + NO ask per contract there. |
| 6 | **Context.dev Reporter step skipped** | No `CONTEXT_DEV_API_KEY`; the Reporter says it is working from the price path only. |
| 7 | **Persona reasoning disabled** (`reasoning: "none"`) and arguments capped at 70 words | Model reasoning consumed the 350-token cap and truncated the JSON; fixed in the prompt/schema, never by retrying. |
| 8 | **Engine on Fly.io runs anvil in the same machine** (state on a volume) | Keeps the deployed demo self-contained while the chain is local. Switch with `CHAIN_NETWORK=bscTestnet`. |

## Spending limits and copy pass

- **One shared Gemini sandbox account.** Every agent trades through the same sandbox key held by
  `apps/engine/src/gateway.ts`. Per-user Gemini accounts are roadmap.
- **Exchange-side enforcement.** The chain gates our gateway, not Gemini itself; Gemini checking `AgentPolicy`
  before filling is next.
- **Resolver = owner key in the demo.** `RESOLVER_PRIVATE_KEY` is supported but unset, so it falls back to
  `OWNER_PRIVATE_KEY`. The policy owner address can still be a different wallet via `OWNER_ADDRESS`.
- **Smoke opens the edge floor.** The spending-limit proof sets min edge to 0 along with max per trade $0.00, because
  `check()` tests edge before notional; `--open-limits` also sets min edge 0 for the positive trade. Both restore the
  policy in a `finally`.
- **Foundry `Deploy.s.sol`** still makes the deployer the owner; the viem deploy (`pnpm deploy:local|testnet`) is the
  supported path and handles `OWNER_ADDRESS` via `transferOwnership`.
- **Field legend.** The force-field home view was replaced by market cards in the redesign, so its legend copy is gone.
- **`/rpc` and `/api/faucet-local`** exist only on the local chain. The passthrough also refuses `eth_sendTransaction`,
  `eth_sign*` and `eth_accounts`, since anvil's dev accounts can send without a signature.

- **MetaMask warns on the demo domain.** MetaMask (13.50) labels `cassandra-amber.vercel.app` "Malicious" when it asks to
  add chain 31337. Signing still works after the warning. Not reported to MetaMask/Blockaid yet; a custom domain is the fix.
- **`/rpc` uses an explicit method list, not `eth_*`.** Anvil answers `eth_sendUnsignedTransaction`, which sends as any
  funded address (including the policy owner) without a signature. Only read methods and `eth_sendRawTransaction` pass.
- **Forced council runs are limited to one per visitor every 2 minutes** (`POST /api/run/:symbol?force=1`), so a stranger
  can't burn the hourly council budget.
