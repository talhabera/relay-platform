import { describe, expect, it } from "vitest";

import { leadWindowFor } from "./session-access";
import { SESSION_LEADS_CSV_COLUMNS, sessionLeadsToCsv, toSessionLead } from "./session-leads";

const row = {
  id: "r1",
  entityType: "account" as const,
  name: "AlphaLog",
  domain: null,
  phone: null,
  source: "outbound",
  status: "borderline",
  fitScore: 58,
  reasons: ["Under 20 employees"],
  rejectReason: null,
  payload: { city: "Augsburg", contact: { name: "  " } },
  createdAt: new Date("2026-09-21T06:00:00Z"),
};

describe("toSessionLead", () => {
  it("reads area and contact from the payload, ignoring blank contacts", () => {
    expect(toSessionLead(row)).toMatchObject({ location: "Augsburg", contact: null, reasons: ["Under 20 employees"] });
  });

  it("falls back to the intake lokasyon and keeps a contact role", () => {
    const lead = toSessionLead({
      ...row,
      payload: { intake: { lokasyon: "Kadıköy" }, contact: { name: "Anna Roth", role: "Office Manager" } },
      reasons: null,
    });
    expect(lead).toMatchObject({ location: "Kadıköy", contact: { name: "Anna Roth", role: "Office Manager" }, reasons: [] });
  });
});

describe("sessionLeadsToCsv", () => {
  it("writes a BOM, the fixed header and formula-escaped cells", () => {
    const csv = sessionLeadsToCsv([
      { ...row, name: "@SUM(A1)", payload: { intake: { kod: "-12", butce: "5M" }, contact: { name: "Julia" } } },
    ]);
    const [header, line] = csv.slice(1).split("\r\n");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(header).toBe(SESSION_LEADS_CSV_COLUMNS.join(","));
    const cells = line.split(",");
    const at = (c: (typeof SESSION_LEADS_CSV_COLUMNS)[number]) => cells[SESSION_LEADS_CSV_COLUMNS.indexOf(c)];
    expect(at("name")).toBe("'@SUM(A1)");
    expect(at("kod")).toBe("'-12");
    expect(at("contact")).toBe("Julia");
    expect(at("fitScore")).toBe("58");
    expect(at("createdAt")).toBe("2026-09-21T06:00:00.000Z");
  });
});

describe("leadWindowFor", () => {
  it("is the ISO week the session started in, company time", () => {
    // Sunday 27 Sep 23:30 in Istanbul is still week 39 there (Monday in UTC+3 starts 28 Sep).
    const out = leadWindowFor({ companyId: "c1", createdAt: new Date("2026-09-27T20:30:00Z") }, "Europe/Istanbul");
    expect(out.weekId).toBe("2026-W39");
    expect(out.window).toEqual({
      companyId: "c1",
      from: new Date("2026-09-20T21:00:00Z"),
      to: new Date("2026-09-27T21:00:00Z"),
    });
  });

  it("falls back to UTC for a bad timezone", () => {
    expect(leadWindowFor({ companyId: "c1", createdAt: new Date("2026-09-23T12:00:00Z") }, "Mars/Base").timeZone).toBe("UTC");
  });
});
