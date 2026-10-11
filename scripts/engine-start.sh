#!/bin/sh
# Fly entrypoint. With CHAIN_NETWORK=local it runs a persistent anvil (state on the /data volume) and deploys the
# contracts once; with bscTestnet it talks to BSC Testnet using packages/shared/deployments/bscTestnet.json.
set -e
mkdir -p /data/deployments
export DEPLOYMENTS_DIR=/data/deployments/
[ -f /app/packages/shared/deployments/bscTestnet.json ] && [ ! -f /data/deployments/bscTestnet.json ] && cp /app/packages/shared/deployments/bscTestnet.json /data/deployments/
cd /app/apps/engine
if [ "${CHAIN_NETWORK:-bscTestnet}" = "local" ]; then
  anvil --host 127.0.0.1 --port 8545 --chain-id 31337 --state /data/anvil.json --state-interval 15 --silent &
  i=0; until cast block-number --rpc-url http://127.0.0.1:8545 >/dev/null 2>&1; do i=$((i+1)); [ $i -gt 100 ] && exit 1; sleep 0.2; done
  npx tsx src/scripts/deploy.ts local --if-stale
fi
exec npx tsx src/index.ts
