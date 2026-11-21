/**
 * Every rate limit in Relay, in one place.
 *
 * Two kinds of policy:
 * - `rate`: sliding-window request count (`limit` hits per `windowSec`).
 * - `concurrency`: at most `max` in-flight leases; a lease that is never
 *   released expires after `ttlSec`.
 *
 * These sit in front of the weekly token budgets (`token-limiter.ts`), which
 * cap spend. Rate policies cap burst and abuse; concurrency policies stop one
 * caller from holding many Anthropic streams at once.
 *
 * A limit resolves in this order, first match wins:
 * 1. the company's own setting (Settings → Rate limits, `companies.rate_limits`),
 *    clamped to the policy's `ceiling`;
 * 2. `RATE_LIMIT_OVERRIDES`, a platform-wide JSON object of policy name to
 *    number, e.g. `{"operator.chat.user.minute": 40, "stream.user": 5}`;
 * 3. the default below.
 */

export type RatePolicy = { kind: "rate"; limit: number; windowSec: number };
export type ConcurrencyPolicy = {
  kind: "concurrency";
  max: number;
  ttlSec: number;
};

export type RateLimitGroup = "customer" | "operator" | "panel" | "cron";

export type PolicyMeta = {
  group: RateLimitGroup;
  label: string;
  description: string;
  /** Highest value a company may set. Platform env overrides are not clamped. */
  ceiling: number;
};

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const rate = (limit: number, windowSec: number): RatePolicy => ({
  kind: "rate",
  limit,
  windowSec,
});
const concurrency = (max: number, ttlSec: number): ConcurrencyPolicy => ({
  kind: "concurrency",
  max,
  ttlSec,
});

export const RATE_POLICIES = {
  // Customer: public widget. Visitor = client IP, which is spoofable in
  // principle, so the per-company cap is the backstop that always holds.
  "widget.visitor.minute": rate(10, MINUTE),
  "widget.visitor.hour": rate(100, HOUR),
  "widget.company.minute": rate(300, MINUTE),

  // Customer: internal test chat in the dashboard.
  "customer.chat.user.minute": rate(20, MINUTE),

  // Customer: WhatsApp / Instagram DMs. Over the limit the message is still
  // stored; only the auto-reply is skipped.
  "inbound.sender.minute": rate(8, MINUTE),
  "inbound.sender.hour": rate(60, HOUR),
  "inbound.channel.minute": rate(240, MINUTE),

  // Customer: Instagram comment auto-replies.
  "comment.author.hour": rate(10, HOUR),
  "comment.channel.minute": rate(60, MINUTE),

  // Operator sessions.
  "operator.chat.user.minute": rate(20, MINUTE),
  "operator.chat.user.day": rate(1500, DAY),
  "operator.chat.company.minute": rate(120, MINUTE),
  "operator.approval.user.minute": rate(60, MINUTE),

  // Panel chat (master agent).
  "master.chat.user.minute": rate(20, MINUTE),
  "master.chat.user.day": rate(1500, DAY),

  // Cron sessions. Runs are checked when the tick creates them; approvals when
  // a member resumes a paused run.
  "cron.run.company.hour": rate(60, HOUR),
  "cron.run.job.hour": rate(12, HOUR),
  "cron.approval.user.minute": rate(30, MINUTE),

  // Handoff quick links (`/api/h/[token]`). The token is the only credential,
  // so every request, a wrong token included, counts against the caller's IP;
  // writes also count against the link itself. Answer now is per user.
  "handoff.link.ip.minute": rate(120, MINUTE),
  "handoff.link.write.minute": rate(30, MINUTE),
  "handoff.answer_now.user.minute": rate(10, MINUTE),

  // Report PDFs: each one is a headless Chromium print in the worker, one at a
  // time. A share link is public to whoever holds it, so per client IP; the
  // portal download is per user.
  "report.pdf.shared.ip.minute": rate(10, MINUTE),
  "report.pdf.user.minute": rate(10, MINUTE),

  // Marketing request-access form: public, so per client IP only.
  "access_request.ip.hour": rate(5, HOUR),

  // Ad click endpoint (koleva-web server-to-server). Per visitor it keys on
  // the salted, day-rotating IP subject hash, never the IP itself; the global
  // cap is the backstop across every visitor.
  "adclick.ip.minute": rate(10, MINUTE),
  "adclick.global.minute": rate(120, MINUTE),

  // Expensive non-chat work.
  "knowledge.ingest.user.hour": rate(30, HOUR),
  "upload.user.minute": rate(30, MINUTE),
} as const satisfies Record<string, RatePolicy>;

export const CONCURRENCY_POLICIES = {
  // One streaming turn per chat: a double-submit cannot fork a conversation.
  "stream.chat": concurrency(1, 3 * MINUTE),
  "stream.user": concurrency(3, 3 * MINUTE),
  "stream.visitor": concurrency(2, 3 * MINUTE),
  // Internal sessions (customer test, operator, panel) per company.
  "stream.company": concurrency(30, 3 * MINUTE),
  // Public widget streams get their own pool, so widget traffic can never
  // starve a company's own operator or panel sessions.
  "stream.widget.company": concurrency(40, 3 * MINUTE),
} as const satisfies Record<string, ConcurrencyPolicy>;

export type RatePolicyName = keyof typeof RATE_POLICIES;
export type ConcurrencyPolicyName = keyof typeof CONCURRENCY_POLICIES;
export type PolicyName = RatePolicyName | ConcurrencyPolicyName;

/** Company settings may go up to 10x a rate default. */
const rateCeiling = (name: RatePolicyName) => RATE_POLICIES[name].limit * 10;

/**
 * What the Settings page shows for each policy; only these are company-settable.
 * Not listed: `stream.chat` (one turn per chat is an invariant, not a knob),
 * and knowledge import / upload (their routes cannot yet trust a companyId).
 */
export const POLICY_META: Partial<Record<PolicyName, PolicyMeta>> = {
  "widget.visitor.minute": {
    group: "customer",
    label: "Widget messages per visitor / minute",
    description: "Per visitor IP on the website widget.",
    ceiling: rateCeiling("widget.visitor.minute"),
  },
  "widget.visitor.hour": {
    group: "customer",
    label: "Widget messages per visitor / hour",
    description: "Per visitor IP on the website widget.",
    ceiling: rateCeiling("widget.visitor.hour"),
  },
  "widget.company.minute": {
    group: "customer",
    label: "Widget messages per minute (all visitors)",
    description: "Backstop across every widget visitor.",
    ceiling: rateCeiling("widget.company.minute"),
  },
  "stream.visitor": {
    group: "customer",
    label: "Concurrent widget replies per visitor",
    description: "Replies streaming at the same time for one visitor.",
    ceiling: 10,
  },
  "stream.widget.company": {
    group: "customer",
    label: "Concurrent widget replies (all visitors)",
    description: "Widget replies streaming at the same time.",
    ceiling: 200,
  },
  "customer.chat.user.minute": {
    group: "customer",
    label: "Test chat messages per member / minute",
    description: "Dashboard test chat against customer agents.",
    ceiling: rateCeiling("customer.chat.user.minute"),
  },
  "inbound.sender.minute": {
    group: "customer",
    label: "Auto-replies per sender / minute",
    description: "WhatsApp and Instagram DMs. Over the limit the message is kept but not answered.",
    ceiling: rateCeiling("inbound.sender.minute"),
  },
  "inbound.sender.hour": {
    group: "customer",
    label: "Auto-replies per sender / hour",
    description: "WhatsApp and Instagram DMs.",
    ceiling: rateCeiling("inbound.sender.hour"),
  },
  "inbound.channel.minute": {
    group: "customer",
    label: "Auto-replies per channel / minute",
    description: "Across every sender on one WhatsApp or Instagram channel.",
    ceiling: rateCeiling("inbound.channel.minute"),
  },
  "comment.author.hour": {
    group: "customer",
    label: "Comment replies per author / hour",
    description: "Instagram comment auto-replies to one account.",
    ceiling: rateCeiling("comment.author.hour"),
  },
  "comment.channel.minute": {
    group: "customer",
    label: "Comment replies per channel / minute",
    description: "Instagram comment auto-replies across the channel.",
    ceiling: rateCeiling("comment.channel.minute"),
  },
  "operator.chat.user.minute": {
    group: "operator",
    label: "Operator messages per member / minute",
    description: "Operator session turns sent by one member.",
    ceiling: rateCeiling("operator.chat.user.minute"),
  },
  "operator.chat.user.day": {
    group: "operator",
    label: "Operator messages per member / day",
    description: "Rolling 24 hours.",
    ceiling: rateCeiling("operator.chat.user.day"),
  },
  "operator.chat.company.minute": {
    group: "operator",
    label: "Operator messages per minute (all members)",
    description: "Every operator session in the company.",
    ceiling: rateCeiling("operator.chat.company.minute"),
  },
  "operator.approval.user.minute": {
    group: "operator",
    label: "Approvals per member / minute",
    description: "Approving or rejecting pending operator actions.",
    ceiling: rateCeiling("operator.approval.user.minute"),
  },
  "stream.user": {
    group: "operator",
    label: "Concurrent replies per member",
    description: "Test, operator and panel chat replies streaming at once.",
    ceiling: 15,
  },
  "stream.company": {
    group: "operator",
    label: "Concurrent replies (all members)",
    description: "Internal chat replies streaming at once across the company.",
    ceiling: 150,
  },
  "master.chat.user.minute": {
    group: "panel",
    label: "Panel chat messages per member / minute",
    description: "Master agent in /chat.",
    ceiling: rateCeiling("master.chat.user.minute"),
  },
  "master.chat.user.day": {
    group: "panel",
    label: "Panel chat messages per member / day",
    description: "Rolling 24 hours.",
    ceiling: rateCeiling("master.chat.user.day"),
  },
  "cron.run.job.hour": {
    group: "cron",
    label: "Runs per job / hour",
    description: "A refused run is recorded as failed and the schedule moves on.",
    ceiling: rateCeiling("cron.run.job.hour"),
  },
  "cron.run.company.hour": {
    group: "cron",
    label: "Runs per hour (all jobs)",
    description: "Every cron job in the company.",
    ceiling: rateCeiling("cron.run.company.hour"),
  },
  "cron.approval.user.minute": {
    group: "cron",
    label: "Cron approvals per member / minute",
    description: "Resuming paused cron runs.",
    ceiling: rateCeiling("cron.approval.user.minute"),
  },
};

export const RATE_LIMIT_GROUPS: Array<{ id: RateLimitGroup; label: string }> = [
  { id: "customer", label: "Customer sessions" },
  { id: "operator", label: "Operator sessions" },
  { id: "panel", label: "Panel chat" },
  { id: "cron", label: "Cron sessions" },
];

/** Company-level overrides: policy name to limit. */
export type RateLimitOverrides = Partial<Record<PolicyName, number>>;

export function isPolicyName(name: string): name is PolicyName {
  return name in RATE_POLICIES || name in CONCURRENCY_POLICIES;
}

/**
 * Keep only settable policies with whole, non-negative numbers, clamped to
 * each policy's ceiling. Anything else is dropped, so a stored value can never
 * name an unknown policy or exceed what the platform allows.
 */
export function sanitizeCompanyOverrides(input: unknown): RateLimitOverrides {
  const out: RateLimitOverrides = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return out;
  for (const [name, value] of Object.entries(input)) {
    if (!isPolicyName(name)) continue;
    const meta = POLICY_META[name];
    if (!meta) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
    out[name] = Math.min(Math.floor(value), meta.ceiling);
  }
  return out;
}

let cachedEnv: { raw: string | undefined; parsed: Record<string, number> } | null =
  null;

function envOverrides(): Record<string, number> {
  const raw = process.env.RATE_LIMIT_OVERRIDES;
  if (cachedEnv && cachedEnv.raw === raw) {
    return cachedEnv.parsed;
  }
  let parsed: Record<string, number> = {};
  if (raw) {
    try {
      const value = JSON.parse(raw) as unknown;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        for (const [name, n] of Object.entries(value)) {
          if (typeof n === "number" && Number.isFinite(n) && n >= 0) {
            parsed[name] = Math.floor(n);
          }
        }
      }
    } catch {
      console.error("[rate-limit] RATE_LIMIT_OVERRIDES is not valid JSON; ignored");
      parsed = {};
    }
  }
  cachedEnv = { raw, parsed };
  return parsed;
}

/** The limit a company gets when it has not set its own. */
export function platformDefault(name: PolicyName): number {
  const env = envOverrides()[name];
  if (env !== undefined) return env;
  return name in RATE_POLICIES
    ? RATE_POLICIES[name as RatePolicyName].limit
    : CONCURRENCY_POLICIES[name as ConcurrencyPolicyName].max;
}

function companyValue(
  name: PolicyName,
  company: RateLimitOverrides | undefined,
): number | undefined {
  const value = company?.[name];
  const meta = POLICY_META[name];
  if (value === undefined || !meta) return undefined;
  return Math.min(value, meta.ceiling);
}

export function resolveRatePolicy(
  name: RatePolicyName,
  company?: RateLimitOverrides,
): RatePolicy {
  const base = RATE_POLICIES[name];
  const limit = companyValue(name, company) ?? platformDefault(name);
  return limit === base.limit ? base : { ...base, limit };
}

export function resolveConcurrencyPolicy(
  name: ConcurrencyPolicyName,
  company?: RateLimitOverrides,
): ConcurrencyPolicy {
  const base = CONCURRENCY_POLICIES[name];
  const max = companyValue(name, company) ?? platformDefault(name);
  return max === base.max ? base : { ...base, max };
}
