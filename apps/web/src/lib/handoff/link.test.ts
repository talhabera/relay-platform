import { describe, expect, it } from "vitest";
import { handoffLinkState, type HandoffLinkRow } from "./link";

const NOW = new Date("2026-10-02T12:00:00Z");
const LATER = new Date("2026-10-02T13:00:00Z");
const EARLIER = new Date("2026-10-02T11:00:00Z");

const row = (over: Partial<HandoffLinkRow> = {}): HandoffLinkRow => ({
  status: "open",
  expiresAt: LATER,
  linkClosedAt: null,
  canTakeOver: true,
  ...over,
});

describe("handoffLinkState", () => {
  it("answers and takes over while open and before expiry", () => {
    expect(handoffLinkState(row(), NOW)).toMatchObject({
      canAnswer: true,
      canTakeOver: true,
      canWriteAsPerson: false,
      isExpired: false,
    });
  });

  it("is single-answer: an answered link can only take over", () => {
    expect(handoffLinkState(row({ status: "answered" }), NOW)).toMatchObject({
      canAnswer: false,
      canTakeOver: true,
    });
  });

  it("never takes over when the request does not allow it", () => {
    expect(handoffLinkState(row({ canTakeOver: false }), NOW).canTakeOver).toBe(
      false,
    );
  });

  it("does nothing after expiry", () => {
    const state = handoffLinkState(row({ expiresAt: EARLIER }), NOW);
    expect(state).toMatchObject({
      canAnswer: false,
      canTakeOver: false,
      isExpired: true,
    });
    expect(handoffLinkState(row({ status: "expired" }), NOW).isExpired).toBe(
      true,
    );
  });

  it("does nothing after Done", () => {
    expect(
      handoffLinkState(row({ status: "answered", linkClosedAt: NOW }), NOW),
    ).toMatchObject({ canAnswer: false, canTakeOver: false });
  });

  it("keeps a takeover writable past the link deadline", () => {
    expect(
      handoffLinkState(row({ status: "taken_over", expiresAt: EARLIER }), NOW),
    ).toMatchObject({ canWriteAsPerson: true, canAnswer: false, isExpired: false });
  });

  it("closes everything once handed back", () => {
    expect(handoffLinkState(row({ status: "handed_back" }), NOW)).toMatchObject({
      canAnswer: false,
      canTakeOver: false,
      canWriteAsPerson: false,
    });
  });
});
