import { describe, expect, it } from "vitest";
import {
  buildHandoffPromptSection,
  defaultWaitingText,
  enabledHandoffTriggers,
  HANDOFF_TRIGGER_RULES,
} from "./prompt";
import { defaultHandoffSettings, type HandoffRequestRow } from "./store";

const AGENT = { id: "agent-1", companyId: "company-1" };
const SETTINGS = defaultHandoffSettings(AGENT);

function request(overrides: Partial<HandoffRequestRow>): HandoffRequestRow {
  const now = new Date("2026-10-03T10:00:00Z");
  return {
    id: "req-1",
    companyId: "company-1",
    agentId: "agent-1",
    chatId: "chat-1",
    status: "open",
    mode: "quick_answer",
    tokenHash: "hash",
    reason: "Price not listed",
    confidence: 40,
    questions: [{ text: "Can you do 140 m2 for 300k?", askedAt: now.toISOString() }],
    suggestedReplies: [],
    recipientName: "Markus",
    recipientWhatsapp: "+491701234567",
    canTakeOver: false,
    notifiedAt: null,
    notificationMessageId: null,
    notificationStatus: null,
    notificationStatusAt: null,
    notificationError: null,
    expiresAt: now,
    answer: null,
    replyMode: null,
    answeredAt: null,
    takenOverAt: null,
    lastHumanMessageAt: null,
    handedBackAt: null,
    handBackReason: null,
    expiredAt: null,
    linkClosedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("enabledHandoffTriggers", () => {
  it("lists only the toggles that are on", () => {
    expect(
      enabledHandoffTriggers({ ...SETTINGS, triggerAsksForPerson: false }),
    ).toEqual(["price_not_listed", "complaint_or_refund", "low_confidence"]);
  });
});

describe("buildHandoffPromptSection", () => {
  it("writes every enabled trigger and the fixed 60% threshold", () => {
    const section = buildHandoffPromptSection(
      { settings: SETTINGS, latest: null, takeoverMessages: [] },
      "Acme",
    );

    for (const rule of Object.values(HANDOFF_TRIGGER_RULES)) {
      expect(section).toContain(rule);
    }
    expect(section).toContain("less than 60% confident");
    expect(section).toContain("ask_human");
  });

  it("leaves a disabled trigger out", () => {
    const section = buildHandoffPromptSection(
      {
        settings: { ...SETTINGS, triggerComplaintOrRefund: false },
        latest: null,
        takeoverMessages: [],
      },
      "Acme",
    );
    expect(section).not.toContain(HANDOFF_TRIGGER_RULES.complaint_or_refund);
  });

  it("is empty with every trigger off and no request", () => {
    const section = buildHandoffPromptSection(
      {
        settings: {
          ...SETTINGS,
          triggerPriceNotListed: false,
          triggerAsksForPerson: false,
          triggerComplaintOrRefund: false,
          triggerLowConfidence: false,
        },
        latest: null,
        takeoverMessages: [],
      },
      "Acme",
    );
    expect(section).toBe("");
  });

  it("uses the agent's waiting text, or the default copy", () => {
    const custom = buildHandoffPromptSection(
      { settings: { ...SETTINGS, waitingText: "One moment please." }, latest: null, takeoverMessages: [] },
      "Acme",
    );
    expect(custom).toContain("One moment please.");

    const fallback = buildHandoffPromptSection(
      { settings: SETTINGS, latest: null, takeoverMessages: [] },
      "Acme",
    );
    expect(fallback).toContain(defaultWaitingText("Acme"));
  });

  it("keeps the agent talking without guessing while a request is open", () => {
    const section = buildHandoffPromptSection(
      {
        settings: SETTINGS,
        latest: request({
          questions: [
            { text: "Price for 140 m2?", askedAt: "" },
            { text: "Also asked: delivery in May?", askedAt: "" },
          ],
        }),
        takeoverMessages: [],
      },
      "Acme",
    );
    expect(section).toContain("Price for 140 m2?");
    expect(section).toContain("delivery in May?");
    expect(section).toContain("Do not guess");
    expect(section).toContain("Keep answering anything else");
  });

  it("gives an agent-phrased answer as a fact", () => {
    const section = buildHandoffPromptSection(
      {
        settings: SETTINGS,
        latest: request({ status: "answered", replyMode: "agent", answer: "Yes, 300k works." }),
        takeoverMessages: [],
      },
      "Acme",
    );
    expect(section).toContain("Yes, 300k works.");
  });

  it("does not repeat an answer the person sent verbatim", () => {
    const section = buildHandoffPromptSection(
      {
        settings: SETTINGS,
        latest: request({ status: "answered", replyMode: "person", answer: "Yes, 300k works." }),
        takeoverMessages: [],
      },
      "Acme",
    );
    expect(section).not.toContain("Yes, 300k works.");
  });

  it("resumes after hand-back with what the person wrote", () => {
    const section = buildHandoffPromptSection(
      {
        settings: SETTINGS,
        latest: request({ status: "handed_back" }),
        takeoverMessages: [
          { content: "We can deliver on Friday.", authorDisplayName: "Markus Albrecht" },
        ],
      },
      "Acme",
    );
    expect(section).toContain("Markus Albrecht: We can deliver on Friday.");
    expect(section).toContain("handed it back");
  });
});
