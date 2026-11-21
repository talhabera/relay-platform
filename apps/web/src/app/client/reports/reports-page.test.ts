import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const prefsLimit = vi.fn();

vi.mock("@/db", () => ({
  db: {
    query: { companyMembers: { findFirst: (...a: unknown[]) => findFirst(...a) } },
    select: () => ({ from: () => ({ where: () => ({ limit: (...a: unknown[]) => prefsLimit(...a) }) }) }),
  },
}));
vi.mock("@/lib/auth-server", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/operator/access", () => ({ requireClientAccess: vi.fn() }));
vi.mock("@/lib/operator/companies", () => ({
  listAccessibleCompanies: vi.fn(),
  resolveActiveCompanyId: vi.fn(),
}));
vi.mock("@/lib/reports/read", () => ({ findReportPage: vi.fn() }));

import { requireSession } from "@/lib/auth-server";
import { fixtureData } from "@/lib/fixtures/data";
import { requireClientAccess } from "@/lib/operator/access";
import { listAccessibleCompanies, resolveActiveCompanyId } from "@/lib/operator/companies";
import { findReportPage } from "@/lib/reports/read";
import { buildReportView } from "@/lib/reports/view";

import { loadReportsPage, parseReportsSearch, reportsHref } from "./load-report";
import { ReportBody } from "./report-view";

const COMPANY = { id: "c-acme", name: "Acme GmbH", timezone: "Europe/Berlin" };
const snap = (id: string) => fixtureData.reportSnapshots.find((r) => r.id === id)!;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue({ user: { id: "u-markus" } } as never);
  vi.mocked(requireClientAccess).mockResolvedValue({ company: COMPANY, role: "client" } as never);
  findFirst.mockResolvedValue({ companyId: COMPANY.id });
  prefsLimit.mockResolvedValue([]);
  vi.mocked(findReportPage).mockResolvedValue({
    snapshot: snap("fx-report-d0924"),
    previousId: "prev-id",
    nextId: null,
  });
});

describe("parseReportsSearch", () => {
  it("defaults to daily and ignores unknown periods", () => {
    expect(parseReportsSearch({})).toEqual({ period: "daily", id: null });
    expect(parseReportsSearch({ period: "yearly" }).period).toBe("daily");
    expect(parseReportsSearch({ period: "weekly", id: "abc" })).toEqual({ period: "weekly", id: "abc" });
    expect(parseReportsSearch({ period: ["monthly", "daily"] }).period).toBe("monthly");
  });
});

describe("loadReportsPage", () => {
  it("authorizes the client's single company with requireClientAccess", async () => {
    const data = await loadReportsPage({ period: "daily", id: null });
    expect(requireClientAccess).toHaveBeenCalledWith(COMPANY.id);
    expect(listAccessibleCompanies).not.toHaveBeenCalled();
    expect(findReportPage).toHaveBeenCalledWith(COMPANY.id, "daily", null);
    expect(data).toMatchObject({
      kind: "report",
      company: { id: COMPANY.id, name: "Acme GmbH" },
      role: "client",
      period: "daily",
      previousHref: reportsHref("daily", "prev-id"),
      nextHref: null,
    });
    if (data.kind === "report") expect(data.view?.rangeLabel).toBe("Thu 24 Sep 2026");
  });

  it("owner / member preview uses the active company", async () => {
    findFirst.mockResolvedValue(undefined);
    prefsLimit.mockResolvedValue([{ activeCompanyId: COMPANY.id }]);
    vi.mocked(listAccessibleCompanies).mockResolvedValue([COMPANY] as never);
    vi.mocked(resolveActiveCompanyId).mockReturnValue(COMPANY.id);
    vi.mocked(requireClientAccess).mockResolvedValue({ company: COMPANY, role: "owner" } as never);
    const data = await loadReportsPage({ period: "weekly", id: "w" });
    expect(requireClientAccess).toHaveBeenCalledWith(COMPANY.id);
    expect(findReportPage).toHaveBeenCalledWith(COMPANY.id, "weekly", "w");
    expect(data).toMatchObject({ kind: "report", role: "owner" });
  });

  it("refuses when requireClientAccess refuses, before reading snapshots", async () => {
    vi.mocked(requireClientAccess).mockRejectedValue(new Error("Unauthorized"));
    await expect(loadReportsPage({ period: "daily", id: null })).rejects.toThrow("Unauthorized");
    expect(findReportPage).not.toHaveBeenCalled();
  });

  it("no company to show", async () => {
    findFirst.mockResolvedValue(undefined);
    vi.mocked(listAccessibleCompanies).mockResolvedValue([]);
    vi.mocked(resolveActiveCompanyId).mockReturnValue(null);
    expect(await loadReportsPage({ period: "daily", id: null })).toEqual({ kind: "no-company" });
    expect(requireClientAccess).not.toHaveBeenCalled();
  });

  it("no closed period yet gives a null view", async () => {
    vi.mocked(findReportPage).mockResolvedValue(null);
    const data = await loadReportsPage({ period: "weekly", id: null });
    expect(data).toMatchObject({ kind: "report", view: null, previousHref: null, nextHref: null });
  });
});

describe("ReportBody", () => {
  it("daily renders the four sourced cards and no Site visits card", () => {
    const html = renderToStaticMarkup(h(ReportBody, { view: buildReportView(snap("fx-report-d0924"), "Europe/Berlin") }));
    expect(html.split('data-slot="report-stat"').length - 1).toBe(4);
    expect(html).toContain("Conversations");
    expect(html).toContain("Staff answers");
    expect(html).not.toMatch(/Site visits/);
    expect(html).not.toContain('data-slot="report-summary"');
  });

  it("weekly renders goals, funnel and delivered per day; hides cost", () => {
    const html = renderToStaticMarkup(h(ReportBody, { view: buildReportView(snap("fx-report-w0914"), "Europe/Berlin") }));
    expect(html).toContain("Qualified leads delivered · 14–20 Sep");
    expect(html).toContain("Lead quality score");
    expect(html).toContain('data-type="funnel"');
    expect(html).toContain('data-type="bar"');
    expect(html).toContain("Delivered per day");
    expect(html).toContain("Also this week");
    expect(html).not.toMatch(/Cost per qualified lead|Site visits|New reviews|Posts published/);
  });

  it("monthly renders the headline row with previous-period copy, delivered per week and Also this month", () => {
    const html = renderToStaticMarkup(h(ReportBody, { view: buildReportView(snap("fx-report-m2608"), "Europe/Berlin") }));
    expect(html).toContain('data-period="monthly"');
    expect(html.split('data-slot="report-stat"').length - 1).toBe(3);
    expect(html).toContain("Up from 23 in July");
    expect(html).toContain("Delivered per week");
    expect(html).toContain("Also this month");
    expect(html).not.toContain('data-type="funnel"');
    expect(html).not.toMatch(/Cost per qualified lead|Site visits|New reviews|Posts published|Conversations by source/);
  });

  it("an all-sourceless snapshot shows the empty note", () => {
    const html = renderToStaticMarkup(h(ReportBody, { view: buildReportView(snap("fx-report-w0907"), "Europe/Berlin") }));
    expect(html).toContain('data-slot="report-empty"');
    expect(html).not.toContain('data-slot="chart-card"');
  });
});
