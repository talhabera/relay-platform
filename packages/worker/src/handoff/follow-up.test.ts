import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  getHandoffRequest: vi.fn(),
  isChatTakenOver: vi.fn(),
  loadHandoffRuntime: vi.fn(),
  generateText: vi.fn(),
  saveAssistantMessage: vi.fn(),
  sendMessage: vi.fn(),
  checkTokenBudget: vi.fn(),
  recordTokenUsage: vi.fn(),
  existingFollowUp: vi.fn(),
  chatsFindFirst: vi.fn(),
  agentsFindFirst: vi.fn(),
  companiesFindFirst: vi.fn(),
  channelsFindFirst: vi.fn(),
  convertToModelMessages: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: (...a: unknown[]) => m.generateText(...a),
    convertToModelMessages: (...a: unknown[]) => m.convertToModelMessages(...a),
  };
});

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  const limit = () => m.existingFollowUp();
  return {
    ...actual,
    db: {
      select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
      query: {
        chats: { findFirst: m.chatsFindFirst },
        agents: { findFirst: m.agentsFindFirst },
        companies: { findFirst: m.companiesFindFirst },
        channels: { findFirst: m.channelsFindFirst, findMany: vi.fn(async () => []) },
        integrations: { findMany: vi.fn(async () => []) },
        knowledgeBase: { findMany: vi.fn(async () => []) },
      },
    },
  };
});

vi.mock("./store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./store")>();
  return {
    ...actual,
    getHandoffRequest: (...a: unknown[]) => m.getHandoffRequest(...a),
    isChatTakenOver: (...a: unknown[]) => m.isChatTakenOver(...a),
  };
});
vi.mock("./runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./runtime")>();
  return { ...actual, loadHandoffRuntime: (...a: unknown[]) => m.loadHandoffRuntime(...a) };
});
vi.mock("../ai/provider", () => ({ getModel: () => "mock-model" }));
vi.mock("../ai/tools", () => ({ selectTools: () => ({}) }));
vi.mock("../ai/chat-persistence", () => ({
  getChatHistory: async () => [],
  saveAssistantMessage: (...a: unknown[]) => m.saveAssistantMessage(...a),
}));
vi.mock("../ai/token-limiter", () => ({
  checkTokenBudget: (...a: unknown[]) => m.checkTokenBudget(...a),
  recordTokenUsage: (...a: unknown[]) => m.recordTokenUsage(...a),
}));
vi.mock("../integrations/messaging", () => ({
  sendMessage: (...a: unknown[]) => m.sendMessage(...a),
}));

import { runHandoffFollowUp } from "./follow-up";
import { defaultHandoffSettings } from "./store";

const ANSWERED = {
  id: "req-1",
  chatId: "chat-1",
  companyId: "company-1",
  status: "answered",
  replyMode: "agent",
  answer: "Yes, 300k works.",
  questions: [{ text: "300k?", askedAt: "" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  m.getHandoffRequest.mockResolvedValue(ANSWERED);
  m.existingFollowUp.mockResolvedValue([]);
  m.isChatTakenOver.mockResolvedValue(false);
  m.loadHandoffRuntime.mockResolvedValue({
    settings: defaultHandoffSettings({ id: "agent-1", companyId: "company-1" }),
    latest: ANSWERED,
    takeoverMessages: [],
    paused: false,
  });
  m.chatsFindFirst.mockResolvedValue({
    id: "chat-1",
    companyId: "company-1",
    agentId: "agent-1",
    channelType: "widget",
    visitorId: "visitor-1",
  });
  m.agentsFindFirst.mockResolvedValue({ id: "agent-1", kind: "customer", model: "sonnet", name: "Lukas" });
  m.companiesFindFirst.mockResolvedValue({ id: "company-1", name: "Acme" });
  m.checkTokenBudget.mockResolvedValue({ allowed: true });
  m.convertToModelMessages.mockImplementation(async (ui: unknown) => ui);
  m.generateText.mockResolvedValue({ text: "Good news: 300k works.", usage: { totalTokens: 10 } });
  m.saveAssistantMessage.mockResolvedValue("msg-1");
  m.sendMessage.mockResolvedValue({ success: true, messageId: "wamid.1" });
});

describe("runHandoffFollowUp", () => {
  it("follows up on an agent-phrased answer and marks the message", async () => {
    await expect(runHandoffFollowUp("req-1")).resolves.toBe("saved");

    const input = m.convertToModelMessages.mock.calls[0][0] as { role: string; parts: { text: string }[] }[];
    expect(input.at(-1)?.role).toBe("user");
    expect(input.at(-1)?.parts[0].text).toContain("Yes, 300k works.");
    expect(m.saveAssistantMessage).toHaveBeenCalledWith("chat-1", "Good news: 300k works.", {
      handoffRequestId: "req-1",
    });
    expect(m.checkTokenBudget).toHaveBeenCalledWith("visitor-1", "widget");
  });

  it("needs no follow-up when the person answered verbatim", async () => {
    m.getHandoffRequest.mockResolvedValue({ ...ANSWERED, replyMode: "person" });

    await expect(runHandoffFollowUp("req-1")).resolves.toBe("not_needed");
    expect(m.generateText).not.toHaveBeenCalled();
  });

  it("needs no follow-up for a request that is not answered", async () => {
    m.getHandoffRequest.mockResolvedValue({ ...ANSWERED, status: "open" });

    await expect(runHandoffFollowUp("req-1")).resolves.toBe("not_needed");
  });

  it("follows up only once per request", async () => {
    m.existingFollowUp.mockResolvedValue([{ id: "msg-0" }]);

    await expect(runHandoffFollowUp("req-1")).resolves.toBe("already_followed_up");
    expect(m.generateText).not.toHaveBeenCalled();
  });

  it("stays quiet when a person took over meanwhile", async () => {
    m.loadHandoffRuntime.mockResolvedValue({
      settings: defaultHandoffSettings({ id: "agent-1", companyId: "company-1" }),
      latest: { ...ANSWERED, status: "taken_over" },
      takeoverMessages: [],
      paused: true,
    });

    await expect(runHandoffFollowUp("req-1")).resolves.toBe("taken_over");
    expect(m.generateText).not.toHaveBeenCalled();
  });

  it("sends the follow-up out on WhatsApp, billed to the channel", async () => {
    m.chatsFindFirst.mockResolvedValue({
      id: "chat-1",
      companyId: "company-1",
      agentId: "agent-1",
      channelType: "whatsapp",
      visitorId: "905551112233",
    });
    m.channelsFindFirst.mockResolvedValue({
      id: "channel-1",
      config: { phoneNumberId: "1065", accessToken: "EAAtoken" },
    });

    await expect(runHandoffFollowUp("req-1")).resolves.toBe("sent");
    expect(m.checkTokenBudget).toHaveBeenCalledWith("channel-1", "channel");
    expect(m.sendMessage).toHaveBeenCalledWith(
      "whatsapp",
      "905551112233",
      "Good news: 300k works.",
      { phoneNumberId: "1065", accessToken: "EAAtoken" },
    );
  });
});
