import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { leads } from "./leads";

describe("leads table", () => {
  const config = getTableConfig(leads);

  it("keeps one lead per chat (idempotency rests on this unique index)", () => {
    const index = config.indexes.find(
      (i) => i.config.name === "leads_chat_id_uidx",
    );
    expect(index?.config.unique).toBe(true);
    expect(index?.config.columns.map((c) => ("name" in c ? c.name : ""))).toEqual([
      "chat_id",
    ]);
  });

  it("carries the tenant on every row", () => {
    const column = config.columns.find((c) => c.name === "company_id");
    expect(column?.notNull).toBe(true);
  });

  it("bounds skor to 1-10 at the database", () => {
    expect(config.checks.map((c) => c.name)).toContain("leads_skor_chk");
  });
});
