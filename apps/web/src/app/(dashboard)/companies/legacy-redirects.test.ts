import { describe, expect, it, vi } from "vitest";
import { permanentRedirect } from "next/navigation";
import LegacyCompaniesPage from "./page";
import LegacyCompanyDetailPage from "./[id]/page";

vi.mock("next/navigation", () => ({ permanentRedirect: vi.fn() }));

describe("legacy /companies routes", () => {
  it("redirects /companies to /settings/companies", () => {
    LegacyCompaniesPage();
    expect(permanentRedirect).toHaveBeenCalledWith("/settings/companies");
  });

  it("redirects /companies/[id] to /settings/companies/[id]", async () => {
    await LegacyCompanyDetailPage({ params: Promise.resolve({ id: "c1" }) });
    expect(permanentRedirect).toHaveBeenCalledWith("/settings/companies/c1");
  });
});
