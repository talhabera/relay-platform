/**
 * Ad constants and code validation for the ad click endpoint (RL4b). No
 * Node-only imports here: the Drizzle schema, which client components load
 * through `company-context.tsx`, imports from this file. `ad-click.ts`
 * re-exports it and holds the `node:crypto` helpers.
 * Money is an integer in minor units (kuruş); Koleva sells and spends in TRY
 * only, so the currency is a constant, not a column.
 */
export const AD_CURRENCY = "TRY";

export const AD_CHANNELS = ["google", "instagram", "meta"] as const;
export type AdChannel = (typeof AD_CHANNELS)[number];

/** First character of a 5-char ad code, per channel (K13). */
export const AD_CODE_PREFIX = {
  google: "G",
  instagram: "R",
  meta: "M",
} as const satisfies Record<AdChannel, string>;

/** Days a stored click can still bind to a lead. */
export const CLICK_TTL_DAYS = 7;

/** Fixed Meta codes (`MWEB1`..`MSOS3`), validated against the mapping table. */
export const META_FIXED_CODE_PATTERN = /^M[A-Z]{3}[0-9]$/;

const AD_CODE_PATTERN = /^[GMR][A-Z0-9]{4}$/;
// 0/O and 1/I look alike when a person reads a code back, so the four random
// chars never use them (K13). Meta fixed codes are exempt: they are words.
const CONFUSABLE = /[01OI]/;

/**
 * Whether `code` is a well-formed ad code: exactly 5 chars, first char the
 * channel letter (`G` Google, `R` Instagram, `M` Meta; `I` is never used because it reads like 1), no confusable characters in the rest.
 * Meta fixed codes (`^M[A-Z]{3}[0-9]$`) are accepted as-is. The code-less
 * intake value `organik` is never valid here and must not be looked up.
 */
export function isValidAdCode(code: unknown): boolean {
  if (typeof code !== "string") return false;
  if (META_FIXED_CODE_PATTERN.test(code)) return true;
  if (!AD_CODE_PATTERN.test(code)) return false;
  return !CONFUSABLE.test(code.slice(1));
}
