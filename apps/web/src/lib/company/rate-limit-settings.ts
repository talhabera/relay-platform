import {
  CONCURRENCY_POLICIES,
  POLICY_META,
  RATE_LIMIT_GROUPS,
  RATE_POLICIES,
  platformDefault,
  sanitizeCompanyOverrides,
  type PolicyName,
  type RateLimitGroup,
  type RateLimitOverrides,
} from "@relay/db/rate-limit";

/** One editable row on Company → Rate limits. Plain data, safe to send to the client. */
export type RateLimitSettingRow = {
  name: string;
  label: string;
  description: string;
  /** "per minute", "per hour", "per day" or "at once". */
  unit: string;
  /** Platform default: RATE_LIMIT_OVERRIDES env, else the code default. */
  defaultValue: number;
  ceiling: number;
  /** The company's own value, or null when it uses the default. */
  value: number | null;
};

export type RateLimitSettingGroup = {
  id: RateLimitGroup;
  label: string;
  rows: RateLimitSettingRow[];
};

function unitFor(name: PolicyName): string {
  if (name in CONCURRENCY_POLICIES) return "at once";
  const { windowSec } = RATE_POLICIES[name as keyof typeof RATE_POLICIES];
  if (windowSec === 60) return "per minute";
  if (windowSec === 3600) return "per hour";
  if (windowSec === 86_400) return "per day";
  return `per ${windowSec}s`;
}

/** Server only: platformDefault reads env. */
export function buildRateLimitSettings(stored: unknown): RateLimitSettingGroup[] {
  const overrides = sanitizeCompanyOverrides(stored);
  const entries = Object.entries(POLICY_META) as Array<
    [PolicyName, NonNullable<(typeof POLICY_META)[PolicyName]>]
  >;
  return RATE_LIMIT_GROUPS.map((group) => ({
    id: group.id,
    label: group.label,
    rows: entries
      .filter(([, meta]) => meta.group === group.id)
      .map(([name, meta]) => ({
        name,
        label: meta.label,
        description: meta.description,
        unit: unitFor(name),
        defaultValue: platformDefault(name),
        ceiling: meta.ceiling,
        value: overrides[name] ?? null,
      })),
  })).filter((group) => group.rows.length > 0);
}

/**
 * What gets stored: sanitized and clamped, and without values equal to the
 * platform default, so a later change to the default still reaches the company.
 */
export function normalizeRateLimitSettings(input: unknown): RateLimitOverrides {
  const sanitized = sanitizeCompanyOverrides(input);
  const out: RateLimitOverrides = {};
  for (const [name, value] of Object.entries(sanitized) as Array<
    [PolicyName, number]
  >) {
    if (value !== platformDefault(name)) out[name] = value;
  }
  return out;
}
