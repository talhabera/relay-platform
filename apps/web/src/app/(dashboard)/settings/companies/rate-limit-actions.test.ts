import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { requireCompanyAccess } from "@/lib/authorization";
import { buildRateLimitSettings } from "@/lib/company/rate-limit-settings";
import { updateCompanyRateLimits } from "./rate-limit-actions";

vi.mock("@/lib/authorization", () => ({
  requireCompanyAccess: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const invalidate = vi.hoisted(() => vi.fn());
vi.mock("@relay/db/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@relay/db/rate-limit")>()),
  invalidateCompanyOverrides: invalidate,
}));

const companyId = "550e8400-e29b-41d4-a716-446655440000";

describe("updateCompanyRateLimits", () => {
  const set = vi.fn();
  const where = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
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
    await expect(
      updateCompanyRateLimits(companyId, { "cron.run.job.hour": 3 }),
    ).rejects.toThrow("Forbidden");
    expect(db.update).not.toHaveBeenCalled();
  });

  it("stores clamped values, drops unknown and default-equal keys, clears the cache", async () => {
    const result = await updateCompanyRateLimits(companyId, {
      "cron.run.job.hour": 3,
      "operator.chat.user.minute": 20, // equals the default
      "widget.visitor.minute": 1_000_000, // clamped to ceiling
      "upload.user.minute": 5, // platform-only
      "made.up": 4,
    });

    const stored = set.mock.calls[0]![0].rateLimits;
    expect(stored["cron.run.job.hour"]).toBe(3);
    expect(stored["widget.visitor.minute"]).toBe(100);
    expect(stored).not.toHaveProperty("operator.chat.user.minute");
    expect(stored).not.toHaveProperty("upload.user.minute");
    expect(stored).not.toHaveProperty("made.up");
    expect(result.rateLimits).toEqual(stored);
    expect(invalidate).toHaveBeenCalledWith(companyId);
  });

  it("rejects negative and fractional values", async () => {
    await expect(
      updateCompanyRateLimits(companyId, { "cron.run.job.hour": -1 }),
    ).rejects.toThrow();
    await expect(
      updateCompanyRateLimits(companyId, { "cron.run.job.hour": 1.5 }),
    ).rejects.toThrow();
    expect(db.update).not.toHaveBeenCalled();
  });
});

describe("buildRateLimitSettings", () => {
  it("groups every settable policy and marks company values", () => {
    const groups = buildRateLimitSettings({ "cron.run.job.hour": 3 });
    expect(groups.map((g) => g.id)).toEqual([
      "customer",
      "operator",
      "panel",
      "cron",
    ]);
    const job = groups
      .flatMap((g) => g.rows)
      .find((r) => r.name === "cron.run.job.hour")!;
    expect(job).toMatchObject({ value: 3, defaultValue: 12, unit: "per hour" });
    const names = groups.flatMap((g) => g.rows.map((r) => r.name));
    expect(names).not.toContain("upload.user.minute");
    expect(names).not.toContain("stream.chat");
    expect(
      groups.flatMap((g) => g.rows).find((r) => r.name === "stream.user"),
    ).toMatchObject({ unit: "at once", value: null });
  });
});
