# Relay — Agent briefing

Single session briefing for this repo. It is the current product, not the rewrite plan.

## What Relay is

Relay is an AI agent platform for agencies. A **company** owns customer-facing agents (widget, WhatsApp, Instagram, Shopify tools) and can also run **operator** agents for internal workbench chat (versions, company research connectors, Excel, web search).

**Stack:** pnpm/Turbo monorepo — `apps/web` (Next.js UI + API proxy), `packages/worker` (Anthropic chat + cron), `packages/db` (Drizzle schema), `packages/agent-ops` (shared CRUD functions for server actions). Auth is **NextAuth v5 + NexAuth OIDC**, not Better Auth, Clerk, or Convex. Database is **Postgres + Drizzle**. AI is **Vercel AI SDK v6 + Anthropic**.

## Shipped vs designed

| Area | Status | Source of truth |
| --- | --- | --- |
| Customer agents, widget, knowledge, NexAuth | **Shipped** | Code + [architecture](docs/architecture.md) |
| Instagram comments + Cloud DM sending | **Shipped** | Code + [Instagram spec](docs/superpowers/specs/2026-09-07-instagram-comments-dm-design.md) |
| Operator agents (`kind`, `/operator`, exclusive tools, members) | **Shipped** | Code + [operator spec](docs/superpowers/specs/2026-08-28-operator-agents-design.md) |
| Worker + cron (SSE proxy, scheduled operator runs) | **Shipped** | Code + [cron/worker spec](docs/superpowers/specs/2026-08-28-operator-cron-worker-design.md) |
| Panel Chat (`/chat`) and the master agent | **Removed** (`master` chats may remain in the DB, unreachable) | Commit `f0171cd`; specs in `docs/superpowers/specs/` are historical |

**Do not implement from** anything in `docs/archive/` (REWRITE_PLAN.md, plans/2026-02-08-*). Those are historical (Better Auth, OpenAI registry, `/dashboard` as the only home). Auth, AI APIs, and operator isolation in those files are wrong.

Full map: [docs/README.md](docs/README.md). Current layout: [docs/architecture.md](docs/architecture.md). Design system: [docs/design/README.md](docs/design/README.md).

## Commands

Scripts are in the root `package.json` (Turbo). Postgres runs separately: dev and `db:*` scripts need `DATABASE_URL`. The cron scheduler runs locally via `pnpm --filter @relay/worker dev:cron` (optional).

```bash
pnpm dev          # web + worker
pnpm build        # turbo build
pnpm lint         # turbo lint
pnpm test         # turbo test (Vitest, co-located *.test.ts)
pnpm --filter @relay/db migrate
```

```bash
# Docker (migrate, web, worker, cron — Postgres is external)
IMAGE_TAG=preprod ./docker-scripts.sh build
IMAGE_TAG=preprod docker compose up
```

## Architecture

### Runtimes

| Service | Role |
| --- | --- |
| **web** (`apps/web`) | Next.js UI + API proxy. No Anthropic calls. Proxies operator chat to worker via `WORKER_URL` + `WORKER_SECRET`. Cron approvals poke `CRON_URL`. |
| **worker** (`packages/worker`) | Anthropic streaming for operator + customer internal chat. HTTP on `:3001`. Single replica while inbound auto-reply is on: `serial-queue.ts` serialises runs per chat and per Instagram post in a process-local `Map`, so a second replica means interleaved runs and duplicate replies. |
| **cron** (`packages/worker`, `start:cron`) | Scheduled operator jobs (`cron_jobs` / `cron_runs`). Single replica; health on `:3011/healthz`. |

### Routes

Logged-in home is **`/home`** (`apps/web/src/lib/auth-paths.ts`); it is never page-gated. There is no `/dashboard` route — `(dashboard)/` is a route group, not a path segment. Non-owner members see a reduced sidebar and a page-restricted state on gated routes; they are not redirected to `/operator`.

### Key layers

**Auth:** NextAuth v5 + NexAuth OIDC (`apps/web/src/lib/auth.ts`) and Edge-safe config (`auth.config.ts`). `apps/web/src/proxy.ts` wraps `NextAuth(authConfig)` and uses `gateRequest` from `auth-paths.ts`. Helpers: `auth-server.ts` (`getSession`, `requireSession`). Localhost operator login: `AUTH_DEV_ENABLED` in `dev-auth.ts`.

**Authorization (do not collapse these):**

- Owner-only: `requireCompanyAccess`, `requireAgentAccess` in `apps/web/src/lib/authorization.ts` (customer resources)
- Membership / operator: `requireCompanyMembership`, `requireOperatorAgentAccess`, `requireOperatorAgentEdit`, `requireOperatorSessionApprove` in `apps/web/src/lib/operator/access.ts`

**Database:** Drizzle with `postgres` (not `pg`). Schema in `packages/db/src/schema/`. Connection in `apps/web/src/db/index.ts` and worker. Types via `InferSelectModel` / `InferInsertModel`.

**AI — two runtimes:**

- Customer: worker handles Anthropic; web proxies widget/chat.
- Operator sessions: `POST /api/operator/chat` → worker SSE proxy.
- Operator cron: worker cron service runs jobs; transcripts in `cron_run_messages`; approvals via `POST /api/operator/cron/actions/:id`.

**`@relay/agent-ops`** (`packages/agent-ops`: `customer/`, `operator/`, `shared/`) holds the CRUD functions web server actions call (customer agents/knowledge/channels/integrations, operator agents/versions/editors/cron-jobs/packages). There is no chat surface on top of it since the master agent was removed — do not invent one.

**Widget:** `public/widget.js` SSE from `/api/widget/[id]/chat`. Customer agents only.

**Operator:** `/operator` hub with **Sessions** and **Cron** tabs. Sessions: `chats.channelType = operator`. Cron: company-wide `cron_jobs` at `/operator?tab=cron&jobId=…`. Settings at `/operator/agents/[id]`.

## Agent kinds

| Kind | Purpose | Runtime | Audience |
| --- | --- | --- | --- |
| `customer` | Widget/WhatsApp/Instagram/Shopify-facing support agent | `/api/chat`, `/api/widget/[id]/chat` (web proxies to worker for Anthropic) | End customers of the company |
| `operator` | Internal versioned workbench agent (research connectors, Excel, web search, cron) | `/api/operator/chat` → worker SSE proxy; scheduled runs via the worker cron service | Company members via `/operator` |

`agents.kind` only ever takes `customer` \| `operator` — there is no third kind.

## Hard invariants

1. **`agents.kind` is `customer` \| `operator`, set at create, never updated.** No upgrade path between kinds.
2. **Runtimes stay isolated.** Customer tools live in the web/worker customer chat path. Operator exclusive tools live only under `apps/web/src/lib/operator/` and `/api/operator/*`. Do not register web search, research connectors, or Excel on the customer/widget path.
3. **Customer routes refuse `kind=operator`. Operator routes refuse `kind=customer`.** `/agents` lists customer only. Widget `agentId` must be customer.
4. **`requireCompanyAccess` / `requireAgentAccess` stay owner-only.** Membership, operator read/edit/approve live in `apps/web/src/lib/operator/access.ts`. Do not “simplify” by using owner-only checks on operator hub/chat.
5. **Research connectors are company-scoped and owner-configured.** Hunter, Snov and Google Places credentials live on `integrations.config` for the company; operator versions cannot define their own HTTP calls. API keys never go to the client, model, logs, or transcripts.
6. **In-chat outreach approval is the session starter** (`chats.userId`, `requireOperatorSessionApprove`). Cron approval is owner/editors of that agent (`requireOperatorAgentEdit`) — different rule.
7. **One inbound routing key, one channel.** A WhatsApp `phoneNumberId` and an Instagram `accountId` are unique across `channels` (`0016_channel_routing_keys`), because the Meta webhooks resolve a delivery by them. Two channels claiming one key means one company receives another's conversations; the webhook signature authenticates Meta, not the tenant.
8. **Send tools are opt-in** (`selectTools(..., { allowSendTools })`). The widget chat and the inbound and comment runs answer text a stranger wrote, so they never hold a tool that sends somewhere the run did not already choose.
9. **Client components never receive a config column.** `channels.config` and `integrations.config` hold credentials, and client props are serialised into the page. Project through `apps/web/src/lib/client-views.ts` at the boundary.
10. **Knowledge is per agent, shared across versions** — not copied on fork.
11. **Do not delete versions.** Do not invite users who have no `users` row (add member by existing email only).

## What the code does today

- Home after login: **`/home`**. Owners see Agents, Companies, Messaging, Analytics; members see a reduced sidebar.
- Operator hub: agent + version pickers, named sessions (`chats.channelType = operator`, `versionId` pinned), settings at `/operator/agents/[id]`.
- Create operator agent → `v1` with empty instructions and all tool toggles false. Fork copies instructions, toggles, and model; sets `parentVersionId`.
- Chat step caps: customer/widget **5** (`maxDuration` 30s); operator **10** (`maxDuration` 60s). Models via `getModel()` / `MODEL_KEYS` (`haiku` default) in `apps/web/src/lib/ai/`.
- Weekly token budget: `user` vs `widget` in `apps/web/src/lib/ai/token-limiter.ts`.

## Tech gotchas

- **Zod v4:** `z.record(z.string(), z.string())` — single-arg `z.record(z.string())` is invalid
- **AI SDK v6:** `UIMessage`, `convertToModelMessages`, `toUIMessageStreamResponse()` — not `Message` / `toDataStreamResponse`
- **React Compiler** is on — avoid patterns that break memoization
- **Tailwind CSS 4:** tokens in `globals.css` via `@theme inline`, not `tailwind.config`
- **`agents.kind` is immutable** after insert. Do not add operator tools to the customer chat path.

## Environment

Required vars are in `.env.example`. Key ones: `DATABASE_URL`, `AUTH_SECRET`, `NEXAUTH_*`, `ANTHROPIC_API_KEY` (worker/cron), `WORKER_URL`, `WORKER_SECRET`, `CRON_URL`. Postgres is not started by Docker Compose; point `DATABASE_URL` at your existing instance. Do not commit `.env`.

## Where to look

| Need | Path |
| --- | --- |
| Auth / Edge vs Node | `apps/web/src/lib/auth.config.ts`, `apps/web/src/lib/auth.ts`, `apps/web/src/proxy.ts` |
| Owner-only authz | `apps/web/src/lib/authorization.ts` |
| Membership / operator authz | `apps/web/src/lib/operator/access.ts` |
| Customer chat (worker) | `packages/worker/src/` (`handle-internal-chat.ts`, `handle-inbound-message.ts`, `handle-instagram-comment.ts`) |
| Operator tools / prompt / HTTP / Excel | `apps/web/src/lib/operator/` |
| Shared CRUD (server actions) | `packages/agent-ops/src/` (`customer/`, `operator/`) |
| Schema | `packages/db/src/schema/` (one table per file) |
| Validators | `apps/web/src/lib/validators/` (export schema + inferred type) |

## Conventions

- Server actions: `"use server"` → session → correct authz helper → Zod → Drizzle → `revalidatePath`.
- New UI agent feature → new `@relay/agent-ops` function → same change. If a function has no caller, or a feature has no function, the inventory is out of date — fix it in the same change.
- Zod v4: `z.record(z.string(), z.string())`.
- AI SDK v6: `UIMessage`, `convertToModelMessages`, `toUIMessageStreamResponse()` — not `toDataStreamResponse`.
- Tests: Vitest next to the module (`*.test.ts`). `pnpm test`.
- Do not commit `.env`. Session Excel files go under `storage/` (gitignored).
