import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { InboxHandoff } from "@/components/messaging/inbox-model";

import { ConversationBody } from "./conversation-body";
import { buildConversationView, type ConversationInput } from "./conversation-model";
import { answerNowError, OpenInInboxButton } from "./conversation-sheet";

const TZ = "Europe/Berlin";
const at = (hhmm: string) => new Date(`2026-09-25T${hhmm}:00.000Z`);

const request: InboxHandoff = {
  id: "h1",
  status: "open",
  mode: "quick_answer",
  reason: "price not listed",
  questions: [{ text: "Can we offer weekend cleaning for 1,200 m²?", askedAt: "2026-09-25T09:46:00.000Z" }],
  recipientName: "Markus Albrecht",
  recipientWhatsapp: "+49",
  createdAt: at("09:46"),
  notifiedAt: at("09:46"),
  expiresAt: at("11:46"),
  answeredAt: null,
  takenOverAt: null,
  expiredAt: null,
  handedBackAt: null,
  handBackReason: null,
};

function input(over: Partial<ConversationInput> = {}): ConversationInput {
  return {
    chatId: "chat-1",
    customer: "Lukas Brenner",
    source: "widget",
    agentName: "Acme Website Assistant",
    companyName: "Acme GmbH",
    messages: [
      { id: "m1", role: "user", author: null, authorDisplayName: null, content: "Do you offer weekend cleaning?", createdAt: at("09:43") },
      { id: "m2", role: "assistant", author: "agent", authorDisplayName: null, content: "A colleague will confirm.", createdAt: at("09:46") },
      { id: "m3", role: "user", author: null, authorDisplayName: null, content: "  ", createdAt: at("09:47") },
    ],
    requests: [request],
    chatCreatedAt: at("09:43"),
    timeZone: TZ,
    now: at("09:52"),
    readOnly: false,
    ...over,
  };
}

describe("buildConversationView", () => {
  it("shows the waiting banner for a client user", () => {
    const view = buildConversationView(input());
    expect(view.chip).toEqual({ tone: "needs-you", label: "Waiting for you" });
    expect(view.meta).toBe("Acme Website Assistant · Website widget");
    expect(view.started).toBe("Started 11:43");
    expect(view.banner).toMatchObject({
      title: "Waiting for your answer",
      question: "Can we offer weekend cleaning for 1,200 m²?",
      waited: "Customer waiting 6 min",
    });
    expect(view.inboxHref).toBe("/messaging?chatId=chat-1");
    const kinds = view.transcript.map((t) => t.kind);
    expect(kinds.filter((k) => k === "message")).toHaveLength(2);
    expect(kinds).toContain("event");
  });

  it("names the recipient in the read-only preview", () => {
    expect(buildConversationView(input({ readOnly: true })).banner?.title).toBe("Waiting for Markus Albrecht");
  });

  it("has no banner without an open request", () => {
    const view = buildConversationView(input({ requests: [{ ...request, status: "taken_over", takenOverAt: at("09:50") }] }));
    expect(view.banner).toBeNull();
    expect(view.chip.label).toBe("Taken over");
    const plain = buildConversationView(input({ requests: [] }));
    expect(plain.banner).toBeNull();
    expect(plain.chip.label).toBe("Open");
  });

  it("labels human replies with the person and company", () => {
    const view = buildConversationView(
      input({
        requests: [],
        messages: [
          { id: "m1", role: "assistant", author: "human", authorDisplayName: "Markus", content: "Yes", createdAt: at("09:50") },
        ],
      }),
    );
    expect(view.transcript[0]).toMatchObject({ kind: "message", role: "assistant", author: "Markus · Acme GmbH" });
  });
});

describe("ConversationBody", () => {
  it("renders Answer now slot, transcript and read-only footer", () => {
    const view = buildConversationView(input());
    const html = renderToStaticMarkup(
      h(ConversationBody, {
        view,
        action: h("button", { "data-slot": "live-answer-now" }, "Answer now"),
        actionNote: { text: view.banner!.waited, tone: "warning" },
      }),
    );
    expect(html).toContain("Waiting for your answer");
    expect(html).toContain("Answer now");
    expect(html).toContain("Customer waiting 6 min");
    expect(html).toContain("Do you offer weekend cleaning?");
    expect(html).toContain("Read-only. The agent keeps the chat going until you answer.");
  });

  it("preview: Open in Inbox replaces Answer now", () => {
    const view = buildConversationView(input({ readOnly: true }));
    const html = renderToStaticMarkup(
      h(ConversationBody, {
        view,
        action: h(OpenInInboxButton, { href: view.inboxHref }),
        actionNote: { text: "Preview · staff answer from the Inbox", tone: "muted" },
      }),
    );
    expect(html).toContain("Open in Inbox");
    expect(html).toContain('href="/messaging?chatId=chat-1"');
    expect(html).not.toContain("Answer now");
  });
});

describe("answerNowError", () => {
  it("explains a takeover conflict and rate limit", () => {
    expect(answerNowError(409)).toMatch(/already answering/);
    expect(answerNowError(429)).toMatch(/Too many/);
    expect(answerNowError(500)).toMatch(/Could not/);
  });
});
