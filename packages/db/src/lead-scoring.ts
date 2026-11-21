// Fit score scale and bands (lead scoring spec, decisions 1-2). Fixed in phase
// 1: no settings UI, no per-workflow bands. The Lead engine catalog entry
// (S81-82) reads these constants; nothing else should hard-code 70 or 50.

export const FIT_SCORE_MIN = 0;
export const FIT_SCORE_MAX = 100;
/** A fit score at or above this is a qualified lead. */
export const FIT_SCORE_QUALIFIED = 70;
/** 50-69 is borderline: a person accepts or rejects it. Under 50 is rejected. */
export const FIT_SCORE_BORDERLINE = 50;

export const LEAD_BANDS = ["qualified", "borderline", "rejected"] as const;
export type LeadBand = (typeof LEAD_BANDS)[number];

/** Same bounds as `company_records_score_chk`. */
export function isValidFitScore(score: unknown): score is number {
  return (
    typeof score === "number" &&
    Number.isInteger(score) &&
    score >= FIT_SCORE_MIN &&
    score <= FIT_SCORE_MAX
  );
}

/** The band a fit score falls in; null while the lead is unscored. */
export function fitScoreBand(score: number | null): LeadBand | null {
  if (score === null) return null;
  if (score >= FIT_SCORE_QUALIFIED) return "qualified";
  if (score >= FIT_SCORE_BORDERLINE) return "borderline";
  return "rejected";
}

/**
 * Statuses a lead may be delivered to the client from (W3GAP): qualified by
 * score or by a person accepting it as borderline, or interested after a
 * reply. `delivered` stays deliverable so a re-delivery refreshes the client's
 * copy (attribution spec, decision 7) without counting again.
 */
export const DELIVERABLE_LEAD_STATUSES = ["qualified", "interested", "delivered"] as const;

export function isDeliverableLeadStatus(status: string): boolean {
  return (DELIVERABLE_LEAD_STATUSES as readonly string[]).includes(status);
}
