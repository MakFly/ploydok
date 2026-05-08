# SPDX-License-Identifier: AGPL-3.0-only
# Production image for the Ploydok API (Bun runtime).
# Build context must be the monorepo root.
#   docker build -f apps/api/Dockerfile -t ghcr.io/makfly/ploydok-api:0.0.1 .

FROM oven/bun:1.3-debian AS builder
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      libsecret-1-dev \
      python3 \
      build-essential \
 && rm -rf /var/lib/apt/lists/*

COPY package.json bun.lock ./
COPY apps/api ./apps/api
COPY apps/web/package.json ./apps/web/package.json
COPY packages ./packages

RUN bun install --frozen-lockfile

FROM oven/bun:1.3-debian AS runtime
WORKDIR /app

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      libsecret-1-0 \
      tini \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3335

COPY --from=builder /app /app

EXPOSE 3335

WORKDIR /app/apps/api
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bun", "run", "src/index.ts"]
