# syntax=docker/dockerfile:1
# Production image for todoist-points (Next.js standalone output).
# Debian slim (not alpine) because better-sqlite3 is a native module —
# glibc prebuilds are the well-trodden path, and the toolchain below covers
# a source build if no prebuilt binary exists for this platform/Node combo.

# ---- deps: install node_modules ----
FROM node:24-bookworm-slim@sha256:b31e7a42fdf8b8aa5f5ed477c72d694301273f1069c5a2f71d53c6482e99a2fc AS deps
WORKDIR /app
# Toolchain for native modules (better-sqlite3) in case a prebuild isn't available.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

# ---- build: compile the Next.js app ----
FROM node:24-bookworm-slim@sha256:b31e7a42fdf8b8aa5f5ed477c72d694301273f1069c5a2f71d53c6482e99a2fc AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build
# Fail the build early if the better-sqlite3 native addon wasn't traced into
# the standalone output (it should be, via serverExternalPackages).
RUN test -f .next/standalone/node_modules/better-sqlite3/build/Release/better_sqlite3.node

# ---- runtime: slim, non-root ----
FROM node:24-bookworm-slim@sha256:b31e7a42fdf8b8aa5f5ed477c72d694301273f1069c5a2f71d53c6482e99a2fc AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000
# Standalone output ships server.js plus a traced node_modules
# (including better-sqlite3's compiled .node binary — verified above).
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
# SQLite lives on a mounted volume; compose sets DB_PATH=/data/todoist-points.db.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
