import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { installPackageForCompany } from "@/lib/packages/install";
import { PackageInstallError } from "@/lib/operator/package-errors";
import { installPackage } from "./package-actions";

vi.mock("@/lib/packages/install", () => ({
  installPackageForCompany: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

const companyId = "550e8400-e29b-41d4-a716-446655440000";

describe("installPackage action", () => {
  beforeEach(() => vi.clearAllMocks());

  it("installs through lib/packages and returns the first agent as id", async () => {
    vi.mocked(installPackageForCompany).mockResolvedValue({
      installId: "inst-1",
      slug: "lead-engine",
      agentIds: ["a-1", "a-2", "a-3"],
      workflowIds: ["w-1"],
      cronJobIds: ["j-1", "j-2", "j-3"],
      waitingFor: [],
    });

    const result = await installPackage({ companyId, slug: "lead-engine" });

    expect(installPackageForCompany).toHaveBeenCalledWith(companyId, "lead-engine");
    expect(result.id).toBe("a-1");
    expect(result.cronJobIds).toHaveLength(3);
    expect(revalidatePath).toHaveBeenCalledWith("/operator");
  });

  it("rejects a bad company id before installing", async () => {
    await expect(installPackage({ companyId: "nope", slug: "insights" })).rejects.toThrow();
    expect(installPackageForCompany).not.toHaveBeenCalled();
  });

  it("passes install errors through", async () => {
    vi.mocked(installPackageForCompany).mockRejectedValue(
      new PackageInstallError("Insights is already installed", "already_installed"),
    );
    await expect(installPackage({ companyId, slug: "insights" })).rejects.toMatchObject({
      code: "already_installed",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
