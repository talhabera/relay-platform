# Relay architecture (current)

This is the **running app**, not the panel-chat or worker specs. Those change home, models, and where Anthropic runs; they are not in this tree yet.

## Stack

Next.js 16 App Router, React 19, TypeScript strict, Tailwind CSS 4 (`src/app/globals.css` `@theme inline`), shadcn/ui new-york, Drizzle + `postgres`, NextAuth v5 (NexAuth OIDC), Vercel AI SDK v6, Vitest. Package manager: **npm**.

`@/*` → `./src/*`. `next.config.ts`: `serverExternalPackages: ["postgres"]`, `output: "standalone"`, React Compiler on.

## Surfaces

```
Public
  (marketing)/     landing, pricing, blog
  (auth)/          sign-in, sign-up (closed beta; CTAs → /sign-in)
  /widget.js       embed script
  /api/widget/[id]/{config,chat}
  /company-widget/[id]

Signed-in (NextAuth JWT)
  (dashboard)/
    /dashboard     stats (owners). Members of the active company → /operator
    /agents        customer agents only
    /operator      operator hub + /operator/agents/[id] settings
    /companies     owner: company + widget + members (add by existing email)
    /messaging     /analytics  /settings
  /api/chat                customer test/dashboard chat
  /api/operator/chat       operator sessions
  /api/operator/actions    outreach approve/reject (session starter)
  /api/operator/sessions/.../files  Excel download (company members)
```

There is no `/chat`, `/api/master`, worker process, or `cron_*` tables.

## Two agent kinds

Same `agents` table. `kind` is not nullable, default `customer`, never patched after insert.

| | Customer | Operator |
| --- | --- | --- |
| UI | `/agents` | `/operator` |
| Chat API | `/api/chat`, widget | `/api/operator/chat` |
| Tools | knowledge, Shopify, messaging (`src/lib/ai/tools.ts`) | catalog in `src/lib/operator/tool-catalog.ts` |
| Config | `agents.instructions` + persona/language | **version** instructions + `toolToggles` |
| Knowledge | per agent | same table, per agent, **not** copied on fork |
| Who | company **owner** | company **members** (owner counts as member) |

Live operator tools: `web_search` (Anthropic `webSearch_20250305`), `createExcelWorkbook` (ExcelJS), company memory (`searchCompanyRecords`, `getCompanyRecord`, `upsertCompanyRecord`), `proposeAction`, and the always-on research tools `researchAccount`, `googlePlaces_searchCompany`, `hunter_findEmails`, `snov_findEmails` (company connectors, not version toggles). Coming soon: `whatsappNotification` (UI disabled, never registered).

## Auth and authorization

- Edge: `src/lib/auth.config.ts` + `src/proxy.ts`. **Do not import `@/db` here.**
- Node: `src/lib/auth.ts` jwt callback upserts `users` by email (`src/lib/users.ts`).
- Localhost credentials: `AUTH_DEV_ENABLED` + `AUTH_URL` host localhost (`src/lib/dev-auth.ts`).
- Public paths: marketing, auth, `/api/auth`, widget, `widget.js`, `/company-widget` (`src/lib/auth-paths.ts`). Logged-in auth-path redirect: **`/dashboard`**.
- Session helpers: `getSession` / `requireSession` in `src/lib/auth-server.ts`.

| Helper | Who | Use for |
| --- | --- | --- |
| `requireCompanyAccess` / `requireAgentAccess` | company `ownerId` only | customer CRUD, widget config, messaging, analytics |
| `requireCompanyMembership` | owner **or** `company_members` | operator hub, session download, listing member companies |
| `requireOperatorAgentAccess` | member + `kind=operator` | operator chat/read |
| `requireOperatorAgentEdit` | `createdByUserId` or `operator_agent_editors` | settings, fork, HTTP endpoints |
| `requireOperatorSessionApprove` | `chats.userId` (starter) + `channelType=operator` | in-chat outreach approval |

Company owner is **not** automatically an editor of someone else’s operator agent. Removing a member drops hub access and editor grants; it does not delete their operator agents.

## Data (operator-related)

- `company_members` — unique `(companyId, userId)`
- `agent_versions` — name unique per agent; `parentVersionId`; `toolToggles` jsonb
- `integrations` — company research connectors (`hunter`, `snov`, `google_places`); API keys in `config` jsonb, server-side only
- `operator_agent_editors`
- `chats` — `channelType` includes `operator`; operator rows require `versionId`; `userId` = starter
- `company_records` — research queue: `pending` \| `processing` \| `failed` \| `researched`, then outreach/lifecycle statuses
- `checkpoints` — approval cards; payload union keyed by `kind` (`outreach` \| `email_sequence` \| `post` \| `review_reply` \| `lead_delivery`); `pending` \| `approved` \| `changes_requested` \| `discarded` \| `stale` \| `failed`; nullable `recordId`, `supersededBy`, `attemptCount`, `artifactHash`. A cron run with open checkpoints sits in `cron_runs.status = awaiting_input`
- `session_files` — Excel metadata; bytes on disk under `storage/session-files/`

Sessions pin `versionId` and load **current** version config each turn. Editing `v2` affects all `v2` sessions; fork to experiment.

Outreach: the model never sends. `proposeOutreach` inserts a `checkpoints` row and streams an approval card; approval resolves to copy-only text via `POST /api/operator/actions/:id` (cron: `POST /api/operator/cron/actions/:id`). Outreach stays blocked until research succeeds.

Excel: max 10_000 rows, 5 MB (`OPERATOR_EXCEL_*` in `src/constants/index.ts`).

## AI

`streamText` → `toUIMessageStreamResponse()`. Persistence: `src/lib/ai/chat-persistence.ts`. Token records: `token_usage`, weekly caps in constants.

`getModel()` is Haiku `claude-haiku-4-5-20251001`. Panel-chat spec adds stored keys `haiku` \| `sonnet` \| `opus`; **not implemented**.

## Rate limiting

Postgres-backed (no Redis), shared by web, worker and cron, correct across replicas. Code: `packages/db/src/rate-limit/` (`@relay/db/rate-limit`).

- `policies.ts` — every limit. `rate` = sliding window (two fixed windows, weighted); `concurrency` = leases with a TTL. Tune live with `RATE_LIMIT_OVERRIDES`.
- `surfaces.ts` — which limits guard which entry point: widget, customer test chat, inbound DMs, IG comments, operator chat/approvals, panel chat, cron runs/approvals, knowledge ingest, upload.
- Web: `src/lib/rate-limit.ts` (`enforceSurface`, `holdUntilStreamEnds`, `clientIp`). Streaming routes hold `stream.*` leases until the response body closes. Denials return 429 with `Retry-After` and `RateLimit` headers.
- Webhooks never 429 Meta: over the limit the message is stored and only the auto-reply is skipped.
- Cron: the tick checks `cron.run.*` before creating a run; a refused run is stored as `failed` with the reason and the schedule advances. The cron service prunes expired rows every tick.
- The limiter fails open on store errors; weekly token budgets (`token_usage`) still cap spend.
- Per-company settings: owners edit limits at `/companies/[id]` → Rate limits (`companies.rate_limits` jsonb, `rate-limit-actions.ts`). Resolution: company value (clamped to the policy `ceiling` in `POLICY_META`) → `RATE_LIMIT_OVERRIDES` → code default. Only values that differ from the platform default are stored. Read through a 30s per-process cache. Upload and knowledge ingest stay platform-only: they run before the company is verified. `stream.chat` is not settable.
- Widget visitor IP = rightmost `X-Forwarded-For` entry (`TRUSTED_PROXY_HOPS`, default 1), not the spoofable leftmost.

## Nav (today)

Owners: Dashboard, Agents, Operator, Companies, Messaging, Analytics, Settings.  
Members: Dashboard (redirects to Operator), Operator, Settings.  
Header is a real top bar (`DashboardHeader`), not the overlay in the panel-chat spec.

## What is not here yet

See the panel-chat and cron/worker specs. In particular: `/chat` as home, `channelType=master`, version `status` live/draft, `agents.model` / `agent_versions.model`, `src/lib/master/`, pnpm workspaces, `packages/worker`, `cron_jobs`.
