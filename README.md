# Relay

AI agent platform for agencies. Companies run customer-facing agents (web widget, WhatsApp, Instagram, Shopify) and internal **operator** agents (versioned workbench, company research connectors, Excel, web search).

## Stack

Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui · Drizzle + Postgres · NextAuth v5 (NexAuth OIDC) · Vercel AI SDK v6 · Vitest

## Setup

```bash
cp .env.example .env                             # fill DATABASE_URL, AUTH_SECRET, NexAuth, ANTHROPIC_API_KEY
pnpm install                                     # Postgres must already be running
pnpm db:migrate
pnpm db:seed                                     # optional
pnpm dev                                         # http://localhost:3000
```

Localhost login: set `AUTH_DEV_ENABLED=true` and `AUTH_URL=http://localhost:3000`, plus `AUTH_DEV_USER` / `AUTH_DEV_PASSWORD`. Production login is NexAuth OIDC only.

```bash
pnpm test                # Vitest
pnpm lint
pnpm db:studio           # Drizzle Studio
```

## Repo map

| Path | What |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Agent briefing (invariants, shipped vs planned, commands, gotchas) |
| [docs/architecture.md](docs/architecture.md) | How the running app is structured |

## About this copy

This repository is a public snapshot of Relay. Client-specific setup, operational notes and internal design specs are not included, so some links in `AGENTS.md` and `CONTEXT.md` point at documents that are absent here.
