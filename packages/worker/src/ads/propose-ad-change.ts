import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import {
  AD_CHANGE_CARD_TTL_MS,
  AD_KEYWORD_MATCH_TYPES,
  AD_PLATFORMS,
  adChangeLog,
  adChangeReasonSchema,
  budgetDelta,
  checkCap,
  checkpointArtifactHash,
  checkpoints,
  db,
  decideAutonomy,
  RESERVATION_TTL_MS,
  type AdChangeCommand,
  type AdChannel,
  type AdPlatform,
} from "@relay/db";
import type { AdChangePayload } from "@relay/db/schema/checkpoints";
import {
  requireTryCampaigns,
  type AdCampaignState,
  type AdDateRange,
  type AdPlatformAdapter,
  type Result,
} from "../integrations/ads/adapter";
import { loadAdState } from "../operator/ad-state";
import {
  applyAdChange,
  defaultAdapterFor,
  pgAdChangeStore,
  type ApplyAdChangeInput,
  type ApplyAdChangeResult,
} from "./apply-ad-change";

/**
 * RL8b1 (RELAY-171): the only way the ad-manager agent changes an ad. The
 * path is decided here from the command and the numbers, never by the model:
 *
 * - over the daily cap (or no cap set, for an increase): refused before any
 *   card, and `applyAdChange(mode: "reject_only")` logs the refusal;
 * - a pause or budget decrease that passes design 6.7 guardrails 1-4 runs on
 *   its own through `applyAdChange`, then an undo card (pending, Needs you)
 *   carries the inverse change for one click;
 * - everything else, and every command under the manual adapter, becomes a
 *   pending `ad_change` card that runs only on Approve (b2).
 *
 * There is no delete command. Payloads, tool results and errors carry ids,
 * names and numbers only, never credentials.
 */

export type AdChangeParent = { chatId: string } | { cronRunId: string };

export type AutonomyFacts = {
  autonomousReductionsToday: number;
  liveChannelCount: number;
  channelLeadCount: number;
  dataMature: boolean;
};

export interface ProposeAdChangeStore {
  capInputs(companyId: string, readAt: Date): Promise<{ capMinor: number | null; reservedMinor: number }>;
  autonomyFacts(companyId: string, platform: AdPlatform, now: Date): Promise<AutonomyFacts>;
  insertCard(card: {
    companyId: string;
    agentId: string;
    parent: AdChangeParent;
    payload: AdChangePayload;
  }): Promise<string>;
}

export type ProposeAdChangeDeps = {
  store: ProposeAdChangeStore;
  adapterFor: (platform: AdPlatform, companyId: string) => AdPlatformAdapter;
  applyAdChange: (input: ApplyAdChangeInput) => Promise<ApplyAdChangeResult>;
  now: () => Date;
};

export type ProposeAdChangeResult =
  | { status: "pending_approval"; pendingId: string; kind: "ad_change"; message: "Wait for Approve or Discard." }
  | { status: "applied"; changeId: string; undoPendingId: string | null; message: string }
  | { error: string };

// ---------------------------------------------------------------------------
// Tool input (no delete action exists in this schema)
// ---------------------------------------------------------------------------

const id = z.string().trim().min(1).max(200);
const observedSchema = z.object({
  campaignName: z.string().trim().min(1).max(200),
  status: z.enum(["enabled", "paused"]),
  dailyBudgetMinor: z.number().int().nonnegative(),
});
const targetShape = {
  platform: z.enum(AD_PLATFORMS),
  accountId: id,
  campaignId: id,
  observed: observedSchema
    .optional()
    .describe("What you saw of the campaign. Required when the ad account is managed by hand (manual mode)."),
};
const matchType = z.enum(AD_KEYWORD_MATCH_TYPES);

export const adChangeCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...targetShape, action: z.literal("pause") }),
  z.object({ ...targetShape, action: z.literal("resume") }),
  z.object({
    ...targetShape,
    action: z.literal("set_daily_budget"),
    afterMinor: z.number().int().nonnegative().describe("New daily budget in kuruş (TRY minor units)."),
  }),
  z.object({
    ...targetShape,
    action: z.literal("add_keyword"),
    adGroupId: id,
    keyword: z.string().trim().min(1).max(80),
    matchType,
  }),
  z.object({
    ...targetShape,
    action: z.literal("add_negative_keyword"),
    keyword: z.string().trim().min(1).max(80),
    matchType,
  }),
  z.object({
    ...targetShape,
    action: z.literal("update_ad_copy"),
    adGroupId: id,
    headlines: z.array(z.string().trim().min(1).max(30)).min(1).max(15),
    descriptions: z.array(z.string().trim().min(1).max(90)).min(1).max(4),
  }),
]);

export const proposeAdChangeInputSchema = z.object({
  command: adChangeCommandSchema,
  reason: z.object({
    text: z.string().trim().min(1).max(500),
    metric: z.string().trim().min(1).max(60).describe("The metric that crossed its threshold, e.g. cpl or leads."),
    value: z.number().describe("The metric's current value, copied from the data you read."),
    threshold: z.number().describe("The threshold it crossed."),
  }),
});

// ---------------------------------------------------------------------------
// proposeAdChange
// ---------------------------------------------------------------------------

export async function proposeAdChange(
  opts: {
    companyId: string;
    agentId: string;
    parent: AdChangeParent;
    command: AdChangeCommand;
    reason: unknown;
  },
  deps: ProposeAdChangeDeps = defaultProposeAdChangeDeps,
): Promise<ProposeAdChangeResult> {
  const { companyId, agentId, parent, command } = opts;
  if (!parent || ("chatId" in parent) === ("cronRunId" in parent)) {
    return { error: "Parent session missing" };
  }
  const parsedReason = adChangeReasonSchema("agent").safeParse(opts.reason);
  if (!parsedReason.success) {
    return {
      error: `Refused: the reason needs text, metric, value and threshold (${parsedReason.error.issues
        .map((i) => i.path)
        .join(", ")}).`,
    };
  }
  const reason = parsedReason.data;
  const actor = { type: "agent" as const, agentId };

  const adapter = deps.adapterFor(command.platform, companyId);
  const manual = adapter.mode === "manual";
  if (manual && !command.observed) {
    return {
      error:
        "Refused: this ad account is managed by hand, so the command must include observed (campaignName, status, dailyBudgetMinor) as you saw it.",
    };
  }

  // Live campaigns of the command's account.
  const readAt = deps.now();
  let listed: Result<AdCampaignState[]>;
  try {
    listed = requireTryCampaigns(
      await adapter.listCampaigns({ companyId, accountId: command.accountId }),
    );
  } catch {
    listed = { ok: false, code: "platform_unreachable", message: "the ad platform did not answer" };
  }
  let campaign: AdCampaignState | null = null;
  let currentTotalMinor = 0;
  if (manual) {
    // The manual adapter has no platform to read; the proposer's view stands
    // for the target campaign and the final check runs again on Approve (b2).
    const observed = command.observed!;
    campaign = {
      campaignId: command.campaignId,
      name: observed.campaignName,
      status: observed.status,
      dailyBudgetMinor: observed.dailyBudgetMinor,
      currency: "TRY",
    };
    const others = listed.ok ? listed.value.filter((c) => c.campaignId !== command.campaignId) : [];
    currentTotalMinor = [...others, campaign].reduce(
      (sum, c) => sum + (c.status === "enabled" ? c.dailyBudgetMinor : 0),
      0,
    );
  } else {
    if (!listed.ok) return { error: `Could not read the campaigns (${listed.code}). No change was made.` };
    for (const c of listed.value) {
      if (c.status === "enabled") currentTotalMinor += c.dailyBudgetMinor;
      if (c.campaignId === command.campaignId) campaign = c;
    }
    if (!campaign) return { error: `Campaign ${command.campaignId} was not found. No change was made.` };
  }

  const deltaMinor = budgetDelta(command, campaign);
  const capInputs = await deps.store.capInputs(companyId, readAt);
  const cap = checkCap({ currentTotalMinor, ...capInputs, deltaMinor });
  if (!cap.ok) {
    await deps.applyAdChange({
      companyId,
      command,
      reason,
      actor,
      autonomous: false,
      mode: "reject_only",
    });
    return {
      error:
        cap.code === "cap_unset"
          ? "Refused: no daily ad cap is set for this company, so every budget increase is refused. No card was created."
          : `Refused: the daily total would be ${cap.totalAfterMinor} kuruş, over the daily cap of ${capInputs.capMinor} kuruş. No card was created.`,
    };
  }

  const now = deps.now();
  const expiresAt = new Date(now.getTime() + AD_CHANGE_CARD_TTL_MS).toISOString();
  const expected = expectedValues(command, campaign);
  const cardBase = {
    kind: "ad_change" as const,
    platform: command.platform,
    accountId: command.accountId,
    campaignId: command.campaignId,
    campaignName: campaign.name,
    reason,
    expiresAt,
  };

  const isReduction =
    command.action === "pause" || (command.action === "set_daily_budget" && deltaMinor < 0);
  if (!manual && isReduction) {
    const facts = await deps.store.autonomyFacts(companyId, command.platform, now);
    const decision = decideAutonomy({ action: command.action, deltaMinor, ...facts });
    if (decision.decision === "autonomous") {
      const result = await deps.applyAdChange({
        companyId,
        command,
        reason,
        actor,
        autonomous: true,
        mode: "apply",
      });
      if (result.outcome !== "applied" || !result.changeId) {
        return {
          error: `The change was not applied (${result.code ?? result.outcome}). No card was created.`,
        };
      }
      const inverse = inverseCommand(command, result.beforeValue);
      if (!inverse) {
        return {
          status: "applied",
          changeId: result.changeId,
          undoPendingId: null,
          message: "Applied without a card. The previous value was not reported, so no undo card was created.",
        };
      }
      const undoDelta = -deltaMinor;
      const undo: AdChangePayload = {
        ...cardBase,
        mode: "undo",
        changeId: randomUUID(),
        command: inverse,
        before: result.afterValue ?? null,
        after: result.beforeValue ?? null,
        deltaMinor: undoDelta,
        dailyTotalAfterMinor: (result.totalAfterMinor ?? cap.totalAfterMinor) + undoDelta,
        reason: { ...reason, text: `Undo: ${reason.text}` },
        reversesChangeId: result.changeId,
        executionMode: "api",
      };
      let undoPendingId: string | null;
      try {
        undoPendingId = await deps.store.insertCard({ companyId, agentId, parent, payload: undo });
      } catch (error) {
        // The change is live; a retry would apply it twice, so report applied without an undo card.
        console.error(
          "[ads] undo card insert failed",
          companyId,
          result.changeId,
          error instanceof Error ? error.message : "unknown error",
        );
        return {
          status: "applied",
          changeId: result.changeId,
          undoPendingId: null,
          message: "Applied without a card. The undo card could not be created; do not retry this change.",
        };
      }
      return {
        status: "applied",
        changeId: result.changeId,
        undoPendingId,
        message: "Applied without a card. An undo card is waiting in Needs you.",
      };
    }
  }

  const payload: AdChangePayload = {
    ...cardBase,
    mode: "change",
    changeId: randomUUID(),
    command,
    before: expected.before,
    after: expected.after,
    deltaMinor,
    dailyTotalAfterMinor: cap.totalAfterMinor,
    executionMode: manual ? "manual" : "api",
  };
  const pendingId = await deps.store.insertCard({ companyId, agentId, parent, payload });
  return { status: "pending_approval", pendingId, kind: "ad_change", message: "Wait for Approve or Discard." };
}

/** The change that restores what an applied pause or decrease replaced. */
function inverseCommand(command: AdChangeCommand, beforeValue: unknown): AdChangeCommand | null {
  const before = (beforeValue ?? {}) as { status?: unknown; dailyBudgetMinor?: unknown };
  const target = { platform: command.platform, accountId: command.accountId, campaignId: command.campaignId };
  if (command.action === "pause" && before.status === "enabled") return { ...target, action: "resume" };
  if (
    command.action === "set_daily_budget" &&
    typeof before.dailyBudgetMinor === "number" &&
    Number.isInteger(before.dailyBudgetMinor)
  ) {
    return { ...target, action: "set_daily_budget", afterMinor: before.dailyBudgetMinor };
  }
  return null;
}

function expectedValues(command: AdChangeCommand, c: AdCampaignState): { before: unknown; after: unknown } {
  switch (command.action) {
    case "pause":
    case "resume":
      return { before: { status: c.status }, after: { status: command.action === "pause" ? "paused" : "enabled" } };
    case "set_daily_budget":
      return { before: { dailyBudgetMinor: c.dailyBudgetMinor }, after: { dailyBudgetMinor: command.afterMinor } };
    case "add_keyword":
      return { before: null, after: { adGroupId: command.adGroupId, keyword: command.keyword, matchType: command.matchType } };
    case "add_negative_keyword":
      return { before: null, after: { keyword: command.keyword, matchType: command.matchType } };
    case "update_ad_copy":
      return {
        before: null,
        after: { adGroupId: command.adGroupId, headlines: command.headlines, descriptions: command.descriptions },
      };
  }
}

// ---------------------------------------------------------------------------
// Read tools: ids, names and numbers only
// ---------------------------------------------------------------------------

export const adAccountInputSchema = z.object({ platform: z.enum(AD_PLATFORMS), accountId: id });
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const adRangeInputSchema = adAccountInputSchema.extend({ from: day, to: day });

type ReadDeps = { adapterFor: (platform: AdPlatform, companyId: string) => AdPlatformAdapter };
const readError = (code: string) => ({ error: `Could not read the ad account (${code}).` });

async function safeRead<T>(fn: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await fn();
  } catch {
    return { ok: false, code: "platform_unreachable", message: "the ad platform did not answer" };
  }
}

export async function listAdCampaigns(
  companyId: string,
  input: z.infer<typeof adAccountInputSchema>,
  deps: ReadDeps = defaultProposeAdChangeDeps,
) {
  const adapter = deps.adapterFor(input.platform, companyId);
  const r = requireTryCampaigns(
    await safeRead(() => adapter.listCampaigns({ companyId, accountId: input.accountId })),
  );
  if (!r.ok) return readError(r.code);
  return {
    mode: adapter.mode,
    campaigns: r.value.map((c) => ({
      campaignId: c.campaignId,
      name: c.name,
      status: c.status,
      dailyBudgetMinor: c.dailyBudgetMinor,
    })),
  };
}

export async function getAdPerformance(
  companyId: string,
  input: z.infer<typeof adRangeInputSchema>,
  deps: ReadDeps = defaultProposeAdChangeDeps,
) {
  const range: AdDateRange = { from: input.from, to: input.to };
  const adapter = deps.adapterFor(input.platform, companyId);
  const r = await safeRead(() => adapter.getPerformance({ companyId, accountId: input.accountId }, range));
  if (!r.ok) return readError(r.code);
  return {
    rows: r.value.map((p) => ({
      campaignId: p.campaignId,
      impressions: p.impressions,
      clicks: p.clicks,
      conversions: p.conversions,
      costMinor: p.costMinor,
    })),
  };
}

export async function getAdSearchTerms(
  companyId: string,
  input: z.infer<typeof adRangeInputSchema>,
  deps: ReadDeps = defaultProposeAdChangeDeps,
) {
  const range: AdDateRange = { from: input.from, to: input.to };
  const adapter = deps.adapterFor(input.platform, companyId);
  const r = await safeRead(() => adapter.getSearchTerms({ companyId, accountId: input.accountId }, range));
  if (!r.ok) return readError(r.code);
  return {
    rows: r.value.map((t) => ({ campaignId: t.campaignId, term: t.term, clicks: t.clicks, costMinor: t.costMinor })),
  };
}

// ---------------------------------------------------------------------------
// Postgres wiring
// ---------------------------------------------------------------------------

/** RL7 lead channels each platform pays for. */
const PLATFORM_CHANNELS: Record<AdPlatform, AdChannel[]> = {
  google: ["google"],
  meta: ["meta", "instagram"],
};

export const pgProposeAdChangeStore: ProposeAdChangeStore = {
  capInputs(companyId, readAt) {
    return pgAdChangeStore.withCapLock(companyId, async (tx) => ({
      capMinor: await tx.loadCapMinor(companyId),
      reservedMinor: await tx.reservedMinor({
        companyId,
        since: new Date(readAt.getTime() - RESERVATION_TTL_MS),
        appliedSince: readAt,
        excludeCheckpointId: null,
      }),
    }));
  },
  async autonomyFacts(companyId, platform, now) {
    const nowIso = now.toISOString();
    const [counted, state] = await Promise.all([
      db
        .select({ n: sql<number>`count(*)::int` })
        .from(adChangeLog)
        .where(
          and(
            eq(adChangeLog.companyId, companyId),
            eq(adChangeLog.phase, "result"),
            eq(adChangeLog.outcome, "applied"),
            eq(adChangeLog.autonomous, true),
            sql`(${adChangeLog.createdAt} at time zone 'Europe/Istanbul')::date = (${nowIso}::timestamptz at time zone 'Europe/Istanbul')::date`,
          ),
        ),
      loadAdState(companyId, now),
    ]);
    const mine = state.channels.filter((c) => PLATFORM_CHANNELS[platform].includes(c.channel));
    return {
      autonomousReductionsToday: counted[0]?.n ?? 0,
      liveChannelCount: state.channels.filter((c) => c.live).length,
      channelLeadCount: mine.reduce((sum, c) => sum + (c.window?.leads ?? 0), 0),
      // "veri yok" (no window) or an incomplete day is treated as immature.
      dataMature:
        state.completeness.complete && mine.some((c) => c.window !== null && c.window.days > 0),
    };
  },
  async insertCard({ companyId, agentId, parent, payload }) {
    const [row] = await db
      .insert(checkpoints)
      .values({
        companyId,
        agentId,
        chatId: "chatId" in parent ? parent.chatId : null,
        cronRunId: "cronRunId" in parent ? parent.cronRunId : null,
        recordId: null,
        kind: "ad_change",
        status: "pending",
        endpointSnapshot: null,
        payload,
        artifactHash: checkpointArtifactHash(payload),
      })
      .returning({ id: checkpoints.id });
    return row.id;
  },
};

export const defaultProposeAdChangeDeps: ProposeAdChangeDeps = {
  store: pgProposeAdChangeStore,
  adapterFor: (platform) => defaultAdapterFor(platform),
  applyAdChange: (input) =>
    applyAdChange(input, {
      store: pgAdChangeStore,
      adapterFor: defaultAdapterFor,
      now: () => new Date(),
    }),
  now: () => new Date(),
};
