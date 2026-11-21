import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { companies, companyRecords, leadEvents } from "@/db/schema";
import { leadEventActorColumns, type SalePackage } from "@relay/db";

// Cash actually received on a won lead (design 3, design 6.5 "Kasaya giren").
// A person types each payment; there is no invoicing, VAT or bank import.
// Entries live in `company_records.payload.payments` (jsonb array, no
// migration, same pattern as RL3's `payload.firstResponse`). Writes are one
// atomic jsonb append or removal guarded by `status = 'won'`, never a
// read-modify-write of the whole payload, because `recordLead` rewrites
// `payload` from a read. Each add or remove appends a `won -> won` lead event
// with the person as actor and `metadata: { op, paymentId, kind }` (0053), so
// an add and a remove differ in the log; the add event's `at` equals the
// entry's `recordedAt`. RL6 reads entries through `readLeadPayments` only.

/**
 * `deposit` (50% at signing) and `balance` (50% at delivery) are the
 * `website` package; `setup` and `monthly` (each month start) are `social`.
 */
export const LEAD_PAYMENT_KINDS = ["deposit", "balance", "setup", "monthly"] as const;
export type LeadPaymentKind = (typeof LEAD_PAYMENT_KINDS)[number];

export const PAYMENT_KIND_BY_PACKAGE: Record<SalePackage, readonly LeadPaymentKind[]> = {
  website: ["deposit", "balance"],
  social: ["setup", "monthly"],
};

export type LeadPayment = {
  id: string;
  kind: LeadPaymentKind;
  /** TRY minor units (kuruş), KDV hariç; a positive integer. */
  amountMinor: number;
  /** Company-local `YYYY-MM-DD`. */
  receivedOn: string;
  /** The person who typed it (`users.id`). */
  recordedBy: string;
  /** ISO timestamp; equals the `at` of the add event. */
  recordedAt: string;
};

export type LeadPaymentResult =
  | { ok: true; payment: LeadPayment }
  | {
      ok: false;
      reason:
        | "not_found"
        | "not_won"
        | "kind_mismatch"
        | "invalid_amount"
        | "invalid_date"
        | "exceeds_sale";
    };

type Base = { companyId: string; leadId: string; userId: string; at?: Date };

const KINDS: ReadonlySet<string> = new Set(LEAD_PAYMENT_KINDS);
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function localToday(at: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

/** The payments on a record payload: valid entries only, oldest `receivedOn` first. */
export function readLeadPayments(payload: unknown): LeadPayment[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const raw = (payload as Record<string, unknown>).payments;
  if (!Array.isArray(raw)) return [];
  const out: LeadPayment[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    if (
      typeof e.id !== "string" ||
      !e.id ||
      typeof e.kind !== "string" ||
      !KINDS.has(e.kind) ||
      !isPositiveInt(e.amountMinor) ||
      !isIsoDate(e.receivedOn) ||
      typeof e.recordedBy !== "string" ||
      typeof e.recordedAt !== "string"
    ) {
      continue;
    }
    out.push({
      id: e.id,
      kind: e.kind as LeadPaymentKind,
      amountMinor: e.amountMinor,
      receivedOn: e.receivedOn,
      recordedBy: e.recordedBy,
      recordedAt: e.recordedAt,
    });
  }
  return out.sort(
    (a, b) => a.receivedOn.localeCompare(b.receivedOn) || a.recordedAt.localeCompare(b.recordedAt),
  );
}

/** Sum of the payments, minor units. */
export function paidMinor(payments: readonly LeadPayment[]): number {
  return payments.reduce((sum, p) => sum + p.amountMinor, 0);
}

/** The record's `payments` array, or `[]` when missing or not an array. */
const currentPayments = sql`case when jsonb_typeof(${companyRecords.payload} -> 'payments') = 'array' then ${companyRecords.payload} -> 'payments' else '[]'::jsonb end`;

function wonWhere(input: Base) {
  return and(
    eq(companyRecords.id, input.leadId),
    eq(companyRecords.companyId, input.companyId),
    eq(companyRecords.status, "won"),
  );
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The `won -> won` audit row of a payment add or remove. Inserted here, not
 * through `insertLeadEvent`, because that helper does not take `metadata`;
 * the actor still goes through `leadEventActorColumns` (exactly one actor).
 */
async function insertPaymentEvent(
  tx: Tx,
  input: Base,
  op: "payment_add" | "payment_remove",
  payment: LeadPayment,
  at: Date,
): Promise<void> {
  await tx.insert(leadEvents).values({
    companyId: input.companyId,
    recordId: input.leadId,
    fromStatus: "won",
    toStatus: "won",
    ...leadEventActorColumns({ userId: input.userId }),
    at,
    metadata: { op, paymentId: payment.id, kind: payment.kind },
  });
}

/** Locks the record and reads what the checks need. */
async function lockLead(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], input: Base) {
  const [row] = await tx
    .select({
      status: companyRecords.status,
      salePackage: companyRecords.salePackage,
      saleAmountMinor: companyRecords.saleAmountMinor,
      payload: companyRecords.payload,
      timeZone: companies.timezone,
    })
    .from(companyRecords)
    .innerJoin(companies, eq(companies.id, companyRecords.companyId))
    .where(and(eq(companyRecords.id, input.leadId), eq(companyRecords.companyId, input.companyId)))
    .for("update", { of: companyRecords });
  return row;
}

/**
 * Records one payment on a won lead. The kind must fit the package; for
 * `website` the deposit plus balance may not exceed the signed amount (social
 * setup and monthly fees are not capped by it).
 */
export async function addLeadPayment(
  input: Base & { kind: LeadPaymentKind; amountMinor: number; receivedOn: string },
): Promise<LeadPaymentResult> {
  if (!isPositiveInt(input.amountMinor)) return { ok: false, reason: "invalid_amount" };
  if (!isIsoDate(input.receivedOn)) return { ok: false, reason: "invalid_date" };
  const at = input.at ?? new Date();

  return db.transaction(async (tx): Promise<LeadPaymentResult> => {
    const row = await lockLead(tx, input);
    if (!row) return { ok: false, reason: "not_found" };
    if (row.status !== "won") return { ok: false, reason: "not_won" };
    const kinds = row.salePackage ? PAYMENT_KIND_BY_PACKAGE[row.salePackage] : [];
    if (!kinds.includes(input.kind)) return { ok: false, reason: "kind_mismatch" };
    if (input.receivedOn > localToday(at, row.timeZone)) return { ok: false, reason: "invalid_date" };
    if (row.salePackage === "website") {
      const paid = paidMinor(readLeadPayments(row.payload));
      if (paid + input.amountMinor > (row.saleAmountMinor ?? 0)) {
        return { ok: false, reason: "exceeds_sale" };
      }
    }

    const payment: LeadPayment = {
      id: randomUUID(),
      kind: input.kind,
      amountMinor: input.amountMinor,
      receivedOn: input.receivedOn,
      recordedBy: input.userId,
      recordedAt: at.toISOString(),
    };
    const updated = await tx
      .update(companyRecords)
      .set({
        payload: sql`jsonb_set(${companyRecords.payload}, '{payments}', ${currentPayments} || ${JSON.stringify([payment])}::jsonb)`,
        updatedAt: at,
      })
      .where(wonWhere(input))
      .returning({ id: companyRecords.id });
    if (updated.length === 0) return { ok: false, reason: "not_won" };

    await insertPaymentEvent(tx, input, "payment_add", payment, at);
    return { ok: true, payment };
  });
}

/** Removes one payment by id from a won lead (a typo, a bounced transfer). */
export async function removeLeadPayment(
  input: Base & { paymentId: string },
): Promise<LeadPaymentResult> {
  const at = input.at ?? new Date();
  return db.transaction(async (tx): Promise<LeadPaymentResult> => {
    const row = await lockLead(tx, input);
    if (!row) return { ok: false, reason: "not_found" };
    if (row.status !== "won") return { ok: false, reason: "not_won" };
    const payment = readLeadPayments(row.payload).find((p) => p.id === input.paymentId);
    if (!payment) return { ok: false, reason: "not_found" };

    const updated = await tx
      .update(companyRecords)
      .set({
        payload: sql`jsonb_set(${companyRecords.payload}, '{payments}', coalesce((select jsonb_agg(p) from jsonb_array_elements(${currentPayments}) as p where p ->> 'id' is distinct from ${input.paymentId}), '[]'::jsonb))`,
        updatedAt: at,
      })
      .where(wonWhere(input))
      .returning({ id: companyRecords.id });
    if (updated.length === 0) return { ok: false, reason: "not_won" };

    await insertPaymentEvent(tx, input, "payment_remove", payment, at);
    return { ok: true, payment };
  });
}
