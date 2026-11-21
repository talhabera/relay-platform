import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();

vi.mock("@/db", () => ({
  db: { query: { companyMembers: { findFirst: (...a: unknown[]) => findFirst(...a) } } },
}));
vi.mock("@/lib/auth-server", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/operator/access", () => ({ requireClientAccess: vi.fn() }));
vi.mock("@/lib/operator/companies", () => ({
  listAccessibleCompanies: vi.fn(),
  resolveActiveCompanyId: vi.fn(),
}));
vi.mock("@/lib/reports/read", () => ({ listReportArchive: vi.fn() }));

import { requireSession } from "@/lib/auth-server";
import { fixtureData } from "@/lib/fixtures/data";
import { requireClientAccess } from "@/lib/operator/access";
import { listReportArchive } from "@/lib/reports/read";

import { ArchiveBody } from "./archive-view";
import { loadArchivePage } from "./load-archive";

const COMPANY = { id: "c-acme", name: "Acme GmbH", timezone: "Europe/Berlin" };
const NOW = new Date("2026-09-26T08:00:00Z");
const entries = fixtureData.reportSnapshots.map(({ id, period, start, end, frozenAt }) => ({ id, period, start, end, frozenAt }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireSession).mockResolvedValue({ user: { id: "u-markus" } } as never);
  vi.mocked(requireClientAccess).mockResolvedValue({ company: COMPANY, role: "client" } as never);
  findFirst.mockResolvedValue({ companyId: COMPANY.id });
  vi.mocked(listReportArchive).mockResolvedValue(entries);
});

describe("loadArchivePage", () => {
  it("authorizes with requireClientAccess, then lists that company's closed reports", async () => {
    const data = await loadArchivePage("weekly", NOW);
    expect(requireClientAccess).toHaveBeenCalledWith(COMPANY.id);
    expect(listReportArchive).toHaveBeenCalledWith(COMPANY.id, "weekly", NOW);
    expect(data).toMatchObject({ kind: "archive", company: { name: "Acme GmbH" }, role: "client" });
    if (data.kind === "archive") expect(data.view.delivered.every((r) => r.period === "weekly")).toBe(true);
  });

  it("refuses before reading snapshots when requireClientAccess refuses", async () => {
    vi.mocked(requireClientAccess).mockRejectedValue(new Error("Unauthorized"));
    await expect(loadArchivePage(null, NOW)).rejects.toThrow("Unauthorized");
    expect(listReportArchive).not.toHaveBeenCalled();
  });
});

describe("ArchiveBody", () => {
  it("renders Delivered rows linking to each report, Scheduled rows and the Delivery card", async () => {
    const data = await loadArchivePage(null, NOW);
    if (data.kind !== "archive") throw new Error("expected archive");
    const html = renderToStaticMarkup(h(ArchiveBody, { view: data.view }));
    expect(html.split('data-slot="archive-row"').length - 1).toBe(6);
    expect(html).toContain('href="/client/reports?period=monthly&amp;id=fx-report-m2608"');
    expect(html.split('data-slot="archive-scheduled-row"').length - 1).toBe(3);
    expect(html).toContain("Set by your agency");
    expect(html).toContain("On the 1st");
    // No delivery or PDF yet: never claim an email went out.
    expect(html).not.toMatch(/Emailed|Delivered<\/span>|Download/);
  });

  it("shows the empty note when nothing has closed", () => {
    const html = renderToStaticMarkup(
      h(ArchiveBody, { view: { filter: null, delivered: [], scheduled: [], schedule: [] } }),
    );
    expect(html).toContain('data-slot="archive-empty"');
  });
});
