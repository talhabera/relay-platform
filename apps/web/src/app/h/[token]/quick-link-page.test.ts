import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FIXTURE_NOW, FIXTURE_TIME_ZONE, QUICK_LINK_FIXTURES } from "./fixtures";
import {
  HANDOFF_REQUEST_TEMPLATE_BODY,
  HANDOFF_REQUEST_TEMPLATE_BUTTON,
  HandoffNotificationPreview,
  handoffNotificationBody,
} from "./notification";
import { QuickLinkPage } from "./quick-link-page";
import {
  formatClock,
  headerLinkText,
  linkLifetimeText,
  mergeMessages,
  quickLinkScreen,
  waitingText,
  type QuickLinkPayload,
  type QuickLinkScreen,
} from "./screen";

const tz = FIXTURE_TIME_ZONE;
const render = (screen: QuickLinkScreen, size: "mobile" | "desktop" = "mobile", view?: QuickLinkPayload) =>
  renderToStaticMarkup(
    h(QuickLinkPage, {
      token: "fixture",
      initialView: view ?? QUICK_LINK_FIXTURES[screen],
      timeZone: tz,
      idleMinutes: 30,
      now: FIXTURE_NOW.toISOString(),
      offline: true,
      size,
    }),
  ).replaceAll("&#x27;", "'");

describe("quickLinkScreen", () => {
  it("maps every fixture to its own frame", () => {
    for (const [screen, view] of Object.entries(QUICK_LINK_FIXTURES)) {
      expect(quickLinkScreen(view)).toBe(screen);
    }
  });

  it("an open request past its deadline is expired, after Done it is closed", () => {
    const open = QUICK_LINK_FIXTURES.open;
    expect(quickLinkScreen({ ...open, link: { ...open.link, canAnswer: false, isExpired: true } })).toBe("expired");
    expect(quickLinkScreen({ ...open, link: { ...open.link, isClosed: true } })).toBe("closed");
  });

  it("answered and Done but still viewable stays on sent", () => {
    const sent = QUICK_LINK_FIXTURES.sent;
    expect(quickLinkScreen({ ...sent, link: { ...sent.link, isClosed: true, canView: true } })).toBe("sent");
  });
});

describe("copy helpers", () => {
  it("formats clocks in the company timezone", () => {
    expect(formatClock(QUICK_LINK_FIXTURES.open.request.expiresAt, tz)).toBe("13:46");
    expect(formatClock(QUICK_LINK_FIXTURES.open.request.expiresAt, "Not/AZone")).toBe("11:46");
    expect(formatClock(null, tz)).toBe("");
  });

  it("waiting chip and link lifetime", () => {
    const created = QUICK_LINK_FIXTURES.open.request.createdAt;
    expect(waitingText(created, FIXTURE_NOW)).toBe("Customer waiting 6 min");
    expect(waitingText(created, new Date(created))).toBe("Customer waiting");
    expect(linkLifetimeText(created, QUICK_LINK_FIXTURES.open.request.expiresAt)).toBe("2 h");
  });

  it("header lock line: desktop names the person, expired says when", () => {
    expect(headerLinkText(QUICK_LINK_FIXTURES.open, tz, "mobile")).toBe("Secure link · expires 13:46");
    expect(headerLinkText(QUICK_LINK_FIXTURES.open, tz, "desktop")).toBe("Secure link for Markus Albrecht · expires 13:46");
    expect(headerLinkText(QUICK_LINK_FIXTURES.expired, tz, "mobile")).toBe("Secure link · expired at 13:46");
  });

  it("merges streamed messages by id in time order", () => {
    const [a, b, c] = QUICK_LINK_FIXTURES.open.transcript!;
    expect(mergeMessages([a, c], [b, c]).map((m) => m.id)).toEqual([a.id, b.id, c.id]);
  });
});

describe("Quick-link page (Figma 11c 500:69277)", () => {
  it("open: card with suggested replies, transcript, composer and Take over chat", () => {
    const html = render("open");
    expect(html).toContain('data-screen="open"');
    expect(html).toContain('data-state="open"');
    expect(html).toContain("Customer waiting 6 min");
    expect(html).toContain("Ask for their floor plan first");
    expect(html).toContain("Conversation so far");
    expect(html).toContain("Great, thanks. I'll wait.");
    expect(html).toContain('placeholder="Write your answer…"');
    expect(html).toContain("Only you can use this link.");
    expect(html).toContain("Take over chat");
    expect(html).not.toContain('data-slot="send-as"');
  });

  it("open without takeover rights hides Take over chat", () => {
    const open = QUICK_LINK_FIXTURES.open;
    const html = render("open", "mobile", { ...open, link: { ...open.link, canTakeOver: false } });
    expect(html).not.toContain("Take over chat");
  });

  it("sent: banner, answered card, human label, Take over chat + Done", () => {
    const html = render("sent");
    expect(html).toContain('data-slot="sent-banner"');
    expect(html).toContain("Sent to the customer at 11:49");
    expect(html).toContain("They see your name: Markus Albrecht · Acme GmbH");
    expect(html).toContain("Answered by Markus Albrecht · 11:49");
    expect(html).toContain("Human answer · sent with your name");
    expect(html).toContain(">Done<");
    expect(html).toContain("Take over chat");
  });

  it("taken-over: live banner, Hand back, typing row, live composer", () => {
    const html = render("taken-over");
    expect(html).toContain('data-slot="live-banner"');
    expect(html).toContain("The agent is paused since 11:50");
    expect(html).toContain("With no message from you for 30 min");
    expect(html).toContain("Hand back to agent");
    expect(html).toContain("Customer is typing…");
    expect(html).toContain('placeholder="Write to the customer…"');
  });

  it("handed-back: agent banner and idle status line, no Take over again (API forbids it)", () => {
    const html = render("handed-back");
    expect(html).toContain("The agent is back in the chat");
    expect(html).toContain("the chat went back to the agent at 12:24");
    expect(html).toContain("Handed back to the agent automatically at 12:24");
    expect(html).not.toContain("Take over again");
  });

  it("expired: expired card, notice, no composer, no transcript", () => {
    const html = render("expired");
    expect(html).toContain('data-state="expired"');
    expect(html).toContain("Link expired at 13:46");
    expect(html).toContain("expire 2 h after sending");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("Conversation so far");
  });

  it("closed: Done pressed, link no longer shows the chat", () => {
    const html = render("closed");
    expect(html).toContain("You closed this link.");
    expect(html).not.toContain("<textarea");
  });

  it("desktop: two panes, header Take over chat, system line, answer head", () => {
    const html = render("open", "desktop");
    expect(html).toContain('data-size="desktop"');
    expect(html).toContain('aria-label="Conversation"');
    expect(html).toContain('aria-label="Your answer"');
    expect(html).toContain("Secure link for Markus Albrecht · expires 13:46");
    expect(html).toContain("11:46 · Handoff sent to Markus Albrecht");
    expect(html).toContain("talking to Acme Website Assistant · started 11:43");
    expect(html).toContain("The customer sees your name");
    expect(html).toContain("Only you can use this link. It expires at 13:46.");
  });
});

describe("Notification preview (11/handoff/notification)", () => {
  it("fills the worker's relay_handoff_request template", () => {
    const body = handoffNotificationBody({
      recipientName: "Markus Albrecht",
      companyName: "Acme GmbH",
      question: "Can we offer weekend cleaning?",
    });
    expect(body).toBe("Hi Markus Albrecht, a customer of Acme GmbH needs you: Can we offer weekend cleaning?");
    expect(handoffNotificationBody({ recipientName: null, companyName: "Acme GmbH", question: "Q" })).toBe(
      "Hi there, a customer of Acme GmbH needs you: Q",
    );
  });

  it("matches the template documented in worker handoff/staff-channel.ts", () => {
    const source = readFileSync(
      path.resolve(__dirname, "../../../../../../packages/worker/src/handoff/staff-channel.ts"),
      "utf8",
    ).replace(/\s*\n\s*\*\s*/g, " ");
    expect(source).toContain(`body "${HANDOFF_REQUEST_TEMPLATE_BODY}"`);
    expect(source).toContain(`URL button "${HANDOFF_REQUEST_TEMPLATE_BUTTON}"`);
    expect(source).toContain('GREETING_FALLBACK = "there"');
  });

  it("renders the WhatsApp chrome, body and Open button", () => {
    const html = renderToStaticMarkup(
      h(HandoffNotificationPreview, {
        recipientName: "Markus Albrecht",
        companyName: "Acme GmbH",
        question: "Can we offer weekend cleaning?",
        time: "11:46",
        href: "/h/abc",
      }),
    );
    expect(html).toContain("Business account");
    expect(html).toContain("Hi Markus Albrecht, a customer of Acme GmbH needs you: Can we offer weekend cleaning?");
    expect(html).toContain('href="/h/abc"');
    expect(html).toContain(">Open<");
  });
});
