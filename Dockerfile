# Engine image for Fly.io. Bundles anvil only for the explicitly-labelled local-chain fallback (CHAIN_NETWORK=local).
FROM ghcr.io/foundry-rs/foundry:stable AS foundry
FROM node:22-bookworm AS base
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY --from=foundry /usr/local/bin/anvil /usr/local/bin/cast /usr/local/bin/
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/engine/package.json apps/engine/
RUN pnpm install --frozen-lockfile --filter @cassandra/engine...
COPY packages/shared packages/shared
COPY apps/engine apps/engine
COPY fixtures fixtures
COPY scripts/engine-start.sh /usr/local/bin/engine-start
RUN chmod +x /usr/local/bin/engine-start
ENV NODE_ENV=production PORT=4000 ENGINE_DB=/data/engine.db
EXPOSE 4000
CMD ["engine-start"]
