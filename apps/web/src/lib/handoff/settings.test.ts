import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { collectColumnNames } from "@/test-utils/column-names";
import {
  buildHandoffSettingsWrite,
  confirmHandoffRecipient,
  defaultHandoffSettings,
  getAgentHandoffSettings,
} from "./settings";
import { handoffSettingsSchema } from "./validators";

const AGENT = { id: "agent-1", companyId: "company-1" };
const NOW = new Date("2026-10-02T12:00:00Z");
const CONFIRMED_AT = new Date("2026-10-01T09:00:00Z");

const input = (whatsapp: string, mode = "quick_answer" as const) =>
  handoffSettingsSchema.parse({
    mode,
    triggers: {
      priceNotListed: true,
      asksForPerson: false,
      complaintOrRefund: true,
      lowConfidence: true,
    },
    recipientName: "Markus Albrecht",
    recipientWhatsapp: whatsapp,
    expiryMinutes: 60,
    defaultReply: "person",
    recipientCanTakeOver: true,
    waitingText: "One moment",
    ifNobodyAnswers: "reply_by_email",
  });

const confirmedPrevious = {
  recipientWhatsapp: "+4915123456789",
  recipientConfirmed: true,
  recipientConfirmedAt: CONFIRMED_AT,
};

describe("buildHandoffSettingsWrite", () => {
  it("keeps confirmation when the number is unchanged", () => {
    const { values, needsConfirmation } = buildHandoffSettingsWrite(
      AGENT,
      input("+4915123456789"),
      confirmedPrevious,
      NOW,
    );
    expect(values.recipientConfirmed).toBe(true);
    expect(values.recipientConfirmedAt).toBe(CONFIRMED_AT);
    expect(needsConfirmation).toBe(false);
    expect(values).toMatchObject({
      agentId: "agent-1",
      companyId: "company-1",
      triggerAsksForPerson: false,
      expiryMinutes: 60,
      defaultReply: "person",
      ifNobodyAnswers: "reply_by_email",
      updatedAt: NOW,
    });
  });

  it("resets confirmation and asks for one when the number changes", () => {
    const { values, needsConfirmation } = buildHandoffSettingsWrite(
      AGENT,
      input("+4915199999999"),
      confirmedPrevious,
      NOW,
    );
    expect(values.recipientConfirmed).toBe(false);
    expect(values.recipientConfirmedAt).toBeNull();
    expect(needsConfirmation).toBe(true);
  });

  it("sends no confirmation for a cleared number or in Team chat", () => {
    expect(
      buildHandoffSettingsWrite(AGENT, input(""), confirmedPrevious, NOW)
        .needsConfirmation,
    ).toBe(false);
    expect(
      buildHandoffSettingsWrite(
        AGENT,
        input("+4915199999999", "team_chat" as "quick_answer"),
        confirmedPrevious,
        NOW,
      ).needsConfirmation,
    ).toBe(false);
  });
});

describe("db access", () => {
  const limit = vi.fn();
  const where = vi.fn((_c: unknown) => ({ limit, returning }));
  const from = vi.fn(() => ({ where }));
  const set = vi.fn(() => ({ where }));
  const returning = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(db as object, {
      select: vi.fn(() => ({ from })),
      update: vi.fn(() => ({ set })),
    });
  });

  it("falls back to defaults and scopes the read by company", async () => {
    limit.mockResolvedValue([]);
    const settings = await getAgentHandoffSettings(AGENT);
    expect(settings).toEqual(defaultHandoffSettings(AGENT));
    expect(collectColumnNames(where.mock.calls[0][0])).toEqual(
      expect.arrayContaining(["agent_id", "company_id"]),
    );
  });

  it("confirms only the number that is currently saved", async () => {
    returning.mockResolvedValue([]);
    expect(await confirmHandoffRecipient("agent-1", "+491", NOW)).toBe(false);
    expect(collectColumnNames(where.mock.calls[0][0])).toEqual(
      expect.arrayContaining(["agent_id", "recipient_whatsapp"]),
    );
  });
});
