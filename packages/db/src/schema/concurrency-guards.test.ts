import { describe, expect, it } from "vitest";
import { PgDialect, getTableConfig } from "drizzle-orm/pg-core";
import { checkpoints } from "./checkpoints";
import { companyMembers } from "./company-members";

function uniqueIndex(
  table: Parameters<typeof getTableConfig>[0],
  name: string,
) {
  const entry = getTableConfig(table).indexes.find(
    (index) => index.config.name === name,
  );
  if (!entry) throw new Error(`missing index ${name}`);
  const where = entry.config.where
    ? new PgDialect().sqlToQuery(entry.config.where).sql
    : null;
  return { unique: entry.config.unique, where };
}

describe("W2FIX concurrency guards (migration 0030)", () => {
  it("allows one pending card per company record", () => {
    const index = uniqueIndex(checkpoints, "checkpoints_record_pending_uidx");
    expect(index.unique).toBe(true);
    expect(index.where).toContain(`"status" = 'pending'`);
    expect(index.where).toContain(`"record_id" IS NOT NULL`);
  });

  it("allows one membership per client user", () => {
    const index = uniqueIndex(
      companyMembers,
      "company_members_client_user_uidx",
    );
    expect(index.unique).toBe(true);
    expect(index.where).toContain(`"role" = 'client'`);
  });

  it("stamps refresh requests on the card", () => {
    expect(getTableConfig(checkpoints).columns.map((c) => c.name)).toContain(
      "refresh_requested_at",
    );
  });
});
