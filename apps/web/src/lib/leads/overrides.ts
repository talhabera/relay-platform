import { and, eq, notInArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { companyRecords } from "@/db/schema";
import {
  KOLEVA_FUNNEL_STATUSES,
  PORTAL_EVENT_CHANNELS,
  SALE_PACKAGES,
  transitionLeadStatus,
  type CompanyRecordStatus,
  type PortalEventChannel,
  type SalePackage,
  type TransitionLeadStatusInput,
} from "@relay/db";
import { emitPortalEvent } from "@/lib/live/portal-events";
import { notifyQualifiedLeadOnWorker } from "@/lib/worker-proxy";

// A person's actions on a lead (lead scoring spec, decision 6; CONTEXT.md
// Qualified / Borderline / Rejected lead). Every status change goes through
// `transitionLeadStatus` with the person as actor (`userId`), and none of them
// touches the fit score: an accepted borderline lead is qualified with the
// score it was given. Callers authorize first (membership + steer gate).
//
// Billing reads the event log (`listQualifiedLeads`): a lead counts from its
// first `qualified` event. Excluding a lead after it was qualified adds a
// `rejected` event and leaves that first one in place, so it stays on the
// invoice. Keep it that way: billed leads never drop off.

export type LeadOverrideResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_allowed" | "duplicate_phone" | "sale_required" };

type Base = { companyId: string; leadId: string; userId: string; at?: Date };

/** Default reject reason when a person rejects or excludes without one. */
export const PERSON_REJECT_REASON = "Rejected by a person";
export const PERSON_EXCLUDE_REASON = "Excluded by a person";

function result(
  moved: Awaited<ReturnType<typeof transitionLeadStatus>>,
): LeadOverrideResult {
  if (moved.changed) return { ok: true };
  return { ok: false, reason: moved.reason === "not_found" ? "not_found" : "not_allowed" };
}

const PORTAL_CHANNELS: ReadonlySet<string> = new Set(PORTAL_EVENT_CHANNELS);

/**
 * Borderline -> qualified. Counts for billing from now; fit score unchanged.
 * An inbound lead also gets its Live feed row (`lead_inbound_qualified`, same
 * transaction) and the qualified-lead notification (decision 16), which the
 * worker sends.
 */
export async function acceptBorderlineLead(input: Base): Promise<LeadOverrideResult> {
  const { outcome, inbound } = await db.transaction(async (tx) => {
    const moved = await transitionLeadStatus(tx, {
      companyId: input.companyId,
      recordId: input.leadId,
      toStatus: "qualified",
      actor: { userId: input.userId },
      at: input.at,
      guard: sql`${companyRecords.status} = 'borderline'`,
    });
    if (!moved.changed) return { outcome: result(moved), inbound: false };

    const [lead] = await tx
      .select({ name: companyRecords.name, source: companyRecords.source })
      .from(companyRecords)
      .where(
        and(eq(companyRecords.id, input.leadId), eq(companyRecords.companyId, input.companyId)),
      );
    const inbound = !!lead?.source && lead.source !== "outbound";
    if (inbound) {
      await emitPortalEvent(tx, {
        companyId: input.companyId,
        type: "lead_inbound_qualified",
        title: lead.name.trim() || "Lead",
        detail: "Qualified inbound lead",
        channel: PORTAL_CHANNELS.has(lead.source!)
          ? (lead.source as PortalEventChannel)
          : null,
        refId: input.leadId,
        at: input.at,
      });
    }
    return { outcome: result(moved), inbound };
  });
  if (outcome.ok && inbound) await notifyQualifiedLeadOnWorker(input.leadId);
  return outcome;
}

/** Borderline -> rejected, with one reject reason; fit score unchanged. */
export async function rejectBorderlineLead(
  input: Base & { reason?: string },
): Promise<LeadOverrideResult> {
  return result(
    await transitionLeadStatus(db, {
      companyId: input.companyId,
      recordId: input.leadId,
      toStatus: "rejected",
      actor: { userId: input.userId },
      at: input.at,
      guard: sql`${companyRecords.status} = 'borderline'`,
      set: { rejectReason: input.reason?.trim() || PERSON_REJECT_REASON },
    }),
  );
}

/**
 * Any lead not yet rejected -> rejected (the Excluded tab). Delivered leads
 * stay delivered: they already reached the client. Won leads stay won: a sale
 * is taken back only on purpose, through `moveLeadStatus` with `reopen: true`.
 */
export async function excludeLead(
  input: Base & { reason?: string },
): Promise<LeadOverrideResult> {
  return result(
    await transitionLeadStatus(db, {
      companyId: input.companyId,
      recordId: input.leadId,
      toStatus: "rejected",
      actor: { userId: input.userId },
      at: input.at,
      guard: notInArray(companyRecords.status, ["rejected", "delivered", "won"]),
      set: { rejectReason: input.reason?.trim() || PERSON_EXCLUDE_REASON },
    }),
  );
}

const FUNNEL: ReadonlySet<string> = new Set(KOLEVA_FUNNEL_STATUSES);
const PACKAGES: ReadonlySet<string> = new Set(SALE_PACKAGES);

export type MoveLeadStatusInput = Base & {
  toStatus: CompanyRecordStatus;
  /** Required for `won`. */
  salePackage?: SalePackage;
  /** TRY minor units (kuruş), KDV hariç; a positive integer, required for `won`. */
  saleAmountMinor?: number;
  /** Reject reason for `unqualified` / `rejected`. */
  reason?: string;
  /** Lets a `won` lead go to `unqualified` or `rejected`. */
  reopen?: boolean;
};

/**
 * A person moves a lead along the Koleva funnel (`KOLEVA_FUNNEL_STATUSES`):
 * yeni, nitelikli, görüşme, teklif, satış, kaybedildi, uygun değil. `won`
 * needs the package and the signed amount. Leaving `won` keeps both, so a
 * re-open loses nothing; a won lead goes to `unqualified` or `rejected` only
 * with `reopen: true`. A rejected or delivered lead cannot jump to `proposal`
 * or `won`. Back to `qualified` is allowed (a mis-click) and never notifies:
 * only the borderline accept does. Appends one event; the first `qualified`
 * event, the billing basis, is never touched.
 */
export async function moveLeadStatus(input: MoveLeadStatusInput): Promise<LeadOverrideResult> {
  const { toStatus } = input;
  if (!FUNNEL.has(toStatus)) return { ok: false, reason: "not_allowed" };

  let guard: TransitionLeadStatusInput["guard"];
  let set: TransitionLeadStatusInput["set"];
  if (toStatus === "won") {
    const amount = input.saleAmountMinor;
    const validAmount = typeof amount === "number" && Number.isSafeInteger(amount) && amount > 0;
    if (!input.salePackage || !PACKAGES.has(input.salePackage) || !validAmount) {
      return { ok: false, reason: "sale_required" };
    }
    set = { salePackage: input.salePackage, saleAmountMinor: amount };
  }
  if (toStatus === "proposal" || toStatus === "won") {
    guard = notInArray(companyRecords.status, ["rejected", "delivered"]);
  }
  if (toStatus === "unqualified" || toStatus === "rejected") {
    if (!input.reopen) guard = notInArray(companyRecords.status, ["won"]);
    set = { rejectReason: input.reason?.trim() || PERSON_REJECT_REASON };
  }

  return result(
    await transitionLeadStatus(db, {
      companyId: input.companyId,
      recordId: input.leadId,
      toStatus,
      actor: { userId: input.userId },
      at: input.at,
      ...(guard ? { guard } : {}),
      ...(set ? { set } : {}),
    }),
  );
}

export type LeadEdit = {
  name?: string;
  /** E.164, or null to clear. */
  phone?: string | null;
  /** Intake answers to set; null removes one. Other answers are kept. */
  intake?: Record<string, string | null>;
};

const E164 = /^\+[1-9]\d{6,14}$/;

export class LeadEditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LeadEditError";
  }
}

/** Validates and normalizes an edit; throws `LeadEditError` on bad input. */
export function normalizeLeadEdit(edit: LeadEdit): LeadEdit {
  const out: LeadEdit = {};
  if (edit.name !== undefined) {
    const name = edit.name.trim();
    if (!name) throw new LeadEditError("Name cannot be empty");
    out.name = name;
  }
  if (edit.phone !== undefined) {
    const phone = edit.phone === null ? null : edit.phone.replace(/[\s()-]/g, "");
    if (phone !== null && !E164.test(phone)) {
      throw new LeadEditError("Phone must be in international format, like +905321234567");
    }
    out.phone = phone || null;
  }
  if (edit.intake !== undefined) {
    out.intake = Object.fromEntries(
      Object.entries(edit.intake).map(([key, value]) => [
        key,
        value === null ? null : value.trim() || null,
      ]),
    );
  }
  return out;
}

/**
 * Edits a lead's contact and intake answers. Never changes status, score or
 * reasons, so it logs no lead event and earns no credit.
 */
export async function editLead(
  input: Omit<Base, "userId"> & { edit: LeadEdit },
): Promise<LeadOverrideResult> {
  const edit = normalizeLeadEdit(input.edit);
  const where = and(
    eq(companyRecords.id, input.leadId),
    eq(companyRecords.companyId, input.companyId),
  );
  try {
    return await updateLead(input, edit, where);
  } catch (error) {
    // `company_records_company_phone_uidx`: another lead has this number.
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, reason: "duplicate_phone" };
    }
    throw error;
  }
}

async function updateLead(
  input: { at?: Date },
  edit: LeadEdit,
  where: ReturnType<typeof and>,
): Promise<LeadOverrideResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ payload: companyRecords.payload })
      .from(companyRecords)
      .where(where)
      .for("update");
    if (!row) return { ok: false, reason: "not_found" } as const;

    let payload = row.payload;
    if (edit.intake) {
      const current = payload.intake;
      const intake: Record<string, unknown> =
        current && typeof current === "object" && !Array.isArray(current)
          ? { ...(current as Record<string, unknown>) }
          : {};
      for (const [key, value] of Object.entries(edit.intake)) {
        if (value === null) delete intake[key];
        else intake[key] = value;
      }
      payload = { ...payload, intake };
    }

    await tx
      .update(companyRecords)
      .set({
        ...(edit.name !== undefined ? { name: edit.name } : {}),
        ...(edit.phone !== undefined ? { phone: edit.phone } : {}),
        payload,
        updatedAt: input.at ?? new Date(),
      })
      .where(where);
    return { ok: true } as const;
  });
}
