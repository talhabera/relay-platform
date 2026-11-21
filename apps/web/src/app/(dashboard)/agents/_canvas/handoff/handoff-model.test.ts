import { describe, expect, it } from "vitest";

import { handoffSettingsSchema } from "@/lib/handoff/validators";

import {
  confirmationToast,
  expiryLabel,
  handedBackNotice,
  handoffFormDirty,
  handoffFormFromSettings,
  handoffInputFromForm,
  handoffModeOptions,
  handoffNodeView,
  inboxFallbackHint,
  maskWhatsapp,
  toExpiryMinutes,
  type HandoffSettingsView,
} from "./handoff-model";

const SETTINGS: HandoffSettingsView = {
  mode: "quick_answer",
  triggers: { priceNotListed: true, asksForPerson: true, complaintOrRefund: true, lowConfidence: false },
  recipientName: "Markus Albrecht",
  recipientWhatsapp: "+4915112342847",
  recipientConfirmed: true,
  expiryMinutes: 120,
  defaultReply: "agent",
  recipientCanTakeOver: true,
  waitingText: "A colleague will confirm the weekend rate in a few minutes.",
  ifNobodyAnswers: "reply_here",
};

describe("labels", () => {
  it("formats the expiry choices", () => {
    expect([30, 60, 120, 240].map(expiryLabel)).toEqual(["30 min", "1 h", "2 h", "4 h"]);
  });

  it("reads an off-menu expiry as the 2 h default", () => {
    expect(toExpiryMinutes(60)).toBe(60);
    expect(toExpiryMinutes(45)).toBe(120);
  });

  it("masks the recipient number like the design", () => {
    expect(maskWhatsapp("+4915112342847")).toBe("+49 151 •••• 2847");
    expect(maskWhatsapp("+49 151 •••• 2847")).toBe("+49 151 •••• 2847");
  });
});

describe("handoffNodeView", () => {
  it("Quick answer: confirmed recipient on WhatsApp, Inbox fallback", () => {
    expect(handoffNodeView({ settings: SETTINGS, group: null })).toEqual({
      title: "Human handoff",
      expiry: "Link expires after 2 h",
      who: { kind: "person", name: "Markus Albrecht" },
      fallback: "Fallback: Inbox, if there is no answer in 2 h",
    });
  });

  it("Takeover adds the mode to the title", () => {
    expect(handoffNodeView({ settings: { ...SETTINGS, mode: "takeover" }, group: null }).title).toBe(
      "Human handoff · Takeover",
    );
  });

  it("Recipient not confirmed: requests go to the Inbox until they confirm", () => {
    const view = handoffNodeView({ settings: { ...SETTINGS, recipientConfirmed: false }, group: null });
    expect(view.who).toEqual({ kind: "warning", label: "Recipient not confirmed", name: "Markus Albrecht" });
    expect(view.fallback).toBe("Requests go to the Inbox until Markus confirms");
  });

  it("No recipient: everything goes to the Inbox", () => {
    const view = handoffNodeView({
      settings: { ...SETTINGS, recipientName: null, recipientWhatsapp: null, recipientConfirmed: false },
      group: null,
    });
    expect(view.who).toEqual({ kind: "warning", label: "No recipient yet" });
  });

  it("Team chat: the group, with the question expiry", () => {
    const view = handoffNodeView({
      settings: { ...SETTINGS, mode: "team_chat", recipientConfirmed: false },
      group: { status: "active", subject: "Acme handoff team", inviteLink: "https://chat.whatsapp.com/K9" },
    });
    expect(view).toEqual({
      title: "Human handoff · Team chat",
      expiry: "Expires after 2 h",
      who: { kind: "group", label: "Acme handoff team" },
      fallback: "Fallback: Inbox, if there is no answer in 2 h",
    });
  });

  it("Team chat without a ready group warns", () => {
    expect(handoffNodeView({ settings: { ...SETTINGS, mode: "team_chat" }, group: null }).who).toEqual({
      kind: "warning",
      label: "Group not set up",
    });
    expect(
      handoffNodeView({
        settings: { ...SETTINGS, mode: "team_chat" },
        group: { status: "pending", subject: "Acme handoff", inviteLink: null },
      }).who,
    ).toEqual({ kind: "warning", label: "Group is being created" });
  });
});

describe("handoffModeOptions", () => {
  it("disables Team chat without an Official Business Account", () => {
    const options = handoffModeOptions("Markus Albrecht", "needs_oba");
    expect(options.map((o) => [o.value, o.disabled])).toEqual([
      ["quick_answer", false],
      ["takeover", false],
      ["team_chat", true],
    ]);
    expect(options[0].description).toBe("Markus answers once through a quick link. The agent carries on.");
    expect(options[2].description).toBe("Needs an Official Business Account");
  });

  it("keeps Team chat enabled while availability is unknown or confirmed", () => {
    expect(handoffModeOptions(null, "unknown")[2].disabled).toBe(false);
    expect(handoffModeOptions(null, "available")[2].disabled).toBe(false);
  });
});

describe("inboxFallbackHint", () => {
  it("reads until the recipient confirms, else the expiry", () => {
    expect(inboxFallbackHint(SETTINGS)).toBe("if there is no answer in 2 h");
    expect(inboxFallbackHint({ ...SETTINGS, recipientConfirmed: false })).toBe("until Markus confirms");
  });
});

describe("handedBackNotice", () => {
  const latest = { status: "handed_back" as const, recipientName: "Markus Albrecht", handedBackAt: new Date(), handBackReason: "manual" as const };

  it("names who handed back, or the idle timeout", () => {
    expect(handedBackNotice(latest)).toMatch(/^Markus handed the chat back to the agent\./);
    expect(handedBackNotice({ ...latest, handBackReason: "idle" })).toMatch(
      /^Handed back to the agent after 30 min with no message\./,
    );
  });

  it("shows nothing for any other state", () => {
    expect(handedBackNotice(null)).toBeNull();
    expect(handedBackNotice({ ...latest, status: "taken_over" })).toBeNull();
  });
});

describe("form round trip", () => {
  it("parses back to the saved settings and tracks changes", () => {
    const form = handoffFormFromSettings(SETTINGS);
    expect(handoffFormDirty(SETTINGS, form)).toBe(false);
    const parsed = handoffSettingsSchema.parse(handoffInputFromForm(form));
    expect(parsed.recipientWhatsapp).toBe("+4915112342847");
    expect(parsed.waitingText).toBe(SETTINGS.waitingText);
    expect(handoffFormDirty(SETTINGS, { ...form, expiryMinutes: 60 })).toBe(true);
  });

  it("clears empty text fields to null", () => {
    const form = { ...handoffFormFromSettings(SETTINGS), recipientName: " ", waitingText: "" };
    const parsed = handoffSettingsSchema.parse(handoffInputFromForm(form));
    expect(parsed.recipientName).toBeNull();
    expect(parsed.waitingText).toBeNull();
  });
});

describe("confirmationToast", () => {
  it("reports the confirmation send", () => {
    expect(confirmationToast(null, "Markus")).toBeNull();
    expect(confirmationToast("sent", "Markus Albrecht")).toEqual({
      tone: "success",
      text: "Confirmation sent to Markus on WhatsApp",
    });
    expect(confirmationToast("failed", "Markus Albrecht")?.tone).toBe("error");
  });
});
