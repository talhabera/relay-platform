import { and, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import {
  chats,
  companyRecords,
  db,
  fitScoreBand,
  isValidFitScore,
  transitionLeadStatus,
  type CompanyRecordStatus,
  type LeadBand,
} from "@relay/db";
import { notifyQualifiedLead, type NotifyOutcome } from "./notify-lead";
import { emitInboundQualified } from "./portal-events";
import {
  proposeLeadDelivery,
  type LeadDeliveryParent,
} from "../operator/propose-action";

// The Lead engine's qualify step (lead scoring spec, decisions 1-4, 6, 11, 12,
// 15). Only the qualify agent scores; the band decides the status. A person's
// Borderline override (accept/reject, `lib/leads` in the web app) moves the
// lead out of the scorable statuses, so a later run never re-scores it.

/** Statuses a lead can be scored from: not yet decided by an agent or person. */
export const SCORABLE_LEAD_STATUSES = [
  "pending",
  "researched",
  "gathered",
] as const satisfies readonly CompanyRecordStatus[];

/** Decision 12: an unfinished intake is scored anyway after 24 h of quiet. */
export const QUIET_LEAD_MS = 24 * 60 * 60 * 1000;

export const MAX_FIT_REASONS = 3;

const BAND_STATUS: Record<LeadBand, CompanyRecordStatus> = {
  qualified: "qualified",
  borderline: "borderline",
  rejected: "rejected",
};

/**
 * Where a lead goes after Qualify. Inbound leads enter at Qualify and skip
 * outreach: a qualified one joins the next deliver-to-client checkpoint
 * (decision 15). Borderline leads wait in the Borderline filter; rejected ones
 * sit in Excluded.
 */
export type QualifyRoute = "outreach" | "deliver" | "borderline" | "excluded";

export function isInboundSource(source: string | null): boolean {
  return source !== null && source !== "outbound";
}

export function routeAfterQualify(
  band: LeadBand,
  source: string | null,
): QualifyRoute {
  if (band === "borderline") return "borderline";
  if (band === "rejected") return "excluded";
  return isInboundSource(source) ? "deliver" : "outreach";
}

export type ScoreLeadInput = {
  companyId: string;
  agentId: string;
  recordId: string;
  score: number;
  reasons: string[];
  rejectReason?: string | null;
  now?: Date;
  /** The session or run scoring; parents the delivery card. */
  parent?: LeadDeliveryParent;
};

export type ScoreLeadResult =
  | {
      id: string;
      score: number;
      band: LeadBand;
      status: CompanyRecordStatus;
      route: QualifyRoute;
      /** The pending lead_delivery card a `deliver` route opened. */
      deliveryCheckpointId?: string;
    }
  | { error: string };

/** Decisions 2-3: 1-3 reasons, and exactly one reject reason under 50. */
export function validateScore(input: {
  score: number;
  reasons: string[];
  rejectReason?: string | null;
}):
  | {
      ok: true;
      band: LeadBand;
      reasons: string[];
      rejectReason: string | null;
    }
  | { ok: false; error: string } {
  if (!isValidFitScore(input.score)) {
    return { ok: false, error: "score must be an integer from 0 to 100" };
  }
  const reasons = input.reasons.map((r) => r.trim()).filter((r) => r !== "");
  if (reasons.length < 1 || reasons.length > MAX_FIT_REASONS) {
    return { ok: false, error: "give 1 to 3 short fit reasons" };
  }
  const band = fitScoreBand(input.score)!;
  const rejectReason = input.rejectReason?.trim() || null;
  if (band === "rejected" && !rejectReason) {
    return { ok: false, error: "a score under 50 needs one reject reason" };
  }
  if (band !== "rejected" && rejectReason) {
    return { ok: false, error: "only a score under 50 takes a reject reason" };
  }
  return { ok: true, band, reasons, rejectReason };
}

/**
 * Scores one lead and moves it to its band's status, logged with the agent as
 * actor. Refuses a lead that is already decided (scored, overridden by a
 * person, contacted or delivered).
 */
export async function scoreLead(input: ScoreLeadInput): Promise<ScoreLeadResult> {
  const checked = validateScore(input);
  if (!checked.ok) return { error: checked.error };

  const record = await db.query.companyRecords.findFirst({
    where: and(
      eq(companyRecords.id, input.recordId),
      eq(companyRecords.companyId, input.companyId),
    ),
  });
  if (!record) return { error: "Not found" };

  const status = BAND_STATUS[checked.band];
  const inboundQualified = status === "qualified" && isInboundSource(record.source);
  const moved = await db.transaction(async (tx) => {
    const result = await transitionLeadStatus(tx, {
      companyId: input.companyId,
      recordId: input.recordId,
      toStatus: status,
      actor: { agentId: input.agentId },
      at: input.now,
      guard: inArray(companyRecords.status, [...SCORABLE_LEAD_STATUSES]),
      set: {
        score: input.score,
        fitReasons: checked.reasons,
        rejectReason: checked.rejectReason,
      },
    });
    // Live feed row, committed with the status change it describes.
    if (result.changed && inboundQualified) {
      await emitInboundQualified(tx, {
        id: input.recordId,
        companyId: input.companyId,
        name: record.name,
        source: record.source,
        at: input.now,
      });
    }
    return result;
  });

  if (!moved.changed) {
    if (moved.reason === "not_found") return { error: "Not found" };
    return {
      error: `Lead is already ${record.status}; only pending, researched or gathered leads are scored`,
    };
  }

  const route = routeAfterQualify(checked.band, record.source);
  const delivery =
    route === "deliver"
      ? await onInboundQualified({
          companyId: input.companyId,
          recordId: input.recordId,
          agentId: input.agentId,
          parent: input.parent,
        })
      : null;

  return {
    id: input.recordId,
    score: input.score,
    band: checked.band,
    status,
    route,
    ...(delivery?.deliveryCheckpointId
      ? { deliveryCheckpointId: delivery.deliveryCheckpointId }
      : {}),
  };
}

/**
 * What a qualified inbound lead sets off (decisions 15-16; W3GAP): the
 * qualified-lead WhatsApp notification, then the deliver-to-client card.
 * Shared by Qualify's `deliver` route, a person accepting a borderline inbound
 * lead, and the legacy inbound intake. Never throws: neither may fail the
 * lead that caused it. Returns the notification outcome and the new card's
 * id, if one was opened.
 */
export async function onInboundQualified(input: {
  companyId: string;
  recordId: string;
  agentId?: string;
  parent?: LeadDeliveryParent;
}): Promise<{ notify: NotifyOutcome; deliveryCheckpointId: string | null }> {
  const notify = await notifyQualifiedLead(input.recordId);
  try {
    const proposed = await proposeLeadDelivery(input);
    return {
      notify,
      deliveryCheckpointId: proposed.proposed ? proposed.pendingId : null,
    };
  } catch (error) {
    console.error("[Lead delivery] could not propose the card", input.recordId, error);
    return { notify, deliveryCheckpointId: null };
  }
}

/**
 * A person accepted a borderline lead in the web app, which asks the worker
 * over `/internal/lead-notify` (overrides.ts). Inbound leads only: an
 * outbound one goes on to outreach.
 */
export async function onLeadAcceptedByPerson(
  leadId: string,
): Promise<{ notify: NotifyOutcome; deliveryCheckpointId: string | null }> {
  const record = await db.query.companyRecords.findFirst({
    where: eq(companyRecords.id, leadId),
  });
  if (!record || !isInboundSource(record.source)) {
    return { notify: await notifyQualifiedLead(leadId), deliveryCheckpointId: null };
  }
  return onInboundQualified({ companyId: record.companyId, recordId: leadId });
}

export type LeadToQualify = {
  id: string;
  name: string;
  source: string | null;
  intakeComplete: boolean;
  intake: Record<string, unknown>;
};

/**
 * Leads the qualify agent picks up on a run (decisions 11-12): outbound leads
 * waiting in a scorable status, inbound leads whose intake is complete, and
 * inbound leads left unfinished with no new message for 24 h. An inbound lead
 * still mid-conversation is left for the customer agent.
 */
export async function listLeadsToQualify(input: {
  companyId: string;
  now?: Date;
  limit?: number;
}): Promise<LeadToQualify[]> {
  const now = input.now ?? new Date();
  const quietSince = new Date(now.getTime() - QUIET_LEAD_MS);

  const rows = await db
    .select({
      id: companyRecords.id,
      name: companyRecords.name,
      source: companyRecords.source,
      intakeComplete: companyRecords.intakeComplete,
      payload: companyRecords.payload,
    })
    .from(companyRecords)
    .leftJoin(chats, eq(chats.id, companyRecords.chatId))
    .where(
      and(
        eq(companyRecords.companyId, input.companyId),
        isNull(companyRecords.score),
        inArray(companyRecords.status, [...SCORABLE_LEAD_STATUSES]),
        or(
          isNull(companyRecords.source),
          eq(companyRecords.source, "outbound"),
          eq(companyRecords.intakeComplete, true),
          and(
            isNotNull(companyRecords.source),
            lt(companyRecords.updatedAt, quietSince),
            or(isNull(chats.id), lt(chats.lastActivityAt, quietSince)),
          ),
        ),
      ),
    )
    .orderBy(sql`${companyRecords.createdAt} asc`)
    .limit(input.limit ?? 50);

  return rows.map(({ payload, ...row }) => ({
    ...row,
    intake: intakeOf(payload),
  }));
}

function intakeOf(payload: Record<string, unknown>): Record<string, unknown> {
  const intake = payload.intake;
  return intake && typeof intake === "object" && !Array.isArray(intake)
    ? (intake as Record<string, unknown>)
    : {};
}
