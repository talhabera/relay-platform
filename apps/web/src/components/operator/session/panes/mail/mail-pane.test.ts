import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

import { SessionSteerProvider } from "@/components/operator/session-steer";

import { hasMailPane } from "./load-mail-pane";
import { MAIL_FIXTURE_NOW, mailSequenceFixture } from "./mail-fixtures";
import { MailPane, type MailPaneProps } from "./mail-pane";

const base: MailPaneProps = {
  gmailConnected: true,
  sequence: mailSequenceFixture,
  now: MAIL_FIXTURE_NOW.toISOString(),
  canAct: true,
};

const steered = (el: ReactElement) =>
  renderToStaticMarkup(h(SessionSteerProvider, { value: { send: () => {}, isStreaming: false } }, el));

describe("MailPane", () => {
  it("shows the Connect state until Gmail is connected", () => {
    const html = renderToStaticMarkup(h(MailPane, { ...base, gmailConnected: false }));
    expect(html).toContain('data-state="connect"');
    expect(html).toContain("Connect Gmail");
    expect(html).toContain('href="/settings/connectors"');
    expect(html).not.toContain('data-slot="email-step-card"');
  });

  it("shows an empty state when Gmail is connected but nothing is drafted", () => {
    const html = renderToStaticMarkup(h(MailPane, { ...base, sequence: null }));
    expect(html).toContain('data-state="empty"');
    expect(html).toContain("No sequence yet");
  });

  it("renders the 05 session-mail/default frame: step 1 open, 2 and 3 collapsed, Add step", () => {
    const html = steered(h(MailPane, base));
    expect(html).toContain('data-state="sequence"');
    expect(html).toContain(">Email sequence<");
    expect(html).toContain("3 steps · 44 leads · edited 2 min ago");
    expect(html.match(/data-slot="email-step-card"/g)).toHaveLength(3);
    expect(html.match(/data-state="expanded"/g)).toHaveLength(1);
    expect(html).toContain("Quick question about your office, Julia");
    expect(html).toContain("I saw that Brandt Logistik GmbH is opening a new office in Garching.");
    expect(html).not.toContain("{{");
    expect(html).toContain(">Follow-up<");
    expect(html).toContain(">Last note<");
    expect(html).toContain(">Day 9<");
    expect(html).toContain("All values rendered");
    expect(html).toContain("Templates");
    expect(html).toContain("Add step");
  });

  it("hides steering actions for viewers who cannot steer", () => {
    const html = steered(h(MailPane, { ...base, canAct: false }));
    expect(html).not.toContain("Templates");
    expect(html).not.toContain("Add step");
    expect(html).toContain("Variables");
  });
});

describe("hasMailPane", () => {
  it("matches only the Lead engine's Mail Marketer", () => {
    expect(hasMailPane({ packageSlug: "lead-engine", name: "Mail Marketer" })).toBe(true);
    expect(hasMailPane({ packageSlug: "lead-engine", name: "Lead Qualifier" })).toBe(false);
    expect(hasMailPane({ packageSlug: null, name: "Mail Marketer" })).toBe(false);
    expect(hasMailPane(null)).toBe(false);
  });
});
