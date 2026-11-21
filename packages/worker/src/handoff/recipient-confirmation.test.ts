import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmHandoffRecipient,
  confirmationPayload,
  handleRecipientConfirmationRequest,
  handleRecipientReply,
  parseConfirmationPayload,
  recipientConfirmationState,
  sendRecipientConfirmation,
} from "./recipient-confirmation";
import { defaultHandoffSettings, type HandoffSettingsRow } from "./store";

const AGENT_ID = "7b0c3f0e-1d2a-4c3b-9e8f-0a1b2c3d4e5f";
const COMPANY_ID = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const OTHER_COMPANY_ID = "9f8e7d6c-5b4a-4321-8fed-cba987654321";
const SENDER = { phoneNumberId: "111222333444555", accessToken: "EAAGcompanytoken" };
const NOW = new Date("2026-10-03T10:00:00Z");

function settings(overrides: Partial<HandoffSettingsRow> = {}): HandoffSettingsRow {
  return {
    ...defaultHandoffSettings({ id: AGENT_ID, companyId: COMPANY_ID }),
    recipientName: "Markus Albrecht",
    recipientWhatsapp: "+49 151 12345678",
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
const getSettings = vi.fn();
const findSender = vi.fn();
const isCompanySender = vi.fn();
const confirm = vi.fn();

const deps = () => ({
  getSettings,
  findSender,
  companyName: async () => "Acme GmbH",
  isCompanySender,
  confirm,
  now: () => NOW,
});

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  getSettings.mockResolvedValue(settings());
  findSender.mockResolvedValue(SENDER);
  isCompanySender.mockResolvedValue(true);
  confirm.mockResolvedValue(true);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("recipientConfirmationState", () => {
  it("is 'not_confirmed' (the node's \"Recipient not confirmed\") for a saved, unconfirmed number", () => {
    expect(recipientConfirmationState(settings())).toBe("not_confirmed");
  });
  it("is 'confirmed' once confirmed", () => {
    expect(recipientConfirmationState(settings({ recipientConfirmed: true }))).toBe("confirmed");
  });
  it("is 'no_recipient' without a number", () => {
    expect(recipientConfirmationState(settings({ recipientWhatsapp: null }))).toBe("no_recipient");
  });
  it("is 'not_needed' in Team chat", () => {
    expect(recipientConfirmationState(settings({ mode: "team_chat" }))).toBe("not_needed");
  });
});

describe("confirmation payload", () => {
  it("round-trips the agent id", () => {
    expect(parseConfirmationPayload(confirmationPayload(AGENT_ID))).toBe(AGENT_ID);
  });
  it.each([null, "", "hello", "handoff_confirm:not-a-uuid"])("rejects %s", (payload) => {
    expect(parseConfirmationPayload(payload)).toBeNull();
  });
});

describe("sendRecipientConfirmation (Meta Cloud API, mocked)", () => {
  it("sends the confirmation template with a Confirm payload from the company's sender", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid.C1" }] }), { status: 200 }),
    );

    const result = await sendRecipientConfirmation(
      { id: AGENT_ID, companyId: COMPANY_ID },
      deps(),
    );

    expect(result).toEqual({
      status: "sent",
      delivery: { status: "sent", channel: "whatsapp", providerMessageId: "wamid.C1" },
    });
    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.to).toBe("4915112345678");
    expect(body.template.name).toBe("relay_handoff_recipient_confirm");
    expect(body.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual([
      "Markus Albrecht",
      "Acme GmbH",
    ]);
    expect(body.template.components[1].parameters[0].payload).toBe(
      `handoff_confirm:${AGENT_ID}`,
    );
  });

  it("reports a Meta failure", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Template paused" } }), { status: 400 }),
    );

    const result = await sendRecipientConfirmation(
      { id: AGENT_ID, companyId: COMPANY_ID },
      deps(),
    );

    expect(result).toEqual({ status: "failed", error: "Template paused" });
  });

  it("treats another company's agent as not found", async () => {
    const result = await sendRecipientConfirmation(
      { id: AGENT_ID, companyId: OTHER_COMPANY_ID },
      deps(),
    );
    expect(result).toEqual({ status: "not_found" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ recipientConfirmed: true }, "already_confirmed"],
    [{ recipientWhatsapp: null }, "no_recipient"],
    [{ mode: "team_chat" as const }, "not_needed"],
  ])("does not send when %o", async (overrides, status) => {
    getSettings.mockResolvedValue(settings(overrides));
    const result = await sendRecipientConfirmation(
      { id: AGENT_ID, companyId: COMPANY_ID },
      deps(),
    );
    expect(result).toEqual({ status });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("needs a company sender", async () => {
    findSender.mockResolvedValue(null);
    const result = await sendRecipientConfirmation(
      { id: AGENT_ID, companyId: COMPANY_ID },
      deps(),
    );
    expect(result).toEqual({ status: "no_sender" });
  });
});

describe("confirmHandoffRecipient", () => {
  const reply = {
    phoneNumberId: SENDER.phoneNumberId,
    fromWaId: "4915112345678",
    payload: `handoff_confirm:${AGENT_ID}`,
  };

  it("confirms the number on file when it replies on the company's sender", async () => {
    await expect(confirmHandoffRecipient(reply, deps())).resolves.toBe("confirmed");
    expect(isCompanySender).toHaveBeenCalledWith(SENDER.phoneNumberId, COMPANY_ID);
    expect(confirm).toHaveBeenCalledWith({
      agentId: AGENT_ID,
      companyId: COMPANY_ID,
      recipientWhatsapp: "+49 151 12345678",
      now: NOW,
    });
  });

  it("ignores a reply from another number", async () => {
    await expect(
      confirmHandoffRecipient({ ...reply, fromWaId: "4915199999999" }, deps()),
    ).resolves.toBe("ignored");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("ignores a reply that arrived on another company's sender", async () => {
    isCompanySender.mockResolvedValue(false);
    await expect(confirmHandoffRecipient(reply, deps())).resolves.toBe("ignored");
    expect(confirm).not.toHaveBeenCalled();
  });

  it("ignores a non-confirmation payload", async () => {
    await expect(
      confirmHandoffRecipient({ ...reply, payload: "Yes" }, deps()),
    ).resolves.toBe("ignored");
    expect(getSettings).not.toHaveBeenCalled();
  });

  it("ignores a number changed since (the guarded update matches nothing)", async () => {
    confirm.mockResolvedValue(false);
    await expect(confirmHandoffRecipient(reply, deps())).resolves.toBe("ignored");
  });
});

describe("internal handlers", () => {
  it("validates the confirmation request body", async () => {
    await expect(handleRecipientConfirmationRequest({ agentId: "x" }, deps())).resolves.toEqual({
      status: 400,
      body: "Invalid confirmation request",
    });
  });

  it("maps a sent confirmation to 202", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ messages: [{ id: "wamid.C2" }] }), { status: 200 }),
    );
    await expect(
      handleRecipientConfirmationRequest({ agentId: AGENT_ID, companyId: COMPANY_ID }, deps()),
    ).resolves.toEqual({ status: 202, body: "sent" });
  });

  it("maps a recipient reply to its outcome", async () => {
    await expect(
      handleRecipientReply(
        { phoneNumberId: SENDER.phoneNumberId, fromWaId: "4915112345678", payload: `handoff_confirm:${AGENT_ID}` },
        deps(),
      ),
    ).resolves.toEqual({ status: 200, body: "confirmed" });
    await expect(handleRecipientReply({}, deps())).resolves.toMatchObject({ status: 400 });
  });
});
