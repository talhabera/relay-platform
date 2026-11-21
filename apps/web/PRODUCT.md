# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Inferred from repo copy, authz, and nav — interview probe returned no human answer.**

- **Primary:** Agency **company owners**. They create companies, customer agents (widget / WhatsApp / Instagram), widget branding, members, messaging inbox, and analytics. They also use operator agents and panel Chat.
- **Secondary:** Company **members** (invited by existing email). They land on Chat, use the operator workbench (sessions, versions, cron, HTTP approvals), and settings. They do not own customer-agent CRUD, companies, messaging, or analytics.
- **End customers of agencies:** Talk to customer agents on the embeddable widget and messaging channels. They never see the dashboard.
- Situation: daytime laptop work; owners jump between client-facing config and the desk; members live in chat, versions, and approvals.

## Product Purpose

Relay is an AI agent platform for agencies. A company runs **customer** agents on public channels and **operator** agents for internal work. Success is: a client conversation is handled on the right channel with the right knowledge, while internal tool use (HTTP, Excel, search, cron) stays on a versioned desk with explicit approval.

## Positioning

**Confirmed in product copy and schema.** Customer and operator are two kinds, set at create, never converted. Customer tools and operator exclusive tools never share a runtime. Neighboring “one inbox for every AI agent” products cannot truthfully claim this split.

Tagline in use: “Customer agents on the channels. Operator agents at the desk.”

## Operating Context

- Signed-in home is **Chat** (`/chat`). `/dashboard` redirects there. Members and owners share Chat; members’ nav is Chat, Operator, Settings.
- **Chat** is a shell: master agent threads (private) plus live-operator sessions. Master can hand off into an operator session. `/operator` is the workbench for any version (including draft), HTTP endpoints, editors, knowledge, and cron.
- Customer agent config lives under `/agents` (owner-only). Widget appearance is per company. Knowledge is per agent, shared across operator versions, not copied on fork.
- Auth is NextAuth v5 + NexAuth OIDC. Sign-up is closed beta / invite-only. Localhost may use `AUTH_DEV_ENABLED`.
- Dark theme is the default; light exists. Inter + JetBrains Mono are the current faces (visual, not a brand commitment).

## Capabilities and Constraints

**Must preserve (product law, not visual):**

- `agents.kind` is `customer` | `operator`, immutable after insert. No upgrade path.
- Runtimes stay isolated. Customer tools vs operator exclusive tools vs master tools are three paths.
- Customer routes refuse operator agents; operator routes refuse customer agents. Widget `agentId` must be customer.
- Owner-only authz (`requireCompanyAccess` / `requireAgentAccess`) vs membership/operator authz (`src/lib/operator/access.ts`) stay distinct.
- Named HTTP endpoints are server-configured; model fills `argumentSchema` only. HTTPS, no localhost/private IPs. Header secrets never go to client, model, logs, or transcripts.
- In-chat HTTP approval is the session starter (`chats.userId`). Do not delete versions. Invite only users who already have a `users` row.
- Knowledge is per agent, shared across versions.

**Shipped surfaces:** marketing (landing, pricing, blog), auth, Chat, agents, operator hub + settings, companies + widget + members, messaging, analytics, settings, widget embed, 404, dashboard error.

**Undecided / do not invent:**

- Whether public self-serve billing is real. Pricing page shows Free / Pro / Enterprise but CTAs go to sign-in and copy also says closed beta. **Inferred: treat pricing as marketing fiction until billing exists; do not add checkout.**
- Blog posts are stubs (links to `#`). **Do not fabricate article bodies or customers.**
- Contact-sales and testimonials have no evidence.

## Brand Commitments

- Name: **Relay**.
- Voice: terse, precise, desk-not-hype. “The two kinds stay apart.”
- Mark: two verticals with a bridging path (existing SVG). Keep the name; the mark may be redrawn in a later visual world.
- No other locked identity (palette, type, era). User authorized a free redesign of look, layout, and design architecture after UX planning.

## Evidence on Hand

- Real product: Next.js 16 app in `apps/web`, operator/customer split in schema and routes, widget at `/widget.js` and `/company-widget/[id]`.
- Marketing copy in `src/components/landing/*` and page metadata.
- **Absent — do not fabricate:** customer logos, case studies, screenshots of live clients, press, usage numbers, testimonials, real pricing enforcement.

## Product Principles

1. **Kinds stay apart.** Customer channels and the operator desk must remain distinguishable in IA, chrome, and language — not merged into one “agent” blob.
2. **Chat is the desk; config is the back office.** Signed-in work starts in conversation; versions, HTTP, widget, and members are adjacent workbenches.
3. **Approval is a first-class act.** HTTP that needs a human is a card in the thread, not a buried setting.
4. **Invite, don’t harvest.** Closed beta; members are added by existing email; marketing must not pretend open signup.
5. **Say only what the product does.** No invented proof, logos, or billing.

## Accessibility & Inclusion

No product-specific standard was confirmed. **Inferred default:** keyboardable controls, visible focus, contrast that holds in both themes, no information by color alone. Widget must remain usable on a host site the agency does not control.
