/**
 * RL8a (RELAY-166): the pure half of an ad change. What a change may be
 * (no delete action exists), how much daily spend it adds, whether the
 * company's daily cap allows it, why it was proposed, and whether a
 * reduction may run without a card. No database, no network; the worker's
 * `applyAdChange` and the `ad_change_log` table build on these.
 *
 * Money is integer minor units of `AD_CURRENCY` (TRY), same as RL4a.
 */

export const AD_PLATFORMS = ["google", "meta"] as const;
export type AdPlatform = (typeof AD_PLATFORMS)[number];

/** Every change Relay may ask a platform to make. Deleting is not one of them (design 6.7). */
export const AD_CHANGE_ACTIONS = [
  "pause",
  "resume",
  "set_daily_budget",
  "add_keyword",
  "add_negative_keyword",
  "update_ad_copy",
] as const;
export type AdChangeAction = (typeof AD_CHANGE_ACTIONS)[number];

export const AD_CHANGE_PHASES = ["intent", "result"] as const;
export type AdChangePhase = (typeof AD_CHANGE_PHASES)[number];

export const AD_CHANGE_OUTCOMES = ["applied", "rejected", "failed"] as const;
export type AdChangeOutcome = (typeof AD_CHANGE_OUTCOMES)[number];

export const AD_CHANGE_OUTCOME_CODES = [
  "cap_exceeded",
  "cap_unset",
  "platform_unreachable",
  "platform_error",
  "no_such_campaign",
] as const;
export type AdChangeOutcomeCode = (typeof AD_CHANGE_OUTCOME_CODES)[number];

export const AD_CHANGE_ACTOR_TYPES = ["agent", "human"] as const;
export type AdChangeActorType = (typeof AD_CHANGE_ACTOR_TYPES)[number];

export const AD_KEYWORD_MATCH_TYPES = ["exact", "phrase", "broad"] as const;
export type AdKeywordMatchType = (typeof AD_KEYWORD_MATCH_TYPES)[number];

/** An intent row with no result counts against the cap for this long. */
export const RESERVATION_TTL_MS = 10 * 60_000;
/** An `ad_change` card expires after this long (part b). */
export const AD_CHANGE_CARD_TTL_MS = 24 * 60 * 60_000;
/** `ad_change_log.outcome_detail` limit (the column CHECK). */
export const AD_CHANGE_DETAIL_MAX = 300;

/** What the proposer saw of the campaign; only the manual adapter reads it (b2). */
export type AdCampaignObserved = {
  campaignName: string;
  status: "enabled" | "paused";
  dailyBudgetMinor: number;
};

type AdChangeTarget = {
  platform: AdPlatform;
  accountId: string;
  campaignId: string;
  observed?: AdCampaignObserved;
};

export type AdChangeCommand =
  | (AdChangeTarget & { action: "pause" })
  | (AdChangeTarget & { action: "resume" })
  | (AdChangeTarget & { action: "set_daily_budget"; afterMinor: number })
  | (AdChangeTarget & {
      action: "add_keyword";
      adGroupId: string;
      keyword: string;
      matchType: AdKeywordMatchType;
    })
  | (AdChangeTarget & {
      action: "add_negative_keyword";
      keyword: string;
      matchType: AdKeywordMatchType;
    })
  | (AdChangeTarget & {
      action: "update_ad_copy";
      adGroupId: string;
      headlines: string[];
      descriptions: string[];
    });

/** The live state of the campaign a delta is computed against. */
export type AdCampaignBudget = {
  status: "enabled" | "paused";
  dailyBudgetMinor: number;
};

/**
 * Signed change to the company's live daily budget total (positive = more
 * daily spend). Only enabled campaigns count toward the total, so a budget
 * change on a paused campaign moves nothing until it is resumed, and the
 * resume carries the whole budget.
 */
export function budgetDelta(command: AdChangeCommand, campaign: AdCampaignBudget): number {
  switch (command.action) {
    case "pause":
      return campaign.status === "enabled" ? -campaign.dailyBudgetMinor : 0;
    case "resume":
      return campaign.status === "paused" ? campaign.dailyBudgetMinor : 0;
    case "set_daily_budget":
      return campaign.status === "enabled"
        ? command.afterMinor - campaign.dailyBudgetMinor
        : 0;
    case "add_keyword":
    case "add_negative_keyword":
    case "update_ad_copy":
      return 0;
  }
}

export type CheckCapInput = {
  currentTotalMinor: number;
  reservedMinor: number;
  deltaMinor: number;
  capMinor: number | null;
};

export type CheckCapResult =
  | { ok: true; totalAfterMinor: number }
  | { ok: false; code: "cap_exceeded" | "cap_unset"; totalAfterMinor: number };

/**
 * Live budgets + unapplied increases + this change against the daily cap.
 * A reduction (delta <= 0) always passes, even over the cap. With no cap
 * set every increase is refused (fail closed).
 */
export function checkCap(input: CheckCapInput): CheckCapResult {
  const totalAfterMinor = input.currentTotalMinor + input.reservedMinor + input.deltaMinor;
  if (input.deltaMinor <= 0) return { ok: true, totalAfterMinor };
  if (input.capMinor === null) return { ok: false, code: "cap_unset", totalAfterMinor };
  if (totalAfterMinor > input.capMinor) {
    return { ok: false, code: "cap_exceeded", totalAfterMinor };
  }
  return { ok: true, totalAfterMinor };
}

/**
 * Why a change was proposed. An agent must name the metric, its value and
 * the threshold it crossed next to its text; a person only writes text.
 */
export type AdChangeReason = {
  text: string;
  metric?: string | null;
  value?: number | null;
  threshold?: number | null;
};

export type ReasonParseResult =
  | { success: true; data: AdChangeReason }
  | { success: false; error: { issues: { path: string; message: string }[] } };

export type AdChangeReasonValidator = {
  safeParse(input: unknown): ReasonParseResult;
  parse(input: unknown): AdChangeReason;
};

const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isAbsent = (v: unknown) => v === undefined || v === null;

/**
 * Validator for an `AdChangeReason` given who acts. Hand-written with a
 * Zod-shaped `safeParse`/`parse` because `@relay/db` does not depend on Zod.
 */
export function adChangeReasonSchema(actorType: AdChangeActorType): AdChangeReasonValidator {
  const safeParse = (input: unknown): ReasonParseResult => {
    const issues: { path: string; message: string }[] = [];
    if (typeof input !== "object" || input === null) {
      return { success: false, error: { issues: [{ path: "", message: "expected an object" }] } };
    }
    const r = input as Record<string, unknown>;
    if (typeof r.text !== "string" || r.text.trim() === "") {
      issues.push({ path: "text", message: "text is required" });
    }
    const agent = actorType === "agent";
    if (agent ? typeof r.metric !== "string" || r.metric.trim() === "" : !isAbsent(r.metric) && typeof r.metric !== "string") {
      issues.push({ path: "metric", message: agent ? "metric is required" : "metric must be a string" });
    }
    for (const key of ["value", "threshold"] as const) {
      const ok = agent ? isFiniteNumber(r[key]) : isAbsent(r[key]) || isFiniteNumber(r[key]);
      if (!ok) issues.push({ path: key, message: `${key} must be a finite number` });
    }
    if (issues.length > 0) return { success: false, error: { issues } };
    return {
      success: true,
      data: {
        text: r.text as string,
        metric: (r.metric as string | null | undefined) ?? null,
        value: (r.value as number | null | undefined) ?? null,
        threshold: (r.threshold as number | null | undefined) ?? null,
      },
    };
  };
  return {
    safeParse,
    parse(input) {
      const parsed = safeParse(input);
      if (!parsed.success) {
        throw new Error(
          `invalid ad change reason: ${parsed.error.issues.map((i) => `${i.path} ${i.message}`).join("; ")}`,
        );
      }
      return parsed.data;
    },
  };
}

export type DecideAutonomyInput = {
  action: AdChangeAction;
  /** Signed budget delta of the proposal (`budgetDelta`). */
  deltaMinor: number;
  /** Autonomous reduction or pause results today (Europe/Istanbul day). */
  autonomousReductionsToday: number;
  liveChannelCount: number;
  channelLeadCount: number;
  /** False when the deciding days are "veri yok" or "olgunlaşmamış" (design 6.6). */
  dataMature: boolean;
};

export type AutonomyDecision = {
  decision: "autonomous" | "card";
  reason: string;
};

/** Design 6.7 autonomy guardrails 1-4 for a proposed reduction; 5 (undo + notify) is part b. */
export function decideAutonomy(input: DecideAutonomyInput): AutonomyDecision {
  const isPause = input.action === "pause";
  const isDecrease = input.action === "set_daily_budget" && input.deltaMinor < 0;
  if (!isPause && !isDecrease) {
    return { decision: "card", reason: "only a pause or a budget decrease may run without a card" };
  }
  if (input.autonomousReductionsToday >= 1) {
    return { decision: "card", reason: "guardrail 1: one autonomous reduction per day already used" };
  }
  if (input.liveChannelCount <= 1) {
    return { decision: "card", reason: "guardrail 2: this is the only live channel" };
  }
  if (isPause && input.channelLeadCount < 5) {
    return { decision: "card", reason: "guardrail 3: the channel has fewer than 5 leads" };
  }
  if (!input.dataMature) {
    return { decision: "card", reason: "guardrail 4: the deciding days are not mature" };
  }
  return { decision: "autonomous", reason: "all autonomy guardrails pass" };
}
