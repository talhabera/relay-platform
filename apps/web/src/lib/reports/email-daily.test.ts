import { describe, expect, it } from "vitest";

import { fixtureData } from "@/lib/fixtures/data";
import type { ReportSnapshot } from "@/lib/fixtures/interfaces";

import { renderDailyReportEmail } from "./email-daily";

const daily = fixtureData.reportSnapshots.find((r) => r.id === "fx-report-d0924")!;
const base = {
  snapshot: daily,
  timeZone: "Europe/Berlin",
  companyName: "Acme GmbH",
  recipientName: "Markus Albrecht",
  reportUrl: "https://relay.example/client/reports?period=daily&id=fx-report-d0924",
};

describe("renderDailyReportEmail (Figma 11a reports/email-daily)", () => {
  it("builds the subject, greeting and headline cards from the snapshot", () => {
    const email = renderDailyReportEmail(base);
    expect(email.subject).toBe("Acme GmbH · Daily report · Thu 24 Sep");
    expect(email.html).toContain("Thursday 24 Sep 2026");
    expect(email.html).toContain(
      "Good morning, Markus. Your agents handled 19 conversations yesterday and delivered 2 qualified leads.",
    );
    for (const label of ["Conversations", "Inbound leads", "Qualified leads delivered", "Staff answers"]) {
      expect(email.html).toContain(label);
    }
    expect(email.html).toContain(`href="${base.reportUrl.replace(/&/g, "&amp;")}"`);
    expect(email.html).toContain("Open full report");
    expect(email.html).toContain("Opens the report in your client portal.");
    expect(email.html).toContain("You get this email because your agency sends Acme GmbH a daily report.");
    expect(email.text).toContain("Conversations: 19");
    expect(email.text).toContain(base.reportUrl);
  });

  it("hides sourceless cards and words the greeting from what is sourced", () => {
    const snapshot: ReportSnapshot = {
      ...daily,
      metrics: [{ metricKey: "conversations.started", value: 1, previous: null }],
    };
    const email = renderDailyReportEmail({ ...base, snapshot });
    expect(email.html).toContain("Your agents handled 1 conversation yesterday.");
    expect(email.html).not.toMatch(/Staff answers|Site visits|Qualified leads delivered/);
  });

  it("falls back to a plain line when nothing has a source", () => {
    const email = renderDailyReportEmail({ ...base, snapshot: { ...daily, metrics: [] }, recipientName: null });
    expect(email.html).toContain("Good morning. Your daily report for Acme GmbH is ready.");
  });

  it("escapes every interpolated value", () => {
    const email = renderDailyReportEmail({
      ...base,
      companyName: `<script>alert("x")</script> & Co`,
      recipientName: `<b>Eve</b>`,
      reportUrl: `javascript:alert(1)`,
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<b>Eve");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("&amp; Co");
    expect(email.html).not.toContain("javascript:");
  });

  it("links the opt-out when one is given", () => {
    const email = renderDailyReportEmail({ ...base, preferencesUrl: "https://relay.example/client/profile" });
    expect(email.html).toContain('href="https://relay.example/client/profile"');
    expect(email.text).toContain("https://relay.example/client/profile");
  });

  it("refuses a non-daily snapshot", () => {
    const weekly = fixtureData.reportSnapshots.find((r) => r.id === "fx-report-w0914")!;
    expect(() => renderDailyReportEmail({ ...base, snapshot: weekly })).toThrow(/daily/);
  });
});
