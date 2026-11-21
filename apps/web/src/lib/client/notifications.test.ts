import { describe, expect, it } from "vitest";

import {
  CLIENT_NOTIFICATION_LIMIT,
  buildClientNotifications,
  normalizeWhatsappNumber,
  reportReadyTitle,
} from "./notifications";

describe("normalizeWhatsappNumber", () => {
  it("strips spaces, dashes, dots and brackets to E.164", () => {
    expect(normalizeWhatsappNumber("+49 151 2345 6789")).toEqual({ ok: true, value: "+4915123456789" });
    expect(normalizeWhatsappNumber(" +49 (151) 2345-67.89 ")).toEqual({ ok: true, value: "+4915123456789" });
  });

  it("accepts a leading 00 as +", () => {
    expect(normalizeWhatsappNumber("0049 151 23456789")).toEqual({ ok: true, value: "+4915123456789" });
  });

  it("treats empty as clearing the number", () => {
    expect(normalizeWhatsappNumber("   ")).toEqual({ ok: true, value: null });
  });

  it("refuses numbers without a country code or with letters", () => {
    expect(normalizeWhatsappNumber("0151 2345 6789").ok).toBe(false);
    expect(normalizeWhatsappNumber("+49 151 CALL ME").ok).toBe(false);
    expect(normalizeWhatsappNumber("+123").ok).toBe(false);
  });
});

describe("buildClientNotifications", () => {
  const seen = new Date("2026-10-02T12:00:00Z");
  const reports = [
    {
      id: "r1",
      period: "daily" as const,
      start: new Date("2026-10-01T22:00:00Z"),
      end: new Date("2026-10-02T22:00:00Z"),
      frozenAt: new Date("2026-10-02T22:05:00Z"),
    },
    {
      id: "r0",
      period: "weekly" as const,
      start: new Date("2026-09-20T22:00:00Z"),
      end: new Date("2026-09-27T22:00:00Z"),
      frozenAt: new Date("2026-09-27T22:05:00Z"),
    },
  ];
  const handoffs = [
    {
      id: "h1",
      status: "open",
      createdAt: new Date("2026-10-02T09:00:00Z"),
      questions: [{ text: "Can we offer weekend cleaning?" }],
    },
  ];

  it("merges report-ready and handoff items newest first with links", () => {
    const items = buildClientNotifications({ reports, handoffs, seenAt: seen, timeZone: "Europe/Berlin" });
    expect(items.map((i) => i.id)).toEqual(["report:r1", "handoff:h1", "report:r0"]);
    expect(items[0]).toMatchObject({
      kind: "report_ready",
      title: "Daily report ready",
      detail: "Fri 2 Oct",
      when: "3 Oct, 00:05",
      href: "/client/reports?period=daily&id=r1",
      unread: true,
    });
    expect(items[1]).toMatchObject({
      kind: "handoff_request",
      detail: "Can we offer weekend cleaning?",
      href: "/client/live",
      unread: false,
    });
  });

  it("marks everything unread when the bell was never opened", () => {
    const items = buildClientNotifications({ reports, handoffs, seenAt: null, timeZone: "UTC" });
    expect(items.every((i) => i.unread)).toBe(true);
  });

  it("caps the list", () => {
    const many = Array.from({ length: 30 }, (_, n) => ({
      ...reports[0],
      id: `r${n}`,
      frozenAt: new Date(Date.UTC(2026, 8, 1 + n)),
    }));
    expect(buildClientNotifications({ reports: many, handoffs: [], seenAt: null, timeZone: "UTC" })).toHaveLength(
      CLIENT_NOTIFICATION_LIMIT,
    );
  });

  it("titles each report period", () => {
    expect(reportReadyTitle("weekly")).toBe("Weekly report ready");
    expect(reportReadyTitle("monthly")).toBe("Monthly report ready");
  });
});
