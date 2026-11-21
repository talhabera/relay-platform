import { and, eq, ilike, or } from "drizzle-orm";
import {
  companyRecords,
  db,
  insertLeadEvent,
  isValidFitScore,
  transitionLeadStatus,
  type CompanyRecordStatus,
} from "@relay/db";

export type CompanyRecord = typeof companyRecords.$inferSelect;

const SEARCH_LIMIT = 20;

function normalizeDomain(domain: string | undefined): string | null {
  if (domain === undefined) return null;
  const trimmed = domain.trim();
  return trimmed === "" ? null : trimmed;
}

function toSearchRow(row: CompanyRecord) {
  return {
    id: row.id,
    name: row.name,
    domain: row.domain,
    score: row.score,
    status: row.status,
    researchedAt: row.researchedAt,
    nextFollowUpAt: row.nextFollowUpAt,
  };
}

export async function searchCompanyRecords(input: {
  companyId: string;
  query: string;
  status?: CompanyRecordStatus;
  domain?: string;
}): Promise<
  Array<
    Pick<
      CompanyRecord,
      | "id"
      | "name"
      | "domain"
      | "score"
      | "status"
      | "researchedAt"
      | "nextFollowUpAt"
    >
  >
> {
  const filters = [eq(companyRecords.companyId, input.companyId)];
  const query = input.query.trim();
  if (query) {
    const pattern = `%${query}%`;
    const match = or(
      ilike(companyRecords.name, pattern),
      ilike(companyRecords.domain, pattern),
    );
    if (match) filters.push(match);
  }
  if (input.status) {
    filters.push(eq(companyRecords.status, input.status));
  }
  if (input.domain) {
    filters.push(eq(companyRecords.domain, input.domain));
  }

  const rows = await db.query.companyRecords.findMany({
    where: and(...filters),
    limit: SEARCH_LIMIT,
  });

  return rows.slice(0, SEARCH_LIMIT).map(toSearchRow);
}

export async function getCompanyRecord(input: {
  companyId: string;
  recordId: string;
}): Promise<CompanyRecord | { error: "Not found" }> {
  const row = await db.query.companyRecords.findFirst({
    where: eq(companyRecords.id, input.recordId),
  });

  if (!row || row.companyId !== input.companyId) {
    return { error: "Not found" };
  }

  return row;
}

export async function upsertCompanyRecord(input: {
  companyId: string;
  sourceAgentId: string;
  recordId?: string;
  entityType: "account" | "person";
  name: string;
  domain?: string;
  payload?: Record<string, unknown>;
  score?: number;
  status?: CompanyRecordStatus;
  nextFollowUpAt?: Date | null;
}): Promise<
  | { id: string; status: CompanyRecordStatus; researchedAt: Date | null }
  | { error: string }
> {
  if (input.score !== undefined && !isValidFitScore(input.score)) {
    return { error: "score must be an integer from 0 to 100" };
  }

  const domain = normalizeDomain(input.domain);
  const now = new Date();
  const researchedAt =
    input.status === "researched" ? now : undefined;

  try {
    const existing = await findExistingRecord({
      companyId: input.companyId,
      recordId: input.recordId,
      domain,
    });

    if (input.recordId && !existing) {
      return { error: "Not found" };
    }

    if (existing) {
      if (existing.companyId !== input.companyId) {
        return { error: "Not found" };
      }

      const fields = {
        sourceAgentId: input.sourceAgentId,
        entityType: input.entityType,
        name: input.name,
        domain: input.domain === undefined ? existing.domain : domain,
        payload: {
          ...existing.payload,
          ...(input.payload ?? {}),
        },
        ...(input.score !== undefined ? { score: input.score } : {}),
        ...(researchedAt ? { researchedAt } : {}),
        ...(input.nextFollowUpAt !== undefined
          ? { nextFollowUpAt: input.nextFollowUpAt }
          : {}),
        updatedAt: now,
      };

      // A status change goes through the lead event log (S100), with the
      // other fields in the same update.
      if (input.status !== undefined && input.status !== existing.status) {
        const moved = await transitionLeadStatus(db, {
          companyId: input.companyId,
          recordId: existing.id,
          toStatus: input.status,
          actor: { agentId: input.sourceAgentId },
          at: now,
          set: fields,
        });
        if (moved.changed) {
          return {
            id: existing.id,
            status: input.status,
            researchedAt: researchedAt ?? existing.researchedAt,
          };
        }
        if (moved.reason === "not_found") return { error: "Not found" };
        // same_status: a concurrent writer got there first; write the rest.
      }

      const [updated] = await db
        .update(companyRecords)
        .set(fields)
        .where(eq(companyRecords.id, existing.id))
        .returning({
          id: companyRecords.id,
          status: companyRecords.status,
          researchedAt: companyRecords.researchedAt,
        });

      return updated;
    }

    const inserted = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(companyRecords)
        .values({
          companyId: input.companyId,
          sourceAgentId: input.sourceAgentId,
          entityType: input.entityType,
          name: input.name,
          domain,
          payload: input.payload ?? {},
          score: input.score,
          status: input.status ?? "pending",
          researchedAt: researchedAt ?? null,
          nextFollowUpAt: input.nextFollowUpAt ?? null,
        })
        .returning({
          id: companyRecords.id,
          status: companyRecords.status,
          researchedAt: companyRecords.researchedAt,
        });
      await insertLeadEvent(tx, {
        companyId: input.companyId,
        recordId: row.id,
        fromStatus: null,
        toStatus: row.status,
        actor: { agentId: input.sourceAgentId },
        at: now,
      });
      return row;
    });

    return inserted;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to upsert record";
    return { error: message };
  }
}

async function findExistingRecord(input: {
  companyId: string;
  recordId?: string;
  domain: string | null;
}): Promise<CompanyRecord | undefined> {
  if (input.recordId) {
    const row = await db.query.companyRecords.findFirst({
      where: eq(companyRecords.id, input.recordId),
    });
    return row;
  }

  if (!input.domain) {
    return undefined;
  }

  return db.query.companyRecords.findFirst({
    where: and(
      eq(companyRecords.companyId, input.companyId),
      eq(companyRecords.domain, input.domain),
    ),
  });
}
