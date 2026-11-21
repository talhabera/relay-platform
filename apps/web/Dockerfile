FROM node:22-slim AS base
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/agent-ops/package.json packages/agent-ops/
COPY packages/worker/package.json packages/worker/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/db/ packages/db/
COPY packages/agent-ops/ packages/agent-ops/
COPY apps/web/ apps/web/
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
ENV AUTH_SECRET="build-time-dummy-secret"
# next build defaults to Turbopack in Next 16; that OOM-kills this image on 8GB hosts.
ENV NODE_OPTIONS="--max-old-space-size=3072"
RUN pnpm --filter @relay/web build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME="0.0.0.0"
ENV PORT=3000

RUN adduser --system --uid 1001 nextjs

COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
