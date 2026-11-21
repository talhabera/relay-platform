import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CLIENT_NAV_ITEMS,
  ClientHeader,
  HandoffHeader,
  HandoffRequestCard,
  LIVE_EVENT_KINDS,
  LiveEventRow,
  REPORT_TITLES,
  ReportHeader,
} from "./index";

const render = (el: ReactElement) => renderToStaticMarkup(el);
const classOf = (html: string, slot: string) => {
  const m = html.match(new RegExp(`data-slot="${slot}"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*data-slot="${slot}"`));
  return m ? (m[1] ?? m[2]).replaceAll("&amp;", "&") : "";
};
const count = (html: string, needle: string) => html.split(needle).length - 1;
const noop = () => {};

const company = { id: "c1", name: "Acme GmbH" };
const card = {
  question: "Can we offer weekend cleaning for 1,200 m², twice a week, from Mon 5 Oct?",
  reason: "Why you: weekend rates are not in the price list.",
  customer: "Lukas Brenner · Isar Data GmbH",
};
const replies = ["Yes, send the weekend rate and offer a site visit", "Ask for their floor plan first", "I'll call them today"];

// Figma 02 `453:6745` v2/client.
describe("Client header (454:61663)", () => {
  it("has exactly Reports and Live, no Inbox", () => {
    expect(CLIENT_NAV_ITEMS.map((i) => i.key)).toEqual(["reports", "live"]);
    const html = render(h(ClientHeader, { active: "reports", company }));
    expect(count(html, 'data-slot="nav-pill"')).toBe(2);
    expect(html).not.toContain("Inbox");
    expect(html).toContain('href="/client/reports"');
    expect(html).toContain('href="/client/live"');
  });

  it("active=reports vs active=live marks the matching pill", () => {
    const reports = render(h(ClientHeader, { active: "reports", company }));
    expect(reports).toMatch(/data-state="active"[^>]*href="\/client\/reports"|href="\/client\/reports"[^>]*data-state="active"/);
    expect(reports).toContain('data-icon="file-text"');
    const live = render(h(ClientHeader, { active: "live", company }));
    expect(live).toMatch(/data-state="active"[^>]*href="\/client\/live"|href="\/client\/live"[^>]*data-state="active"/);
    expect(live).toContain('data-icon="activity"');
    expect(count(live, 'aria-current="page"')).toBe(1);
  });

  it("shows a static single-company pill (no chevron) and the unread bell", () => {
    const html = render(h(ClientHeader, { active: "live", company, unread: true, userMenu: h("span", null, "MENU") }));
    expect(html).toContain('data-state-name="single"');
    expect(html).toContain("Acme GmbH");
    expect(html).toContain('data-slot="icon-button-dot"');
    expect(html).toContain("MENU");
    expect(classOf(html, "client-header")).toContain("h-18");
  });

  it("preview hrefs override tab targets", () => {
    const html = render(h(ClientHeader, { active: "live", company, hrefs: { live: "/preview/live" } }));
    expect(html).toContain('href="/preview/live"');
  });
});

describe("Report header (455:6915)", () => {
  it.each(["daily", "weekly", "monthly"] as const)("period=%s: fixed title and checked segment", (period) => {
    const html = render(h(ReportHeader, { period, range: "Thu 24 Sep 2026", delivery: "Emailed to Markus Albrecht · Fri 25 Sep, 08:00" }));
    expect(html).toContain(REPORT_TITLES[period]);
    expect(html).toContain("type-h1");
    expect(count(html, 'data-state="checked"')).toBe(1);
    expect(html).toMatch(new RegExp(`aria-checked="true"[^>]*value="${period}"|value="${period}"[^>]*aria-checked="true"`));
  });

  it("range stepper, delivery line and the three actions", () => {
    const html = render(h(ReportHeader, { period: "daily", range: "Thu 24 Sep 2026", delivery: "Emailed to Markus" }));
    expect(html).toContain('aria-label="Previous period"');
    expect(html).toContain('aria-label="Next period"');
    expect(html).toContain("Thu 24 Sep 2026");
    expect(html).toContain('data-icon="mail"');
    expect(html).toContain('href="/client/reports/archive"');
    expect(html).toContain("Download PDF");
    expect(html).toContain("Share link");
    expect(html).toContain('data-icon="archive"');
    expect(html).toContain('data-icon="share-2"');
  });

  it("null hides actions; missing delivery hides the mail line", () => {
    const html = render(h(ReportHeader, { period: "weekly", range: "Week 39", archiveHref: null, pdfHref: null, onShare: null }));
    expect(html).not.toContain("Archive");
    expect(html).not.toContain("Download PDF");
    expect(html).not.toContain("Share link");
    expect(html).not.toContain("report-header-delivery");
  });

  it("pdfHref renders a link", () => {
    const html = render(h(ReportHeader, { period: "monthly", range: "September 2026", pdfHref: "/r/1.pdf" }));
    expect(html).toContain('href="/r/1.pdf"');
  });
});

describe("Live event row (459:6970)", () => {
  it.each(Object.keys(LIVE_EVENT_KINDS) as (keyof typeof LIVE_EVENT_KINDS)[])("kind=%s: icon tile and default source", (kind) => {
    const html = render(h(LiveEventRow, { kind, time: "11:05", text: "Inbound lead qualified: Isar Data GmbH", detail: "Score 84" }));
    expect(html).toContain(`data-kind="${kind}"`);
    expect(html).toContain(`data-icon="${LIVE_EVENT_KINDS[kind].icon}"`);
    expect(html).toContain(`data-brand="${LIVE_EVENT_KINDS[kind].source}"`);
    expect(html).toContain("11:05");
    expect(html).toContain("type-mono");
  });

  it("handoff uses the needs-you tile, lead the primary-soft tile", () => {
    const handoff = render(h(LiveEventRow, { kind: "handoff", time: "11:00", text: "x" }));
    expect(classOf(handoff, "live-event-row-tile")).toContain("bg-status-needs-you");
    const lead = render(h(LiveEventRow, { kind: "lead", time: "11:00", text: "x" }));
    expect(classOf(lead, "live-event-row-tile")).toContain("bg-primary-soft");
  });

  it("source override and null source", () => {
    expect(render(h(LiveEventRow, { kind: "lead", time: "1", text: "x", source: "whatsapp" }))).toContain('data-brand="whatsapp"');
    expect(render(h(LiveEventRow, { kind: "lead", time: "1", text: "x", source: null }))).not.toContain("data-brand");
  });
});

describe("Handoff header (461:6951)", () => {
  it("mobile: initials tile, lock line, lg more button, no back by default", () => {
    const html = render(h(HandoffHeader, { company: "Acme GmbH", linkText: "Secure link · expires 13:46", onMore: noop }));
    expect(html).toContain('data-size="mobile"');
    expect(html).toContain(">AG<");
    expect(html).toContain('data-icon="lock"');
    expect(html).toContain("Secure link · expires 13:46");
    expect(html).toMatch(/data-size="lg"[^>]*aria-label="More"/);
    expect(html).not.toContain('aria-label="Back"');
    expect(html).not.toContain("Take over chat");
  });

  it("desktop: Take over chat, md back when requested", () => {
    const html = render(
      h(HandoffHeader, { size: "desktop", company: "Acme GmbH", linkText: "Secure link for Markus", onBack: noop, onTakeOver: noop, onMore: noop }),
    );
    expect(html).toContain("Take over chat");
    expect(html).toContain('data-icon="messages-square"');
    expect(html).toMatch(/data-size="md"[^>]*aria-label="Back"/);
    expect(html).not.toContain('aria-label="More"');
    expect(classOf(html, "handoff-header")).toContain("px-8");
  });
});

describe("Handoff request card (457:61810)", () => {
  it("open: needs-your-answer, waiting chip, primary border, sm reply chips", () => {
    const html = render(h(HandoffRequestCard, { ...card, state: "open", waitingText: "Customer waiting 6 min", suggestedReplies: replies, onReply: noop }));
    expect(html).toContain("Needs your answer");
    expect(html).toContain('data-tone="needs-you"');
    expect(html).toContain("Customer waiting 6 min");
    expect(classOf(html, "handoff-request-card")).toContain("border-primary");
    expect(count(html, 'data-slot="chip"')).toBe(3);
    expect(count(html, 'data-size="sm"')).toBe(3);
    expect(html).toContain(">LB<");
    expect(html).toContain('data-brand="website"');
  });

  it("open mobile: lg chips stacked full width", () => {
    const html = render(h(HandoffRequestCard, { ...card, state: "open", size: "mobile", suggestedReplies: replies }));
    expect(count(html, 'data-size="lg"')).toBe(3);
    expect(html).toContain("flex-col");
    expect(html).toContain("whitespace-normal");
  });

  it("answered: border-border, success chip, status line", () => {
    const html = render(h(HandoffRequestCard, { ...card, state: "answered", statusText: "Answered by Markus Albrecht · 11:49", suggestedReplies: replies }));
    expect(html).toContain("Customer question");
    expect(html).toContain('data-tone="success"');
    expect(classOf(html, "handoff-request-card")).toContain("border-border");
    expect(html).toContain("Answered by Markus Albrecht · 11:49");
    expect(html).toContain('data-icon="circle-check"');
    expect(html).not.toContain('data-slot="chip"');
  });

  it("expired: muted question, clock line, neutral chip", () => {
    const html = render(h(HandoffRequestCard, { ...card, state: "expired", statusText: "Link expired at 13:46" }));
    expect(html).toContain("Expired");
    expect(html).toContain('data-tone="neutral"');
    expect(classOf(html, "handoff-request-card-question")).toContain("text-muted-foreground");
    expect(html).toContain('data-icon="clock"');
  });

  it("taken-over: Live chip, hand back outline button sized by size", () => {
    const desktop = render(h(HandoffRequestCard, { ...card, state: "taken-over", onHandBack: noop }));
    expect(desktop).toContain('data-tone="live"');
    expect(desktop).toContain("You&#x27;re chatting live · the agent is paused");
    expect(desktop).toContain("Hand back to agent");
    expect(desktop).toMatch(/data-variant="outline"[^>]*data-size="md"|data-size="md"[^>]*data-variant="outline"/);
    const mobile = render(h(HandoffRequestCard, { ...card, state: "taken-over", size: "mobile", onHandBack: noop }));
    expect(mobile).toMatch(/data-variant="outline"[^>]*data-size="lg"|data-size="lg"[^>]*data-variant="outline"/);
  });

  it("handed-back: neutral chip, handedBackText, primary Take over again", () => {
    const html = render(
      h(HandoffRequestCard, { ...card, state: "handed-back", handedBackText: "Handed back to the agent automatically at 12:24", onTakeOverAgain: noop }),
    );
    expect(html).toContain("Handed back");
    expect(html).toContain("automatically at 12:24");
    expect(html).toContain("Take over again");
    expect(html).toContain('data-variant="default"');
    expect(classOf(html, "handoff-request-card")).toContain("border-primary");
  });
});
