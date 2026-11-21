import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { requireCompanyAccess } from "@/lib/authorization";

import { resolveSettingsCompany } from "../active-company";
import { loadDeleteImpact } from "./companies-data";
import { deleteCompanyConfirmed } from "./delete-actions";
import type { CompanyDeleteImpact } from "./company-view";

vi.mock("@/lib/authorization", () => ({ requireCompanyAccess: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../active-company", () => ({ resolveSettingsCompany: vi.fn() }));
vi.mock("./companies-data", () => ({ loadDeleteImpact: vi.fn() }));

const company = { id: "c-brightline", name: "Brightline Dental", ownerId: "owner-1" };
const empty: CompanyDeleteImpact = {
  customerAgents: 0,
  operatorAgents: 0,
  conversations: 0,
  schedules: 0,
  packages: [],
  members: 0,
};

describe("deleteCompanyConfirmed", () => {
  let where: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireCompanyAccess).mockResolvedValue({
      session: { user: { id: "owner-1" } },
      company,
    } as never);
    vi.mocked(resolveSettingsCompany).mockResolvedValue({
      company: { id: "c-acme" },
      isOwner: true,
      ownsAny: true,
    } as never);
    vi.mocked(loadDeleteImpact).mockResolvedValue(empty);
    where = vi.fn().mockResolvedValue(undefined);
    vi.mocked(db.delete).mockReturnValue({ where } as never);
  });

  it("is owner-only", async () => {
    vi.mocked(requireCompanyAccess).mockRejectedValue(new Error("Unauthorized"));
    await expect(deleteCompanyConfirmed({ companyId: company.id })).rejects.toThrow("Unauthorized");
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("refuses the active company", async () => {
    vi.mocked(resolveSettingsCompany).mockResolvedValue({
      company: { id: company.id },
      isOwner: true,
      ownsAny: true,
    } as never);
    const result = await deleteCompanyConfirmed({ companyId: company.id });
    expect(result).toEqual({ error: "Switch to another company to delete Brightline Dental" });
    expect(db.delete).not.toHaveBeenCalled();
  });

  it("deletes an empty company without a typed name", async () => {
    const result = await deleteCompanyConfirmed({ companyId: company.id });
    expect(result).toEqual({ ok: true });
    expect(where).toHaveBeenCalledTimes(1);
  });

  it("requires the exact name when the company holds data", async () => {
    vi.mocked(loadDeleteImpact).mockResolvedValue({ ...empty, operatorAgents: 2 });
    expect(await deleteCompanyConfirmed({ companyId: company.id, confirmName: "Brightline" })).toEqual({
      error: "Type Brightline Dental to confirm",
    });
    expect(db.delete).not.toHaveBeenCalled();

    expect(
      await deleteCompanyConfirmed({ companyId: company.id, confirmName: " Brightline Dental " }),
    ).toEqual({ ok: true });
    expect(where).toHaveBeenCalledTimes(1);
  });
});
