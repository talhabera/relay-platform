import { describe, expect, it } from "vitest";

import {
  cappedNote,
  initialLeadTab,
  leadActionsFor,
  leadPaneSubtitle,
  leadRowView,
  leadsExportHref,
  paginateLeads,
  parseSessionLeadTab,
  sessionLeadTab,
  showingLabel,
  type SessionLeadRecord,
} from "./leads-pane-model";

const counts = (c: Partial<Record<"qualified" | "borderline" | "excluded", number>>) => ({
  qualified: 0,
  borderline: 0,
  excluded: 0,
  gathered: 0,
  inbound: 0,
  ...c,
});

const account: SessionLeadRecord = {
  id: "r1",
  entityType: "account",
  name: "Brandt Logistik GmbH",
  domain: "brandt.de",
  phone: null,
  source: "outbound",
  status: "qualified",
  fitScore: 91,
  reasons: ["New office in Garching", "Size fit", "Hiring", "Extra"],
  rejectReason: null,
  contact: { name: "Julia Weber", role: "Office Manager" },
  location: "Munich",
};

describe("sessionLeadTab", () => {
  it("puts a lead that reached qualified on Qualified, whatever came after", () => {
    expect(sessionLeadTab("qualified", true)).toBe("qualified");
    expect(sessionLeadTab("delivered", true)).toBe("qualified");
    expect(sessionLeadTab("contacted", true)).toBe("qualified");
  });

  it("keeps excluded leads off Qualified even when they were qualified once", () => {
    expect(sessionLeadTab("rejected", true)).toBe("excluded");
    expect(sessionLeadTab("unqualified", false)).toBe("excluded");
  });

  it("borderline is its own tab; unscored leads sit on none", () => {
    expect(sessionLeadTab("borderline", false)).toBe("borderline");
    expect(sessionLeadTab("gathered", false)).toBeNull();
    expect(sessionLeadTab("contacted", false)).toBeNull();
  });

  it("parses only known tabs", () => {
    expect(parseSessionLeadTab("excluded")).toBe("excluded");
    expect(parseSessionLeadTab("new")).toBeNull();
    expect(parseSessionLeadTab(null)).toBeNull();
  });
});

describe("initialLeadTab", () => {
  it("opens on Borderline while the agent asks about borderline leads", () => {
    expect(initialLeadTab(counts({ qualified: 44, borderline: 1 }), true)).toBe("borderline");
  });

  it("opens on Qualified otherwise", () => {
    expect(initialLeadTab(counts({ qualified: 44, borderline: 1 }), false)).toBe("qualified");
    expect(initialLeadTab(counts({ borderline: 0 }), true)).toBe("qualified");
  });

  it("opens on Borderline when it is the only tab with leads to act on", () => {
    expect(initialLeadTab(counts({ borderline: 2 }), false)).toBe("borderline");
  });
});

describe("pagination", () => {
  const rows = Array.from({ length: 44 }, (_, i) => i);

  it("pages five at a time", () => {
    const page = paginateLeads(rows, 1);
    expect(page).toMatchObject({ page: 1, pageCount: 9, first: 1, last: 5, total: 44 });
    expect(page.rows).toEqual([0, 1, 2, 3, 4]);
    expect(showingLabel("qualified", page, 44)).toBe("Showing 1–5 of 44 leads");
  });

  it("clamps the page and handles the last partial page", () => {
    const page = paginateLeads(rows, 99);
    expect(page).toMatchObject({ page: 9, first: 41, last: 44 });
    expect(paginateLeads(rows, 0).page).toBe(1);
  });

  it("labels a single borderline lead and an empty tab", () => {
    expect(showingLabel("borderline", paginateLeads([1], 1), 1)).toBe("Showing 1 of 1 borderline lead");
    const empty = paginateLeads([], 1);
    expect(empty).toMatchObject({ page: 1, pageCount: 1, first: 0, last: 0 });
    expect(showingLabel("excluded", empty, 0)).toBe("No excluded leads");
  });

  it("uses the tab total, not the listed rows, when the list is capped", () => {
    expect(showingLabel("qualified", paginateLeads(rows, 1), 812)).toBe("Showing 1–5 of 812 leads");
    expect(cappedNote(812, 500)).toBe("The list shows the first 500. Export CSV includes all 812.");
    expect(cappedNote(44, 44)).toBeNull();
  });
});

describe("leadRowView", () => {
  it("shows an outbound account with its contact and at most three reasons", () => {
    expect(leadRowView(account)).toEqual({
      company: "Brandt Logistik GmbH",
      companyMeta: "Munich · brandt.de",
      contactName: "Julia Weber",
      contactMeta: "Office Manager",
      fitScore: 91,
      reasons: ["New office in Garching", "Size fit", "Hiring"],
      borderline: false,
    });
  });

  it("marks a borderline account without a contact as Not found", () => {
    const view = leadRowView({ ...account, status: "borderline", contact: null, domain: null, fitScore: 58 });
    expect(view).toMatchObject({ borderline: true, contactName: null, contactMeta: "No decision maker yet", companyMeta: "Munich" });
  });

  it("shows an inbound person with channel, area and phone", () => {
    const view = leadRowView({
      ...account,
      entityType: "person",
      name: "Ayşe Yılmaz",
      source: "whatsapp",
      phone: "+905321234567",
      contact: null,
      location: "Kadıköy",
    });
    expect(view).toMatchObject({ companyMeta: "WhatsApp · Kadıköy", contactName: "+905321234567", contactMeta: "Phone" });
  });

  it("shows the reject reason on excluded leads", () => {
    const view = leadRowView({ ...account, status: "rejected", rejectReason: "Under 20 employees" });
    expect(view.reasons).toEqual(["Under 20 employees"]);
  });
});

describe("pane copy and links", () => {
  it("builds the header subtitle from the ISO week", () => {
    expect(
      leadPaneSubtitle({ weekId: "2026-W39", rangeLabel: "21–27 Sep 2026", counts: { gathered: 146, inbound: 9 } }),
    ).toBe("Week 39 · 21–27 Sep 2026 · 146 gathered, 9 inbound");
  });

  it("offers accept/reject on borderline and exclude on qualified only", () => {
    expect(leadActionsFor("borderline")).toEqual(["accept", "reject"]);
    expect(leadActionsFor("qualified")).toEqual(["exclude"]);
    expect(leadActionsFor("excluded")).toEqual([]);
  });

  it("links the CSV export to the session and tab", () => {
    expect(leadsExportHref("chat-1", "borderline")).toBe("/api/operator/sessions/chat-1/leads/export?tab=borderline");
  });
});

import { KOLEVA_FUNNEL_STATUSES } from "@relay/db";
import {
  FUNNEL_STATUSES,
  formatTryMinor,
  leadStatusLabel,
  parseTryAmount,
} from "./leads-pane-model";

describe("Koleva sales funnel", () => {
  it("picker list mirrors KOLEVA_FUNNEL_STATUSES", () => {
    expect([...FUNNEL_STATUSES]).toEqual([...KOLEVA_FUNNEL_STATUSES]);
  });

  it("meeting, proposal and won stay on Qualified; unqualified is Excluded", () => {
    expect(sessionLeadTab("meeting", true)).toBe("qualified");
    expect(sessionLeadTab("proposal", true)).toBe("qualified");
    expect(sessionLeadTab("won", true)).toBe("qualified");
    expect(sessionLeadTab("unqualified", true)).toBe("excluded");
  });

  it("row label: Teklif, and Satış with package, amount and cash in", () => {
    expect(leadStatusLabel({ ...account, status: "proposal" })).toBe("Teklif");
    expect(
      leadStatusLabel({ ...account, status: "won", salePackage: "website", saleAmountMinor: 8_000_000 }),
    ).toBe("Satış, Web sitesi, 80.000 TL");
    expect(
      leadStatusLabel({
        ...account,
        status: "won",
        salePackage: "website",
        saleAmountMinor: 8_000_000,
        paidMinor: 4_000_000,
      }),
    ).toBe("Satış, Web sitesi, 80.000 TL, tahsil edilen 40.000 TL");
    expect(leadStatusLabel({ ...account, status: "won", salePackage: "social", saleAmountMinor: 2_500_050 })).toBe(
      "Satış, Sosyal medya, 25.000,50 TL",
    );
    expect(leadStatusLabel({ ...account, status: "outreach_pending" })).toBeNull();
  });

  it("formats and parses TL amounts the Turkish way", () => {
    expect(formatTryMinor(123_456_789)).toBe("1.234.567,89 TL");
    expect(formatTryMinor(100)).toBe("1 TL");
    expect(parseTryAmount("80.000")).toBe(8_000_000);
    expect(parseTryAmount("80000")).toBe(8_000_000);
    expect(parseTryAmount(" 80.000,5 TL ")).toBe(8_000_050);
    expect(parseTryAmount("1.234.567,89")).toBe(123_456_789);
    for (const bad of ["", "0", "abc", "80,000.00", "1.23", "12,345", "-5", "80.00.0"]) {
      expect(parseTryAmount(bad)).toBeNull();
    }
  });
});
