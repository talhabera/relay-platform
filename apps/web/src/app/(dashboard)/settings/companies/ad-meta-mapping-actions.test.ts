import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { db } from "@/db";
import { requireCompanyAccess } from "@/lib/authorization";
import {
  createAdMetaMapping,
  deleteAdMetaMapping,
  updateAdMetaMapping,
} from "./ad-meta-mapping-actions";

vi.mock("@/lib/authorization", () => ({
  requireCompanyAccess: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const companyId = "550e8400-e29b-41d4-a716-446655440000";
const mappingId = "550e8400-e29b-41d4-a716-446655440010";
const valid = { sourceId: "120207123456789", code: "MWEB1", campaignName: "Web sitesi" };

function whereParams(where: ReturnType<typeof vi.fn>): unknown[] {
  const arg = where.mock.calls[0]![0] as SQL;
  return new PgDialect().sqlToQuery(arg).params;
}

describe("ad meta mapping actions", () => {
  const insertValues = vi.fn();
  const insertReturning = vi.fn();
  const updateSet = vi.fn();
  const updateWhere = vi.fn();
  const updateReturning = vi.fn();
  const deleteWhere = vi.fn();
  const deleteReturning = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      session: { user: { id: "owner-1" } },
      company: { id: companyId, ownerId: "owner-1" },
    } as never);

    insertReturning.mockResolvedValue([{ id: mappingId, companyId, ...valid }]);
    insertValues.mockReturnValue({ returning: insertReturning });
    vi.mocked(db.insert).mockReturnValue({ values: insertValues } as never);

    updateReturning.mockResolvedValue([{ id: mappingId, companyId, ...valid }]);
    updateWhere.mockReturnValue({ returning: updateReturning });
    updateSet.mockReturnValue({ where: updateWhere });
    vi.mocked(db.update).mockReturnValue({ set: updateSet } as never);

    deleteReturning.mockResolvedValue([{ id: mappingId }]);
    deleteWhere.mockReturnValue({ returning: deleteReturning });
    vi.mocked(db.delete).mockReturnValue({ where: deleteWhere } as never);
  });

  it("create stores a trimmed mapping for the company", async () => {
    const result = await createAdMetaMapping(companyId, {
      sourceId: "  120207123456789  ",
      code: "MWEB1",
      campaignName: "  Web sitesi  ",
    });
    expect(result.ok).toBe(true);
    expect(insertValues.mock.calls[0]![0]).toMatchObject({
      companyId,
      sourceId: "120207123456789",
      code: "MWEB1",
      campaignName: "Web sitesi",
    });
  });

  it("create refuses a code outside the Meta shape before writing", async () => {
    for (const code of ["G7KF3", "MWEB", "mweb1", "MWEB12", "MWE11"]) {
      const result = await createAdMetaMapping(companyId, { ...valid, code });
      expect(result.ok, code).toBe(false);
      if (!result.ok) expect(result.fieldErrors.code).toBeTruthy();
    }
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("create refuses a non-digit, empty or over-long source_id", async () => {
    for (const sourceId of ["", "   ", "12a34", "12 34", "1".repeat(41)]) {
      const result = await createAdMetaMapping(companyId, {
        ...valid,
        sourceId,
      });
      expect(result.ok, JSON.stringify(sourceId)).toBe(false);
      if (!result.ok) expect(result.fieldErrors.sourceId).toBeTruthy();
    }
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("create accepts a 40-digit source_id", async () => {
    const result = await createAdMetaMapping(companyId, {
      ...valid,
      sourceId: "1".repeat(40),
    });
    expect(result.ok).toBe(true);
  });

  it("duplicate (company_id, source_id) returns a field error instead of throwing", async () => {
    insertReturning.mockRejectedValue(
      Object.assign(new Error("duplicate key value violates unique constraint"), {
        code: "23505",
      }),
    );
    const result = await createAdMetaMapping(companyId, valid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.sourceId).toBeTruthy();
  });

  it("non-owner is refused for add, update and delete", async () => {
    vi.mocked(requireCompanyAccess).mockRejectedValue(new Error("Forbidden"));
    await expect(createAdMetaMapping(companyId, valid)).rejects.toThrow(
      "Forbidden",
    );
    await expect(
      updateAdMetaMapping(companyId, mappingId, valid),
    ).rejects.toThrow("Forbidden");
    await expect(deleteAdMetaMapping(companyId, mappingId)).rejects.toThrow(
      "Forbidden",
    );
    expect(db.insert).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("update is scoped by company_id and refuses another company's mapping", async () => {
    const ok = await updateAdMetaMapping(companyId, mappingId, valid);
    expect(ok.ok).toBe(true);
    expect(whereParams(updateWhere)).toContain(mappingId);
    expect(whereParams(updateWhere)).toContain(companyId);

    updateReturning.mockResolvedValue([]);
    const refused = await updateAdMetaMapping(companyId, mappingId, valid);
    expect(refused.ok).toBe(false);
  });

  it("update duplicate source_id returns a field error instead of throwing", async () => {
    updateReturning.mockRejectedValue(
      Object.assign(new Error("duplicate key value violates unique constraint"), {
        code: "23505",
      }),
    );
    const result = await updateAdMetaMapping(companyId, mappingId, valid);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors.sourceId).toBeTruthy();
  });

  it("delete removes only that row, scoped by company_id", async () => {
    const ok = await deleteAdMetaMapping(companyId, mappingId);
    expect(ok.ok).toBe(true);
    expect(whereParams(deleteWhere)).toContain(mappingId);
    expect(whereParams(deleteWhere)).toContain(companyId);

    deleteReturning.mockResolvedValue([]);
    const refused = await deleteAdMetaMapping(companyId, mappingId);
    expect(refused.ok).toBe(false);
  });
});
