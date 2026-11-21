FROM node:22-slim AS base
RUN corepack enable

FROM base AS build
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/agent-ops/package.json packages/agent-ops/
COPY packages/worker/package.json packages/worker/
RUN pnpm install --frozen-lockfile
COPY packages/db/ packages/db/
COPY packages/agent-ops/ packages/agent-ops/
COPY packages/worker/ packages/worker/

FROM base
# Chromium renders report PDFs (S89, POST /internal/reports/pdf).
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium fonts-liberation \
  && rm -rf /var/lib/apt/lists/*
ENV CHROMIUM_PATH=/usr/bin/chromium
WORKDIR /app
COPY --from=build /app ./
USER node
EXPOSE 3001
CMD ["pnpm", "--filter", "@relay/worker", "start"]
