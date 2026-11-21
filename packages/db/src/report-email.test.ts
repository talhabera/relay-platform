import { describe, expect, it } from "vitest";
import { encodeMailSubject, renderDailyReportEmail, summarizeReportEmail } from "./report-email";

function decode(header: string): string {
  return header
    .split(" ")
    .map((word) => {
      const m = /^=\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=$/.exec(word);
      expect(m, `not an encoded-word: ${word}`).not.toBeNull();
      return Buffer.from(m![1], "base64").toString("utf8");
    })
    .join("");
}

describe("encodeMailSubject", () => {
  it("passes printable ASCII through", () => {
    expect(encodeMailSubject("Acme - Daily report")).toBe("Acme - Daily report");
  });

  it("strips CR/LF so a company name cannot inject headers", () => {
    const out = encodeMailSubject("Acme\r\nBcc: evil@example.com\n");
    expect(out).not.toMatch(/[\r\n]/);
    expect(out).toBe("Acme Bcc: evil@example.com");
  });

  it("RFC 2047-encodes non-ASCII as UTF-8 encoded-words of at most 75 chars", () => {
    const subject = "Müller & Söhne GmbH · Daily report · Thu 24 Sep — çğışöü 日本語 ".repeat(2).trim();
    const out = encodeMailSubject(subject);
    for (const word of out.split(" ")) expect(word.length).toBeLessThanOrEqual(75);
    expect(decode(out)).toBe(subject);
  });

  it("never splits a multi-byte character across words", () => {
    const subject = "·".repeat(60);
    expect(decode(encodeMailSubject(subject))).toBe(subject);
  });

  it("caps very long subjects", () => {
    expect(encodeMailSubject("a".repeat(500))).toHaveLength(200);
  });
});

describe("renderDailyReportEmail (shared)", () => {
  it("renders from a db-shaped snapshot", () => {
    const email = renderDailyReportEmail({
      snapshot: {
        period: "daily",
        start: new Date("2026-09-23T22:00:00Z"),
        end: new Date("2026-09-24T22:00:00Z"),
        metrics: [{ metricKey: "leads.qualified_delivered", value: 3 }],
      },
      timeZone: "Europe/Berlin",
      companyName: "Acme",
      recipientName: "Acme",
      reportUrl: "https://relay.example/client/reports?period=daily&id=x",
    });
    expect(email.subject).toBe("Acme · Daily report · Thu 24 Sep");
    expect(email.text).toContain("Good morning, Acme. Your agents delivered 3 qualified leads yesterday.");
    expect(email.text).toContain("Qualified leads delivered: 3");
  });
});

describe("summarizeReportEmail", () => {
  const at = new Date("2026-09-25T06:00:00Z");
  it("is null when the report was never emailed", () => {
    expect(summarizeReportEmail([])).toBeNull();
  });

  it("reports Emailed with the sent-to list", () => {
    expect(
      summarizeReportEmail([
        { email: "b@x.com", status: "sent", sentAt: at },
        { email: "a@x.com", status: "sent", sentAt: at },
        { email: "c@x.com", status: "failed", sentAt: null },
      ]),
    ).toEqual({ status: "emailed", sentTo: ["a@x.com", "b@x.com"], sentAt: at });
  });

  it("reports Delivered once any recipient is delivered", () => {
    expect(summarizeReportEmail([{ email: "a@x.com", status: "delivered", sentAt: at }])?.status).toBe(
      "delivered",
    );
  });

  it("reports failed when nothing went out", () => {
    expect(summarizeReportEmail([{ email: "a@x.com", status: "failed", sentAt: null }])).toEqual({
      status: "failed",
      sentTo: [],
      sentAt: null,
    });
  });
});
