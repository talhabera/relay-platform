import { describe, expect, it } from "vitest";
import {
  askHumanSchema,
  handoffAnswerSchema,
  handoffSettingsSchema,
  type HandoffSettingsInput,
} from "./validators";

const valid: HandoffSettingsInput = {
  mode: "quick_answer",
  triggers: {
    priceNotListed: true,
    asksForPerson: true,
    complaintOrRefund: false,
    lowConfidence: true,
  },
  recipientName: " Markus Albrecht ",
  recipientWhatsapp: "+49 151 2345-6789",
  expiryMinutes: 120,
  defaultReply: "agent",
  recipientCanTakeOver: false,
  waitingText: "",
  ifNobodyAnswers: "reply_here",
};

describe("handoffSettingsSchema", () => {
  it("normalises names, numbers and empty text", () => {
    const parsed = handoffSettingsSchema.parse(valid);
    expect(parsed.recipientName).toBe("Markus Albrecht");
    expect(parsed.recipientWhatsapp).toBe("+4915123456789");
    expect(parsed.waitingText).toBeNull();
  });

  it("allows no recipient (the Inbox is the fallback)", () => {
    const parsed = handoffSettingsSchema.parse({
      ...valid,
      recipientName: "",
      recipientWhatsapp: "",
    });
    expect(parsed.recipientWhatsapp).toBeNull();
  });

  it("rejects a non-E.164 number and an off-menu expiry", () => {
    expect(() =>
      handoffSettingsSchema.parse({ ...valid, recipientWhatsapp: "0151 234" }),
    ).toThrow();
    expect(() =>
      handoffSettingsSchema.parse({ ...valid, expiryMinutes: 45 as 30 }),
    ).toThrow();
  });
});

describe("handoffAnswerSchema", () => {
  it("requires text and a reply mode", () => {
    expect(() => handoffAnswerSchema.parse({ text: " ", replyMode: "person" })).toThrow();
    expect(handoffAnswerSchema.parse({ text: " 49 € ", replyMode: "agent" }).text).toBe(
      "49 €",
    );
  });
});

describe("askHumanSchema", () => {
  it("bounds confidence to 0-100", () => {
    const base = { reason: "r", question: "q", suggestedReplies: [] };
    expect(() => askHumanSchema.parse({ ...base, confidence: 101 })).toThrow();
    expect(askHumanSchema.parse({ ...base, confidence: null }).confidence).toBeNull();
  });
});
