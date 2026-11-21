import { and, desc, eq, gte, inArray, lt, notInArray, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { companyRecords } from "@/db/schema";
import { escapeCsvCell } from "@/lib/leads-csv";
import { PAYMENT_KIND_BY_PACKAGE, paidMinor, readLeadPayments } from "@/lib/leads/payments";
import {
  EXCLUDED_LEAD_STATUSES,
  SESSION_LEAD_LIST_LIMIT,
  SESSION_LEAD_TABS,
  type SessionLeadCounts,
  type SessionLeadRecord,
  type SessionLeadTab,
} from "@/components/operator/session/panes/leads/leads-pane-model";

// Leads work pane data (05 session-leads/*). A session shows the company's
// leads created in the ISO week the session started (company time): the
// weekly lead run gathers and scores that week's leads, and inbound leads of
// the same week join them. Callers authorize first (membership + steer gate);
// the company id comes from the session's chat, never from the request.

export type LeadWindow = { companyId: string; from: Date; to: Date };

/** A lead reached `qualified` once (the billing basis, decision 17). */
const everQualified = sql<boolean>`exists (select 1 from lead_events le where le.record_id = ${companyRecords.id} and le.to_status = 'qualified')`;

const EXCLUDED = [...EXCLUDED_LEAD_STATUSES];

function tabWhere(tab: SessionLeadTab): SQL | undefined {
  switch (tab) {
    case "excluded":
      return inArray(companyRecords.status, EXCLUDED);
    case "borderline":
      return eq(companyRecords.status, "borderline");
    case "qualified":
      return and(notInArray(companyRecords.status, [...EXCLUDED, "borderline"]), everQualified);
  }
}

function windowWhere(window: LeadWindow) {
  return and(
    eq(companyRecords.companyId, window.companyId),
    gte(companyRecords.createdAt, window.from),
    lt(companyRecords.createdAt, window.to),
  );
}

const leadColumns = {
  id: companyRecords.id,
  entityType: companyRecords.entityType,
  name: companyRecords.name,
  domain: companyRecords.domain,
  phone: companyRecords.phone,
  source: companyRecords.source,
  status: companyRecords.status,
  fitScore: companyRecords.score,
  reasons: companyRecords.fitReasons,
  rejectReason: companyRecords.rejectReason,
  payload: companyRecords.payload,
  salePackage: companyRecords.salePackage,
  saleAmountMinor: companyRecords.saleAmountMinor,
  createdAt: companyRecords.createdAt,
};

type LeadRow = {
  id: string;
  entityType: "account" | "person";
  name: string;
  domain: string | null;
  phone: string | null;
  source: string | null;
  status: string;
  fitScore: number | null;
  reasons: string[] | null;
  rejectReason: string | null;
  payload: Record<string, unknown> | null;
  salePackage?: "website" | "social" | null;
  saleAmountMinor?: number | null;
  createdAt: Date;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Pane view of a `company_records` row; contact and area come from the payload. */
export function toSessionLead(row: LeadRow): SessionLeadRecord {
  const payload = record(row.payload) ?? {};
  const contact = record(payload.contact);
  const contactName = text(contact?.name);
  const intake = record(payload.intake);
  const salePackage = row.salePackage ?? null;
  // Cash in shows on won rows only; the entries stay if a sale is re-opened.
  const payments = row.status === "won" ? readLeadPayments(payload) : [];
  return {
    id: row.id,
    entityType: row.entityType,
    name: row.name,
    domain: row.domain,
    phone: row.phone,
    source: row.source,
    status: row.status,
    fitScore: row.fitScore,
    reasons: Array.isArray(row.reasons) ? row.reasons : [],
    rejectReason: row.rejectReason,
    contact: contactName ? { name: contactName, role: text(contact?.role) } : null,
    location: text(payload.city) ?? text(intake?.lokasyon),
    salePackage,
    saleAmountMinor: row.saleAmountMinor ?? null,
    payments,
    paidMinor: paidMinor(payments),
    paymentKinds: salePackage ? [...PAYMENT_KIND_BY_PACKAGE[salePackage]] : [],
  };
}

function tabQuery(window: LeadWindow, tab: SessionLeadTab) {
  return db
    .select(leadColumns)
    .from(companyRecords)
    .where(and(windowWhere(window), tabWhere(tab)))
    .orderBy(sql`${companyRecords.score} desc nulls last`, desc(companyRecords.createdAt), desc(companyRecords.id));
}

export async function countSessionLeads(window: LeadWindow): Promise<SessionLeadCounts> {
  const outbound = sql`(${companyRecords.source} is null or ${companyRecords.source} = 'outbound')`;
  const [row] = await db
    .select({
      qualified: sql<number>`count(*) filter (where ${tabWhere("qualified")})`.mapWith(Number),
      borderline: sql<number>`count(*) filter (where ${tabWhere("borderline")})`.mapWith(Number),
      excluded: sql<number>`count(*) filter (where ${tabWhere("excluded")})`.mapWith(Number),
      gathered: sql<number>`count(*) filter (where ${outbound})`.mapWith(Number),
      inbound: sql<number>`count(*) filter (where not ${outbound})`.mapWith(Number),
    })
    .from(companyRecords)
    .where(windowWhere(window));
  return {
    qualified: row?.qualified ?? 0,
    borderline: row?.borderline ?? 0,
    excluded: row?.excluded ?? 0,
    gathered: row?.gathered ?? 0,
    inbound: row?.inbound ?? 0,
  };
}

export type SessionLeads = {
  counts: SessionLeadCounts;
  /** At most `SESSION_LEAD_LIST_LIMIT` per tab, best fit first. */
  tabs: Record<SessionLeadTab, SessionLeadRecord[]>;
};

/** The pane: counts plus each tab's first `SESSION_LEAD_LIST_LIMIT` leads. */
export async function loadSessionLeads(window: LeadWindow): Promise<SessionLeads> {
  const [counts, ...lists] = await Promise.all([
    countSessionLeads(window),
    ...SESSION_LEAD_TABS.map((tab) => tabQuery(window, tab).limit(SESSION_LEAD_LIST_LIMIT)),
  ]);
  const tabs = Object.fromEntries(
    SESSION_LEAD_TABS.map((tab, i) => [tab, (lists[i] as LeadRow[]).map(toSessionLead)]),
  ) as Record<SessionLeadTab, SessionLeadRecord[]>;
  return { counts, tabs };
}

/** The CSV export: every lead on the tab, no cap. */
export async function exportSessionLeads(
  window: LeadWindow,
  tab: SessionLeadTab,
): Promise<LeadRow[]> {
  return (await tabQuery(window, tab)) as LeadRow[];
}

/** Fixed and ordered. Intake keys are the pilot client's #18 fields plus kod. */
export const SESSION_LEADS_CSV_COLUMNS = [
  "id",
  "name",
  "contact",
  "phone",
  "domain",
  "source",
  "status",
  "fitScore",
  "reasons",
  "rejectReason",
  "kod",
  "tip",
  "m2",
  "lokasyon",
  "butce",
  "iletisim",
  "createdAt",
] as const;

const INTAKE_COLUMNS = new Set(["kod", "tip", "m2", "lokasyon", "butce", "iletisim"]);

function csvCell(row: LeadRow, column: (typeof SESSION_LEADS_CSV_COLUMNS)[number]) {
  const payload = record(row.payload) ?? {};
  if (INTAKE_COLUMNS.has(column)) {
    const value = record(payload.intake)?.[column];
    return value === undefined || value === null ? null : String(value);
  }
  switch (column) {
    case "contact":
      return text(record(payload.contact)?.name);
    case "reasons":
      return (row.reasons ?? []).join("; ") || null;
    default:
      return row[column as keyof LeadRow] as string | number | Date | null;
  }
}

/** UTF-8 BOM first so Excel keeps Turkish characters; cells formula-escaped. */
export function sessionLeadsToCsv(rows: readonly LeadRow[]): string {
  const lines = [
    SESSION_LEADS_CSV_COLUMNS.join(","),
    ...rows.map((row) => SESSION_LEADS_CSV_COLUMNS.map((column) => escapeCsvCell(csvCell(row, column))).join(",")),
  ];
  return `﻿${lines.join("\r\n")}`;
}
