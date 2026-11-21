import { describe, expect, it } from "vitest";
import type { HandoffRequest } from "@/lib/handoff/requests";
import { publicRequest, quickLinkActionSchema, quickLinkState } from "./quick-link";

const NOW = new Date("2026-10-03T12:00:00Z");

function request(overrides: Partial<HandoffRequest> = {}): HandoffRequest {
  return {
    id: "req-1",
    companyId: "company-1",
    agentId: "agent-1",
    chatId: "chat-1",
    status: "open",
    mode: "quick_answer",
    tokenHash: "secret-hash",
    reason: "Price is not in the price list",
    confidence: 40,
    questions: [{ text: "How much is the XL?", askedAt: NOW.toISOString() }],
    suggestedReplies: ["49 €"],
    recipientName: "Markus Albrecht",
    recipientWhatsapp: "+4915123456789",
    canTakeOver: true,
    notifiedAt: NOW,
    notificationMessageId: null,
    notificationStatus: null,
    notificationStatusAt: null,
    notificationError: null,
    expiresAt: new Date("2026-10-03T14:00:00Z"),
    answer: null,
    replyMode: null,
    answeredAt: null,
    takenOverAt: null,
    lastHumanMessageAt: null,
    handedBackAt: null,
    handBackReason: null,
    expiredAt: null,
    linkClosedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("quickLinkState", () => {
  it("answers and takes over a fresh link", () => {
    expect(quickLinkState(request(), NOW)).toMatchObject({
      canAnswer: true,
      canTakeOver: true,
      canWriteAsPerson: false,
      canHandBack: false,
      isExpired: false,
      isClosed: false,
      canView: true,
    });
  });

  it("is single-answer: after the answer only a takeover is left", () => {
    const state = quickLinkState(request({ status: "answered", answeredAt: NOW }), NOW);
    expect(state).toMatchObject({ canAnswer: false, canTakeOver: true, canView: true });
  });

  it("does nothing and shows nothing after the deadline", () => {
    const later = new Date("2026-10-03T14:00:01Z");
    expect(quickLinkState(request(), later)).toMatchObject({
      canAnswer: false,
      canTakeOver: false,
      isExpired: true,
      canView: false,
    });
  });

  it("does nothing after Done", () => {
    expect(quickLinkState(request({ linkClosedAt: NOW }), NOW)).toMatchObject({
      canAnswer: false,
      canTakeOver: false,
      isClosed: true,
      canView: false,
    });
  });

  it("keeps a takeover writable past the deadline until hand-back", () => {
    const later = new Date("2026-10-03T15:00:00Z");
    const takenOver = request({ status: "taken_over", takenOverAt: NOW });
    expect(quickLinkState(takenOver, later)).toMatchObject({
      canWriteAsPerson: true,
      canHandBack: true,
      canView: true,
    });
    const handedBack = request({ status: "handed_back", handedBackAt: NOW });
    expect(quickLinkState(handedBack, later)).toMatchObject({
      canWriteAsPerson: false,
      canHandBack: false,
      canView: false,
    });
  });
});

describe("publicRequest", () => {
  it("never exposes the recipient's number or the token hash", () => {
    const shown = publicRequest(request());
    expect(JSON.stringify(shown)).not.toContain("secret-hash");
    expect(JSON.stringify(shown)).not.toContain("+4915123456789");
    expect(shown).toMatchObject({ reason: "Price is not in the price list", suggestedReplies: ["49 €"] });
  });
});

describe("quickLinkActionSchema", () => {
  it("accepts each action and rejects junk", () => {
    expect(quickLinkActionSchema.safeParse({ action: "answer", text: "49 €", replyMode: "agent" }).success).toBe(true);
    expect(quickLinkActionSchema.safeParse({ action: "answer", text: " ", replyMode: "agent" }).success).toBe(false);
    expect(quickLinkActionSchema.safeParse({ action: "answer", text: "x", replyMode: "bot" }).success).toBe(false);
    expect(quickLinkActionSchema.safeParse({ action: "delete" }).success).toBe(false);
    expect(quickLinkActionSchema.safeParse({ action: "typing" }).success).toBe(true);
  });
});
