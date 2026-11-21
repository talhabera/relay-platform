import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { requireCompanyAccess } from "@/lib/authorization";
import { updateCompanyAdSettingsSchema } from "@/lib/validators/company";
import { updateCompanyAdSettings } from "./ad-settings-actions";

vi.mock("@/lib/authorization", () => ({
  requireCompanyAccess: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const companyId = "550e8400-e29b-41d4-a716-446655440000";

const valid = {
  adMonthlyTargetMinor: 25_000_000,
  adCplStopMinor: 80_000,
  adDailyCapMinor: 100_000,
  adCapacitySiteMonthly: 2,
  adCapacitySocialMonthly: 3,
};

describe("updateCompanyAdSettings", () => {
  const set = vi.fn();
  const where = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      session: { user: { id: "owner-1" } },
      company: { id: companyId, ownerId: "owner-1" },
    } as never);
    where.mockResolvedValue(undefined);
    set.mockReturnValue({ where });
    vi.mocked(db.update).mockReturnValue({ set } as never);
  });

  it("rejects non-owners before writing", async () => {
    vi.mocked(requireCompanyAccess).mockRejectedValue(new Error("Forbidden"));
    await expect(updateCompanyAdSettings(companyId, valid)).rejects.toThrow(
      "Forbidden",
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it("stores whole minor units and capacities", async () => {
    await updateCompanyAdSettings(companyId, valid);
    expect(set.mock.calls[0]![0]).toMatchObject(valid);
  });

  it("null clears a field", async () => {
    await updateCompanyAdSettings(companyId, {
      adMonthlyTargetMinor: null,
      adCplStopMinor: null,
      adDailyCapMinor: null,
      adCapacitySiteMonthly: null,
      adCapacitySocialMonthly: null,
    });
    expect(set.mock.calls[0]![0]).toMatchObject({
      adMonthlyTargetMinor: null,
      adCplStopMinor: null,
      adDailyCapMinor: null,
      adCapacitySiteMonthly: null,
      adCapacitySocialMonthly: null,
    });
  });

  it("capacity 0 is allowed (product takes no new deals)", async () => {
    await updateCompanyAdSettings(companyId, {
      ...valid,
      adCapacitySiteMonthly: 0,
      adCapacitySocialMonthly: 0,
    });
    expect(set.mock.calls[0]![0]).toMatchObject({
      adCapacitySiteMonthly: 0,
      adCapacitySocialMonthly: 0,
    });
  });

  it.each([
    ["negative money", { adMonthlyTargetMinor: -1 }],
    ["fractional money", { adCplStopMinor: 800.5 }],
    ["daily cap below 1", { adDailyCapMinor: 0 }],
    ["negative capacity", { adCapacitySiteMonthly: -1 }],
    ["fractional capacity", { adCapacitySocialMonthly: 1.5 }],
  ])("rejects %s before writing", async (_label, patch) => {
    await expect(
      updateCompanyAdSettings(companyId, { ...valid, ...patch }),
    ).rejects.toThrow();
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("updateCompanyAdSettingsSchema", () => {
  it("accepts whole non-negative minor units and counts, or null", () => {
    expect(updateCompanyAdSettingsSchema.parse(valid)).toEqual(valid);
    expect(
      updateCompanyAdSettingsSchema.parse({
        adMonthlyTargetMinor: 0,
        adCplStopMinor: 0,
        adDailyCapMinor: 1,
        adCapacitySiteMonthly: 0,
        adCapacitySocialMonthly: 0,
      }),
    ).toBeTruthy();
  });

  it("rejects a daily cap of 0 but allows clearing it with null", () => {
    expect(
      updateCompanyAdSettingsSchema.safeParse({ ...valid, adDailyCapMinor: 0 })
        .success,
    ).toBe(false);
    expect(
      updateCompanyAdSettingsSchema.safeParse({
        ...valid,
        adDailyCapMinor: null,
      }).success,
    ).toBe(true);
  });
});
