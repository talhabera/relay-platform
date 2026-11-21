import { describe, expect, it, vi } from "vitest";
import {
  deliverDueReportEmails,
  reportEmailConfigFromEnv,
  sendReportEmail,
  type DueReportEmail,
  type OutgoingReportEmail,
  type ReportEmailDeps,
  type ReportEmailRecipient,
} from "./email";

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return { ...actual, db: {} };
});

const mail = { host: "smtp.purelymail.com", port: 465, secure: true, user: "relay@relay.example", pass: "pw", from: "Relay <relay@relay.example>" };
const config = { mail, from: "Relay <reports@relay.example>", appUrl: "https://relay.example" };
const now = new Date("2026-09-25T08:30:00Z");

const report: DueReportEmail = {
  snapshotId: "snap-1",
  companyId: "c1",
  companyName: "Müller GmbH",
  timezone: "Europe/Berlin",
  start: new Date("2026-09-23T22:00:00Z"),
  end: new Date("2026-09-24T22:00:00Z"),
  frozenAt: new Date("2026-09-24T22:01:00Z"),
  metrics: [
    { metricKey: "conversations.started", value: 19 },
    { metricKey: "leads.qualified_delivered", value: 2 },
  ],
};

const markus: ReportEmailRecipient = { userId: "u1", email: "markus@acme.example", name: "Markus Albrecht" };
const eve: ReportEmailRecipient = { userId: "u2", email: "eve@acme.example", name: null };

function makeDeps(overrides: Partial<ReportEmailDeps> = {}) {
  const completed: { id: string; status: string; error: string | null; providerMessageId: string | null }[] = [];
  const sent: OutgoingReportEmail[] = [];
  const deps: ReportEmailDeps = {
    listDue: vi.fn(async () => [report]),
    listRecipients: vi.fn(async () => [markus, eve]),
    claim: vi.fn<ReportEmailDeps["claim"]>(async (_r, recipients) => recipients.map((recipient, i) => ({ id: `d${i}`, recipient }))),
    complete: vi.fn<ReportEmailDeps["complete"]>(async (id, result) => {
      completed.push({ id, ...result });
    }),
    send: vi.fn<ReportEmailDeps["send"]>(async (message) => {
      sent.push(message);
      return { id: `resend-${sent.length}` };
    }),
    ...overrides,
  };
  return { deps, completed, sent };
}

describe("deliverDueReportEmails", () => {
  it("mails every claimed client user the daily report with the link and an encoded subject", async () => {
    const { deps, completed, sent } = makeDeps();
    expect(await deliverDueReportEmails(now, config, deps)).toEqual({ sent: 2, failed: 0 });

    expect(deps.listRecipients).toHaveBeenCalledWith("c1", report.frozenAt);
    expect(sent.map((m) => m.to)).toEqual(["markus@acme.example", "eve@acme.example"]);
    const [first] = sent;
    expect(first.from).toBe(config.from);
    expect(first.subject).toMatch(/^=\?UTF-8\?B\?/);
    expect(first.subject).not.toMatch(/[\r\n]/);
    expect(first.text).toContain("Good morning, Markus. Your agents handled 19 conversations yesterday");
    expect(first.text).toContain("Conversations: 19");
    expect(first.text).toContain("https://relay.example/client/reports?period=daily&id=snap-1");
    expect(first.text).toContain("https://relay.example/client/profile/notifications");
    expect(first.unsubscribeUrl).toBe("https://relay.example/client/profile/notifications");
    expect(completed).toEqual([
      { id: "d0", status: "sent", providerMessageId: "resend-1", error: null, sentAt: expect.any(Date) },
      { id: "d1", status: "sent", providerMessageId: "resend-2", error: null, sentAt: expect.any(Date) },
    ]);
  });

  it("only sends to recipients it claimed (no double send after a restart)", async () => {
    const { deps, sent } = makeDeps({ claim: vi.fn(async () => [{ id: "d1", recipient: eve }]) });
    await deliverDueReportEmails(now, config, deps);
    expect(sent.map((m) => m.to)).toEqual(["eve@acme.example"]);
  });

  it("records a failed send and keeps going", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps, completed } = makeDeps({
      send: vi.fn(async (m: OutgoingReportEmail) => {
        if (m.to === markus.email) throw new Error("550 mailbox unavailable");
        return { id: "ok" };
      }),
    });
    expect(await deliverDueReportEmails(now, config, deps)).toEqual({ sent: 1, failed: 1 });
    expect(completed[0]).toMatchObject({ id: "d0", status: "failed", error: "550 mailbox unavailable" });
    expect(completed[1]).toMatchObject({ id: "d1", status: "sent" });
    error.mockRestore();
  });

  it("claims nothing when every client user opted out", async () => {
    const { deps } = makeDeps({ listRecipients: vi.fn(async () => []) });
    await deliverDueReportEmails(now, config, deps);
    expect(deps.claim).not.toHaveBeenCalled();
  });

  it("is off without config", async () => {
    const { deps } = makeDeps();
    expect(await deliverDueReportEmails(now, null, deps)).toEqual({ sent: 0, failed: 0 });
    expect(deps.listDue).not.toHaveBeenCalled();
  });
});

describe("reportEmailConfigFromEnv", () => {
  it("needs SMTP credentials and an http(s) app URL", () => {
    const smtp = { SMTP_USER: "relay@example.com", SMTP_PASS: "pw" };
    expect(reportEmailConfigFromEnv({ NEXT_PUBLIC_APP_URL: "https://x" })).toBeNull();
    expect(reportEmailConfigFromEnv(smtp)).toBeNull();
    expect(reportEmailConfigFromEnv({ ...smtp, NEXT_PUBLIC_APP_URL: "https://app.example/" })).toEqual({
      mail: {
        host: "smtp.purelymail.com",
        port: 465,
        secure: true,
        user: "relay@example.com",
        pass: "pw",
        from: "Relay <relay@example.com>",
      },
      from: "Relay <relay@example.com>",
      appUrl: "https://app.example",
    });
    const custom = reportEmailConfigFromEnv({
      ...smtp,
      SMTP_PORT: "587",
      APP_URL: "https://a.example",
      NEXT_PUBLIC_APP_URL: "https://b.example",
      REPORT_EMAIL_FROM: "Reports <r@a.example>",
    });
    expect(custom).toMatchObject({ from: "Reports <r@a.example>", appUrl: "https://a.example" });
    expect(custom?.mail).toMatchObject({ port: 587, secure: false });
  });
});

describe("sendReportEmail", () => {
  const message: OutgoingReportEmail = {
    from: config.from,
    to: "markus@acme.example",
    subject: "Acme - Daily report",
    html: "<p>hi</p>",
    text: "hi",
    unsubscribeUrl: "https://relay.example/client/profile/notifications",
  };

  it("sends over SMTP with List-Unsubscribe", async () => {
    const transport = { sendMail: vi.fn(async () => ({ messageId: "<m1@purelymail>" })) };
    expect(await sendReportEmail(mail, message, transport)).toEqual({ id: "<m1@purelymail>" });
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: message.from,
      to: "markus@acme.example",
      subject: message.subject,
      html: "<p>hi</p>",
      text: "hi",
      replyTo: undefined,
      headers: { "List-Unsubscribe": "<https://relay.example/client/profile/notifications>" },
    });
  });

  it("throws when the SMTP send fails", async () => {
    const transport = { sendMail: vi.fn(async () => Promise.reject(new Error("535 auth failed"))) };
    await expect(sendReportEmail(mail, message, transport)).rejects.toThrow("535 auth failed");
  });
});
