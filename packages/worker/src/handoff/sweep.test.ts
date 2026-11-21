import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  expireDueHandoffRequests: vi.fn(),
  handBackIdleTakeovers: vi.fn(),
  getHandoffSettings: vi.fn(),
  saveAssistantMessage: vi.fn(),
  sendMessage: vi.fn(),
  chatsFindFirst: vi.fn(),
  companiesFindFirst: vi.fn(),
  channelsFindFirst: vi.fn(),
  companyRecordsFindFirst: vi.fn(),
  metadataUpdate: vi.fn(),
}));

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      update: () => ({ set: (v: unknown) => ({ where: async () => m.metadataUpdate(v) }) }),
      query: {
        chats: { findFirst: m.chatsFindFirst },
        companies: { findFirst: m.companiesFindFirst },
        channels: { findFirst: m.channelsFindFirst },
        companyRecords: { findFirst: m.companyRecordsFindFirst },
      },
    },
  };
});
vi.mock("./store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./store")>();
  return {
    ...actual,
    expireDueHandoffRequests: (...a: unknown[]) => m.expireDueHandoffRequests(...a),
    handBackIdleTakeovers: (...a: unknown[]) => m.handBackIdleTakeovers(...a),
    getHandoffSettings: (...a: unknown[]) => m.getHandoffSettings(...a),
  };
});
vi.mock("../ai/chat-persistence", () => ({
  saveAssistantMessage: (...a: unknown[]) => m.saveAssistantMessage(...a),
}));
vi.mock("../integrations/messaging", () => ({
  sendMessage: (...a: unknown[]) => m.sendMessage(...a),
}));

import {
  capturedEmail,
  capturedEmailFromIntake,
  expiredRequestMessage,
  HANDOFF_EXPIRED_KEY,
  sweepHandoffRequests,
} from "./sweep";
import { defaultHandoffSettings } from "./store";

const now = new Date("2026-10-03T12:00:00.000Z");
const scope = { id: "agent-1", companyId: "company-1" };

function expiredRow(id: string, chatId = "chat-1") {
  return {
    id,
    chatId,
    companyId: "company-1",
    agentId: "agent-1",
    status: "expired",
    mode: "quick_answer",
  };
}

function widgetChat(id = "chat-1") {
  return { id, companyId: "company-1", agentId: "agent-1", channelType: "widget", visitorId: "v-1" };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.expireDueHandoffRequests.mockResolvedValue([]);
  m.handBackIdleTakeovers.mockResolvedValue([]);
  m.getHandoffSettings.mockResolvedValue(defaultHandoffSettings(scope));
  m.companiesFindFirst.mockResolvedValue({ id: "company-1", name: "Acme" });
  m.chatsFindFirst.mockResolvedValue(widgetChat());
  m.saveAssistantMessage.mockResolvedValue("msg-1");
  m.companyRecordsFindFirst.mockResolvedValue(undefined);
});

describe("expiredRequestMessage", () => {
  it("defaults to 'the team will reply here'", () => {
    expect(expiredRequestMessage("reply_here", "Acme", "a@b.co")).toContain("reply to you here");
  });

  it("offers email only with a captured email", () => {
    expect(expiredRequestMessage("reply_by_email", "Acme", "tobias@example.com")).toContain(
      "by email at tobias@example.com",
    );
    expect(expiredRequestMessage("reply_by_email", "Acme", null)).toContain("reply to you here");
  });
});

describe("capturedEmail", () => {
  it("finds an email in a contact field and ignores phone numbers", () => {
    expect(capturedEmail("Tobias, tobias@example.com")).toBe("tobias@example.com");
    expect(capturedEmail("+49 151 234567")).toBeNull();
    expect(capturedEmail(null)).toBeNull();
  });
});

describe("capturedEmailFromIntake", () => {
  it("prefers an email intake field, then any answer holding an email", () => {
    expect(
      capturedEmailFromIntake({
        intake: { iletisim: "x@other.co", email: "Tobias <tobias@example.com>" },
      }),
    ).toBe("tobias@example.com");
    expect(capturedEmailFromIntake({ intake: { need: "call me", iletisim: "t@ex.de" } })).toBe(
      "t@ex.de",
    );
  });

  it("returns null without intake answers or an email", () => {
    expect(capturedEmailFromIntake({})).toBeNull();
    expect(capturedEmailFromIntake({ intake: "nope" })).toBeNull();
    expect(capturedEmailFromIntake({ intake: { phone: "+49 151", budget: 5000 } })).toBeNull();
    expect(capturedEmailFromIntake(null)).toBeNull();
  });
});

describe("sweepHandoffRequests", () => {
  it("expires due requests in every mode and tells each customer once", async () => {
    m.expireDueHandoffRequests.mockResolvedValue([
      expiredRow("req-1"),
      { ...expiredRow("req-2", "chat-2"), mode: "team_chat" },
    ]);
    m.chatsFindFirst
      .mockResolvedValueOnce(widgetChat("chat-1"))
      .mockResolvedValueOnce(widgetChat("chat-2"));

    const result = await sweepHandoffRequests(now);

    expect(m.expireDueHandoffRequests).toHaveBeenCalledWith(now);
    expect(result).toEqual({ expired: 2, handedBack: 0 });
    expect(m.saveAssistantMessage).toHaveBeenCalledTimes(2);
    expect(m.saveAssistantMessage).toHaveBeenNthCalledWith(
      1,
      "chat-1",
      expect.stringContaining("reply to you here"),
      { [HANDOFF_EXPIRED_KEY]: "req-1" },
    );
    expect(m.saveAssistantMessage).toHaveBeenNthCalledWith(
      2,
      "chat-2",
      expect.any(String),
      { [HANDOFF_EXPIRED_KEY]: "req-2" },
    );
    expect(m.sendMessage).not.toHaveBeenCalled();
  });

  it("uses the email variant when set and the conversation has a captured email", async () => {
    m.expireDueHandoffRequests.mockResolvedValue([expiredRow("req-1")]);
    m.getHandoffSettings.mockResolvedValue({
      ...defaultHandoffSettings(scope),
      ifNobodyAnswers: "reply_by_email",
    });
    m.companyRecordsFindFirst.mockResolvedValue({
      companyId: "company-1",
      payload: { intake: { name: "Tobias", iletisim: "tobias@example.com" } },
    });

    await sweepHandoffRequests(now);

    expect(m.saveAssistantMessage).toHaveBeenCalledWith(
      "chat-1",
      expect.stringContaining("by email at tobias@example.com"),
      expect.anything(),
    );
  });

  it("falls back to 'reply here' when email is chosen but none was captured", async () => {
    m.expireDueHandoffRequests.mockResolvedValue([expiredRow("req-1")]);
    m.getHandoffSettings.mockResolvedValue({
      ...defaultHandoffSettings(scope),
      ifNobodyAnswers: "reply_by_email",
    });
    m.companyRecordsFindFirst.mockResolvedValue({
      companyId: "company-1",
      payload: { intake: { iletisim: "+49 151 234567" } },
    });

    await sweepHandoffRequests(now);

    expect(m.saveAssistantMessage).toHaveBeenCalledWith(
      "chat-1",
      expect.stringContaining("reply to you here"),
      expect.anything(),
    );
  });

  it("sends the expiry message out on WhatsApp", async () => {
    m.expireDueHandoffRequests.mockResolvedValue([expiredRow("req-1")]);
    m.chatsFindFirst.mockResolvedValue({
      ...widgetChat(),
      channelType: "whatsapp",
      visitorId: "4915100000",
    });
    m.channelsFindFirst.mockResolvedValue({
      id: "ch-1",
      config: { phoneNumberId: "pn-1", accessToken: "tok" },
    });
    m.sendMessage.mockResolvedValue({ success: true, messageId: "wamid.1" });

    await sweepHandoffRequests(now);

    expect(m.sendMessage).toHaveBeenCalledWith(
      "whatsapp",
      "4915100000",
      expect.stringContaining("reply to you here"),
      { phoneNumberId: "pn-1", accessToken: "tok" },
    );
    expect(m.metadataUpdate).toHaveBeenCalledTimes(1);
  });

  it("keeps going when one expiry message fails", async () => {
    m.expireDueHandoffRequests.mockResolvedValue([expiredRow("req-1"), expiredRow("req-2", "chat-2")]);
    m.saveAssistantMessage.mockRejectedValueOnce(new Error("db down")).mockResolvedValue("msg-2");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await sweepHandoffRequests(now);

    expect(result.expired).toBe(2);
    expect(m.saveAssistantMessage).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });

  it("hands idle takeovers back without messaging the customer", async () => {
    m.handBackIdleTakeovers.mockResolvedValue([{ id: "req-9", status: "handed_back" }]);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await sweepHandoffRequests(now);

    expect(m.handBackIdleTakeovers).toHaveBeenCalledWith(now);
    expect(result).toEqual({ expired: 0, handedBack: 1 });
    expect(m.saveAssistantMessage).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it("still hands back idle takeovers when the expiry sweep throws", async () => {
    m.expireDueHandoffRequests.mockRejectedValue(new Error("db down"));
    m.handBackIdleTakeovers.mockResolvedValue([{ id: "req-9" }]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await sweepHandoffRequests(now);

    expect(result).toEqual({ expired: 0, handedBack: 1 });
    error.mockRestore();
    info.mockRestore();
  });
});
