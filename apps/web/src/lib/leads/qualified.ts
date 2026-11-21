import { and, asc, eq, gte, lt, min, sql } from "drizzle-orm";
import { db } from "@/db";
import { companyRecords, leadEvents } from "@/db/schema";
import { escapeCsvCell } from "@/lib/leads-csv";

// Qualified leads: the billing basis (lead scoring spec, decision 17). A lead
// counts once it has reached `qualified` (fit >= 70, or a borderline lead a
// person accepted), whatever happened after: delivering or contacting it must
// not take it off the invoice. So the source of truth is the event log, not
// the current status. Leads migrated from #18 carry a creation event with
// `qualified`, so they count from the day they were captured.

export type QualifiedLead = {
  id: string;
  name: string;
  phone: string | null;
  source: string | null;
  status: string;
  fitScore: number | null;
  intake: Record<string, unknown>;
  qualifiedAt: Date;
  firstDeliveredAt: Date | null;
  createdAt: Date;
};

/**
 * A company's qualified leads, oldest first by the moment they first became
 * qualified. With `range`, only leads first qualified in `from <= at < to`.
 */
export async function listQualifiedLeads(
  companyId: string,
  range?: { from: Date; to: Date },
): Promise<QualifiedLead[]> {
  const firstQualified = db
    .select({
      recordId: leadEvents.recordId,
      at: min(leadEvents.at).as("qualified_at"),
    })
    .from(leadEvents)
    .where(
      and(
        eq(leadEvents.companyId, companyId),
        eq(leadEvents.toStatus, "qualified"),
      ),
    )
    .groupBy(leadEvents.recordId)
    .as("first_qualified");

  const rows = await db
    .select({
      id: companyRecords.id,
      name: companyRecords.name,
      phone: companyRecords.phone,
      source: companyRecords.source,
      status: companyRecords.status,
      fitScore: companyRecords.score,
      payload: companyRecords.payload,
      qualifiedAt: firstQualified.at,
      firstDeliveredAt: companyRecords.firstDeliveredAt,
      createdAt: companyRecords.createdAt,
    })
    .from(companyRecords)
    .innerJoin(firstQualified, eq(firstQualified.recordId, companyRecords.id))
    .where(
      and(
        eq(companyRecords.companyId, companyId),
        // `qualified_at` is an aggregate, not a column, so drizzle has no
        // encoder for the bound Date; postgres-js then rejects the raw Date
        // (ERR_INVALID_ARG_TYPE). Encode through the `lead_events.at` column.
        range ? gte(firstQualified.at, sql.param(range.from, leadEvents.at)) : undefined,
        range ? lt(firstQualified.at, sql.param(range.to, leadEvents.at)) : undefined,
      ),
    )
    .orderBy(asc(firstQualified.at), asc(companyRecords.id));

  return rows.map(({ payload, qualifiedAt, ...row }) => ({
    ...row,
    intake: intakeOf(payload),
    qualifiedAt: new Date(qualifiedAt as Date | string),
  }));
}

function intakeOf(payload: Record<string, unknown>): Record<string, unknown> {
  const intake = payload.intake;
  return intake && typeof intake === "object" && !Array.isArray(intake)
    ? (intake as Record<string, unknown>)
    : {};
}

/** Fixed and ordered. Intake keys are the pilot client's #18 fields plus kod. */
export const QUALIFIED_CSV_COLUMNS = [
  "id",
  "name",
  "phone",
  "source",
  "fitScore",
  "status",
  "kod",
  "tip",
  "m2",
  "lokasyon",
  "butce",
  "iletisim",
  "qualifiedAt",
  "firstDeliveredAt",
  "createdAt",
] as const;

const INTAKE_COLUMNS = new Set(["kod", "tip", "m2", "lokasyon", "butce", "iletisim"]);

function cell(lead: QualifiedLead, column: (typeof QUALIFIED_CSV_COLUMNS)[number]) {
  if (INTAKE_COLUMNS.has(column)) {
    const value = lead.intake[column];
    return value === undefined || value === null ? null : String(value);
  }
  return lead[column as keyof QualifiedLead] as string | number | Date | null;
}

/** UTF-8 BOM first so Excel keeps Turkish characters; cells formula-escaped. */
export function qualifiedLeadsToCsv(leads: readonly QualifiedLead[]): string {
  const lines = [
    QUALIFIED_CSV_COLUMNS.join(","),
    ...leads.map((lead) =>
      QUALIFIED_CSV_COLUMNS.map((column) => escapeCsvCell(cell(lead, column))).join(","),
    ),
  ];
  return `﻿${lines.join("\r\n")}`;
}
