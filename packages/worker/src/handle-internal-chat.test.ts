import { isRunActive } from "./operator/active-runs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      query: {
        chats: { findFirst: vi.fn() },
        agents: { findFirst: vi.fn(), findMany: vi.fn() },
        companies: { findFirst: vi.fn() },
        knowledgeBase: { findMany: vi.fn() },
        integrations: { findMany: vi.fn() },
        channels: { findMany: vi.fn() },
        agentVersions: { findFirst: vi.fn() },
        messages: { findMany: vi.fn() },
        tokenUsage: { findFirst: vi.fn() },
        widgetConfigs: { findFirst: vi.fn() },
      },
      insert: vi.fn(() => ({
        values: vi.fn(() => ({ returning: vi.fn(() => [{ id: "m1" }]) })),
      })),
    },
  };
});

vi.mock("ai", () => ({
  streamText: vi.fn(() => ({
    toUIMessageStreamResponse: vi.fn(() => new Response("stream", { status: 200 })),
    consumeStream: vi.fn(async () => {}),
  })),
  convertToModelMessages: vi.fn(async () => []),
  stepCountIs: vi.fn(() => () => false),
  hasToolCall: vi.fn((name: string) => `hasToolCall:${name}`),
  createUIMessageStream: vi.fn(() => "empty-stream"),
  createUIMessageStreamResponse: vi.fn(() => new Response("", { status: 200 })),
}));

vi.mock("./handoff/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./handoff/runtime")>();
  return { ...actual, loadHandoffRuntime: vi.fn() };
});

vi.mock("./ai/token-limiter", () => ({
  checkTokenBudget: vi.fn(() => ({
    allowed: true,
    used: 0,
    limit: 100_000,
    remaining: 100_000,
    resetsAt: "2026-09-01T00:00:00.000Z",
  })),
  recordTokenUsage: vi.fn(),
}));

vi.mock("./ai/chat-persistence", () => ({
  createChatSession: vi.fn(async () => "chat-new"),
  saveUserMessage: vi.fn(),
  saveAssistantMessage: vi.fn(),
  getChatHistory: vi.fn(async () => []),
}));

vi.mock("./ai/tools", () => ({
  selectTools: vi.fn(() => ({})),
}));

vi.mock("./operator/tools", () => ({
  selectOperatorTools: vi.fn(() => ({})),
}));

vi.mock("./operator/system-prompt", () => ({
  buildOperatorSystemPrompt: vi.fn(() => "operator prompt"),
}));

vi.mock("./operator/ask-operator", () => ({
  ASK_OPERATOR_TOOL: "ask_operator",
  answerOpenChatQuestions: vi.fn(async () => []),
}));

vi.mock("./ai/provider", () => ({
  getModel: vi.fn((model?: string | null) => `model:${model ?? "default"}`),
}));

import { db } from "@relay/db";
import { streamText, convertToModelMessages } from "ai";
import { checkTokenBudget } from "./ai/token-limiter";
import {
  createChatSession,
  getChatHistory,
  saveAssistantMessage,
  saveUserMessage,
} from "./ai/chat-persistence";
import { collectColumnNames } from "./test-utils/column-names";
import { selectTools } from "./ai/tools";
import { selectOperatorTools } from "./operator/tools";
import { buildOperatorSystemPrompt } from "./operator/system-prompt";
import { answerOpenChatQuestions } from "./operator/ask-operator";
import { getModel } from "./ai/provider";
import { handleInternalChat } from "./handle-internal-chat";
import { loadHandoffRuntime } from "./handoff/runtime";
import { defaultHandoffSettings } from "./handoff/store";

function handoffRuntime(paused = false) {
  return {
    settings: defaultHandoffSettings({ id: "agent-1", companyId: "company-1" }),
    latest: null,
    takeoverMessages: [],
    paused,
  };
}

const mockCompany = {
  id: "company-1",
  name: "Test Co",
  industry: "tech",
  description: "A test company",
  widgetId: "wid-123",
  ownerId: "user-1",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockAgent = {
  id: "agent-1",
  name: "TestBot",
  companyId: "company-1",
  persona: "friendly",
  responseLength: "medium",
  language: "en",
  kind: "customer",
  isActive: true,
  model: "haiku",
  leadCaptureEnabled: true,
  leadCaptureWorkflowId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockOperatorAgent = {
  id: "agent-1",
  name: "OpsBot",
  companyId: "company-1",
  kind: "operator" as const,
  persona: "professional",
  responseLength: "medium",
  language: "en",
  description: "Operator assistant",
  instructions: null,
  createdByUserId: "user-1",
};

const mockVersion = {
  id: "version-1",
  agentId: "agent-1",
  name: "v1",
  instructions: "Follow SOPs",
  model: "sonnet",
  toolToggles: { webSearch: true, excel: false, companyMemory: false, proposeAction: false },
};

const mockOperatorChat = {
  id: "chat-1",
  userId: "user-1",
  companyId: "company-1",
  agentId: "agent-1",
  versionId: "version-1",
  channelType: "operator" as const,
  title: "Untitled session",
};

function makeUIMessage(role: "user" | "assistant", text: string) {
  return {
    id: `msg-${Math.random()}`,
    role,
    parts: [{ type: "text" as const, text }],
    createdAt: new Date(),
  };
}

function setupCustomerHappyPath() {
  vi.mocked(db.query.companies.findFirst).mockResolvedValue(
    mockCompany as never,
  );
  vi.mocked(db.query.agents.findFirst).mockResolvedValue(undefined);
  vi.mocked(db.query.integrations.findMany).mockResolvedValue([]);
}

function setupOperatorHappyPath() {
  vi.mocked(db.query.chats.findFirst).mockResolvedValue(
    mockOperatorChat as never,
  );
  vi.mocked(db.query.agentVersions.findFirst).mockResolvedValue(
    mockVersion as never,
  );
  vi.mocked(db.query.agents.findFirst).mockResolvedValue(
    mockOperatorAgent as never,
  );
  vi.mocked(db.query.companies.findFirst).mockResolvedValue(
    mockCompany as never,
  );
  vi.mocked(db.query.knowledgeBase.findMany).mockResolvedValue([]);
  vi.mocked(getChatHistory).mockResolvedValue([]);
}

function setupWidgetHappyPath() {
  vi.mocked(db.query.companies.findFirst).mockResolvedValue(
    mockCompany as never,
  );
  vi.mocked(db.query.widgetConfigs.findFirst).mockResolvedValue(undefined);
  vi.mocked(db.query.agents.findMany).mockResolvedValue([mockAgent] as never);
  vi.mocked(db.query.integrations.findMany).mockResolvedValue([]);
  vi.mocked(db.query.channels.findMany).mockResolvedValue([]);
}

const whatsappChannelRow = {
  id: "channel-1",
  agentId: "agent-1",
  type: "whatsapp",
  status: "active",
  config: { phoneNumberId: "123456789012345", accessToken: "EAAGtoken" },
};

/** A widget chat that really is visitor-1's chat with company-1's agent-1. */
const ownWidgetChat = {
  id: "chat-1",
  companyId: "company-1",
  agentId: "agent-1",
  channelType: "widget",
  visitorId: "visitor-1",
};

describe("handleInternalChat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadHandoffRuntime).mockResolvedValue(handoffRuntime());
    vi.mocked(checkTokenBudget).mockResolvedValue({
      allowed: true,
      used: 0,
      limit: 100_000,
      remaining: 100_000,
      resetsAt: "2026-09-01T00:00:00.000Z",
    });
    const mockResponse = new Response("stream", { status: 200 });
    vi.mocked(streamText).mockReturnValue({
      toUIMessageStreamResponse: vi.fn(() => mockResponse),
      consumeStream: vi.fn(async () => {}),
    } as never);
  });

  it("returns 400 when kind is customer but agent is operator", async () => {
    vi.mocked(db.query.companies.findFirst).mockResolvedValue(
      mockCompany as never,
    );
    vi.mocked(db.query.agents.findFirst).mockResolvedValue({
      id: "a1",
      kind: "operator",
      companyId: "c1",
    } as never);

    const res = await handleInternalChat({
      kind: "customer",
      companyId: "c1",
      agentId: "a1",
      userId: "u1",
      messages: [
        {
          id: "m",
          role: "user",
          parts: [{ type: "text", text: "hi" }],
        },
      ],
    });

    expect(res.status).toBe(400);
  });

  it("returns 400 when kind is operator but chat is not operator", async () => {
    vi.mocked(db.query.chats.findFirst).mockResolvedValue({
      id: "ch1",
      channelType: "web",
      versionId: null,
      agentId: "a1",
    } as never);

    const res = await handleInternalChat({
      kind: "operator",
      chatId: "ch1",
      userId: "u1",
      messages: [
        {
          id: "m",
          role: "user",
          parts: [{ type: "text", text: "hi" }],
        },
      ],
    });

    expect(res.status).toBe(400);
  });

  describe("customer kind", () => {
    it("returns 400 when companyId is missing", async () => {
      const res = await handleInternalChat({
        kind: "customer",
        userId: "user-1",
        messages: [makeUIMessage("user", "hello")],
      });
      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).toContain("Company ID");
    });

    it("returns 404 when company not found", async () => {
      vi.mocked(db.query.companies.findFirst).mockResolvedValue(undefined);

      const res = await handleInternalChat({
        kind: "customer",
        companyId: "nonexistent",
        userId: "user-1",
        messages: [makeUIMessage("user", "hello")],
      });
      expect(res.status).toBe(404);
    });

    it("returns streaming response on success", async () => {
      setupCustomerHappyPath();

      const res = await handleInternalChat({
        kind: "customer",
        companyId: "company-1",
        userId: "user-1",
        messages: [makeUIMessage("user", "hello")],
      });
      expect(res.status).toBe(200);
      expect(streamText).toHaveBeenCalled();
    });

    it("never passes a package slug or session user to operator tools", async () => {
      setupCustomerHappyPath();

      await handleInternalChat({
        kind: "customer",
        companyId: "company-1",
        userId: "user-1",
        messages: [makeUIMessage("user", "hello")],
      });

      expect(selectOperatorTools).not.toHaveBeenCalled();
    });

    it("persists user message when chatId is provided", async () => {
      setupCustomerHappyPath();

      await handleInternalChat({
        kind: "customer",
        companyId: "company-1",
        userId: "user-1",
        chatId: "chat-1",
        messages: [makeUIMessage("user", "hello")],
      });
      expect(saveUserMessage).toHaveBeenCalledWith("chat-1", "hello");
    });

    // The dashboard test chat is the owner talking to their own agent through
    // an authenticated session, so a send from their own number is a send they
    // asked for. This is the one customer path that may hold send tools.
    it("asks for send tools on the authenticated dashboard path", async () => {
      setupCustomerHappyPath();
      vi.mocked(db.query.agents.findFirst).mockResolvedValue(mockAgent as never);
      vi.mocked(db.query.knowledgeBase.findMany).mockResolvedValue([]);
      vi.mocked(db.query.channels.findMany).mockResolvedValue([
        whatsappChannelRow,
      ] as never);

      await handleInternalChat({
        kind: "customer",
        companyId: "company-1",
        userId: "user-1",
        agentId: "agent-1",
        messages: [makeUIMessage("user", "hello")],
      });

      expect(selectTools).toHaveBeenCalledWith(
        [],
        "agent-1",
        [whatsappChannelRow],
        expect.objectContaining({ allowSendTools: true }),
      );
    });

    it("uses stored model key from customer agent", async () => {
      setupCustomerHappyPath();
      vi.mocked(db.query.knowledgeBase.findMany).mockResolvedValue([]);
      vi.mocked(db.query.agents.findFirst).mockResolvedValue({
        ...mockAgent,
        model: "opus",
      } as never);

      await handleInternalChat({
        kind: "customer",
        companyId: "company-1",
        userId: "user-1",
        agentId: "agent-1",
        messages: [makeUIMessage("user", "hello")],
      });
      expect(getModel).toHaveBeenCalledWith("opus");
    });
  });

  describe("operator kind", () => {
    it("returns 429 when token budget is exceeded", async () => {
      setupOperatorHappyPath();
      vi.mocked(checkTokenBudget).mockResolvedValue({
        allowed: false,
        used: 100_000,
        limit: 100_000,
        remaining: 0,
        resetsAt: "2026-09-01T00:00:00.000Z",
      });

      const res = await handleInternalChat({
        kind: "operator",
        chatId: "chat-1",
        userId: "user-1",
        messages: [makeUIMessage("user", "hello")],
      });
      expect(res.status).toBe(429);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe("Weekly token limit reached");
    });

    it("returns 200 and calls streamText on success", async () => {
      setupOperatorHappyPath();

      const res = await handleInternalChat({
        kind: "operator",
        chatId: "chat-1",
        userId: "user-1",
        messages: [makeUIMessage("user", "hello")],
      });
      expect(res.status).toBe(200);
      expect(streamText).toHaveBeenCalled();
      expect(buildOperatorSystemPrompt).toHaveBeenCalled();
      expect(selectOperatorTools).toHaveBeenCalledWith(
        expect.objectContaining({
          version: mockVersion,
          chatId: "chat-1",
          agentId: "agent-1",
        }),
      );
      expect(saveUserMessage).toHaveBeenCalledWith("chat-1", "hello");
      expect(getModel).toHaveBeenCalledWith("sonnet");
    });

    it("passes the agent package slug and session user to selectOperatorTools", async () => {
      setupOperatorHappyPath();
      vi.mocked(db.query.agents.findFirst).mockResolvedValue({
        ...mockOperatorAgent,
        packageSlug: "manager",
      } as never);

      await handleInternalChat({
        kind: "operator",
        chatId: "chat-1",
        userId: "user-1",
        messages: [makeUIMessage("user", "what should I do today?")],
      });

      expect(selectOperatorTools).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: "chat-1",
          agentId: "agent-1",
          companyId: "company-1",
          packageSlug: "manager",
          userId: "user-1",
        }),
      );
    });

    it("passes a null package slug for an agent installed by hand", async () => {
      setupOperatorHappyPath();
      vi.mocked(db.query.agents.findFirst).mockResolvedValue({
        ...mockOperatorAgent,
        packageSlug: null,
      } as never);

      await handleInternalChat({
        kind: "operator",
        chatId: "chat-1",
        userId: "user-1",
        messages: [makeUIMessage("user", "hello")],
      });

      expect(selectOperatorTools).toHaveBeenCalledWith(
        expect.objectContaining({ packageSlug: null, userId: "user-1" }),
      );
    });

    it("keeps the run going without a reader and marks the session running until it ends", async () => {
      setupOperatorHappyPath();
      let finishRun = () => {};
      const consumeStream = vi.fn(() => new Promise<void>((resolve) => { finishRun = resolve; }));
      vi.mocked(streamText).mockReturnValue({
        toUIMessageStreamResponse: vi.fn(() => new Response("stream", { status: 200 })),
        consumeStream,
      } as never);

      await handleInternalChat({
        kind: "operator",
        chatId: "chat-1",
        userId: "user-1",
        messages: [makeUIMessage("user", "hello")],
      });
      expect(consumeStream).toHaveBeenCalled();
      expect(isRunActive("chat-1")).toBe(true);

      finishRun();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(isRunActive("chat-1")).toBe(false);
    });

    it("answers open agent questions with the composer reply and stops the turn on ask_operator", async () => {
      setupOperatorHappyPath();

      await handleInternalChat({
        kind: "operator",
        chatId: "chat-1",
        userId: "user-1",
        messages: [makeUIMessage("user", "Use the Istanbul list")],
      });

      expect(answerOpenChatQuestions).toHaveBeenCalledWith({
        chatId: "chat-1",
        userId: "user-1",
        answer: "Use the Istanbul list",
      });
      const call = vi.mocked(streamText).mock.calls.at(-1)![0] as {
        stopWhen: unknown[];
      };
      expect(call.stopWhen).toContain("hasToolCall:ask_operator");
    });

    it("uses persisted tool messages and skips saving Continue after approval", async () => {
      setupOperatorHappyPath();
      vi.mocked(getChatHistory).mockResolvedValue([
        {
          id: "msg-1",
          chatId: "chat-1",
          role: "user",
          content: "fetch user 123",
          metadata: null,
          createdAt: new Date("2026-08-28T10:00:00.000Z"),
        },
        {
          id: "msg-3",
          chatId: "chat-1",
          role: "tool",
          content: JSON.stringify({ ok: true, status: 200, body: '{"id":"123"}' }),
          metadata: null,
          createdAt: new Date("2026-08-28T10:00:02.000Z"),
        },
      ] as never);

      const res = await handleInternalChat({
        kind: "operator",
        chatId: "chat-1",
        userId: "user-1",
        messages: [makeUIMessage("user", "Continue.")],
      });

      expect(res.status).toBe(200);
      expect(saveUserMessage).not.toHaveBeenCalled();
      expect(convertToModelMessages).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            parts: expect.arrayContaining([
              expect.objectContaining({
                type: "dynamic-tool",
                output: { ok: true, status: 200, body: '{"id":"123"}' },
              }),
            ]),
          }),
        ]),
      );
      expect(streamText).toHaveBeenCalled();
    });
  });

  describe("retired master kind", () => {
    it("returns 400 and never streams", async () => {
      const res = await handleInternalChat({
        kind: "master" as never,
        chatId: "chat-1",
        userId: "user-1",
        messages: [makeUIMessage("user", "hello")],
      });
      expect(res.status).toBe(400);
      expect(streamText).not.toHaveBeenCalled();
    });
  });

  describe("widget kind", () => {
    it("returns 400 when messages is empty", async () => {
      const res = await handleInternalChat({
        kind: "widget",
        companyId: "company-1",
        visitorId: "visitor-1",
        messages: [],
      });
      expect(res.status).toBe(400);
      const json = (await res.json()) as { error: string };
      expect(json.error).toContain("Messages are required");
    });

    it("returns 404 when company not found", async () => {
      vi.mocked(db.query.companies.findFirst).mockResolvedValue(undefined);

      const res = await handleInternalChat({
        kind: "widget",
        companyId: "nonexistent",
        visitorId: "visitor-1",
        messages: [makeUIMessage("user", "hello")],
      });
      expect(res.status).toBe(404);
      const json = (await res.json()) as { error: string };
      expect(json.error).toBe("Widget not found");
    });

    it("returns streaming response on success", async () => {
      setupWidgetHappyPath();

      const res = await handleInternalChat({
        kind: "widget",
        companyId: "company-1",
        visitorId: "visitor-1",
        messages: [makeUIMessage("user", "hello")],
      });
      expect(res.status).toBe(200);
      expect(streamText).toHaveBeenCalled();
      expect(getModel).toHaveBeenCalledWith("haiku");
    });

    it("creates a chat session when visitorId is provided but chatId is not", async () => {
      setupWidgetHappyPath();

      await handleInternalChat({
        kind: "widget",
        companyId: "company-1",
        messages: [makeUIMessage("user", "hello")],
        visitorId: "visitor-1",
      });
      expect(createChatSession).toHaveBeenCalledWith(
        null,
        "company-1",
        "agent-1",
        "Widget Chat",
        "visitor-1",
        "widget",
      );
    });

    it("sets X-Chat-Id header when chatId is available", async () => {
      setupWidgetHappyPath();
      vi.mocked(db.query.chats.findFirst).mockResolvedValue(
        ownWidgetChat as never,
      );

      const res = await handleInternalChat({
        kind: "widget",
        companyId: "company-1",
        visitorId: "visitor-1",
        messages: [makeUIMessage("user", "hi")],
        chatId: "chat-1",
      });
      expect(res.headers.get("X-Chat-Id")).toBe("chat-1");
    });

    it("does not use operator agents when only operator agents exist", async () => {
      setupWidgetHappyPath();
      vi.mocked(db.query.agents.findMany).mockResolvedValue([
        { ...mockAgent, id: "operator-1", kind: "operator" },
      ] as never);
      vi.mocked(selectTools).mockReturnValue({ shopify: {} } as never);

      const res = await handleInternalChat({
        kind: "widget",
        companyId: "company-1",
        visitorId: "visitor-1",
        messages: [makeUIMessage("user", "hello")],
      });
      expect(res.status).toBe(200);
      expect(selectTools).not.toHaveBeenCalled();
      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({ tools: {} }),
      );
    });

    it("gives tool selection the agent id and the agent's channels", async () => {
      setupWidgetHappyPath();
      vi.mocked(db.query.channels.findMany).mockResolvedValue([
        whatsappChannelRow,
      ] as never);

      await handleInternalChat({
        kind: "widget",
        companyId: "company-1",
        visitorId: "visitor-1",
        messages: [makeUIMessage("user", "hello")],
      });

      expect(selectTools).toHaveBeenCalledWith(
        [],
        "agent-1",
        [whatsappChannelRow],
        expect.objectContaining({ allowSendTools: false }),
      );
    });

    // The widget is embedded on a public page: whoever opens it is a stranger,
    // and a send tool here would let them dictate a message sent from the
    // business's own verified WhatsApp number.
    it("never asks for send tools, even with a fully configured channel", async () => {
      setupWidgetHappyPath();
      vi.mocked(db.query.channels.findMany).mockResolvedValue([
        whatsappChannelRow,
      ] as never);

      await handleInternalChat({
        kind: "widget",
        companyId: "company-1",
        visitorId: "visitor-1",
        messages: [makeUIMessage("user", "hello")],
      });

      const options = vi.mocked(selectTools).mock.calls[0]?.[3];
      expect(options?.allowSendTools).not.toBe(true);
    });

    it("binds record_lead to the agent, the company and the created chat", async () => {
      setupWidgetHappyPath();

      await handleInternalChat({
        kind: "widget",
        companyId: "company-1",
        visitorId: "visitor-1",
        messages: [makeUIMessage("user", "hello")],
      });

      const leadCapture = vi.mocked(selectTools).mock.calls[0]?.[3]?.leadCapture;
      expect(leadCapture).toMatchObject({
        agentId: "agent-1",
        companyId: "company-1",
      });
      expect(leadCapture?.getChatId()).toBe("chat-new");
    });

    describe("client-supplied chatId", () => {
      // The widget is public: the chatId in the body is whatever the browser
      // sent. It is only used when the chat really is this visitor's widget
      // chat with this company and agent; otherwise it is dropped and a new
      // session starts, so no message or lead can land on someone else's chat.
      it("looks the chat up by id and company", async () => {
        setupWidgetHappyPath();
        vi.mocked(db.query.chats.findFirst).mockResolvedValue(
          ownWidgetChat as never,
        );

        await sendWidget("chat-1");

        const where = vi.mocked(db.query.chats.findFirst).mock.calls[0]?.[0]
          ?.where;
        expect(collectColumnNames(where)).toEqual(
          expect.arrayContaining(["id", "company_id"]),
        );
      });

      it("uses a chat that is this visitor's widget chat", async () => {
        setupWidgetHappyPath();
        vi.mocked(db.query.chats.findFirst).mockResolvedValue(
          ownWidgetChat as never,
        );

        const res = await sendWidget("chat-1");
        await finishStream("answer");

        expect(createChatSession).not.toHaveBeenCalled();
        expect(saveUserMessage).toHaveBeenCalledWith("chat-1", "hello");
        expect(saveAssistantMessage).toHaveBeenCalledWith("chat-1", "answer");
        expect(res.headers.get("X-Chat-Id")).toBe("chat-1");
        const leadCapture = vi.mocked(selectTools).mock.calls[0]?.[3]?.leadCapture;
        expect(leadCapture?.getChatId()).toBe("chat-1");
      });

      it.each([
        ["does not exist", undefined],
        ["belongs to another company", { ...ownWidgetChat, companyId: "company-2" }],
        ["is not a widget chat", { ...ownWidgetChat, channelType: "whatsapp" }],
        ["belongs to another visitor", { ...ownWidgetChat, visitorId: "visitor-2" }],
        ["belongs to another agent", { ...ownWidgetChat, agentId: "agent-2" }],
      ])("drops a chat that %s and starts a new session", async (_label, chat) => {
        setupWidgetHappyPath();
        vi.mocked(db.query.chats.findFirst).mockResolvedValue(chat as never);

        const res = await sendWidget("chat-foreign");
        await finishStream("answer");

        expect(createChatSession).toHaveBeenCalledWith(
          null,
          "company-1",
          "agent-1",
          "Widget Chat",
          "visitor-1",
          "widget",
        );
        expect(saveUserMessage).not.toHaveBeenCalledWith(
          "chat-foreign",
          expect.anything(),
        );
        expect(saveAssistantMessage).not.toHaveBeenCalledWith(
          "chat-foreign",
          expect.anything(),
        );
        expect(saveUserMessage).toHaveBeenCalledWith("chat-new", "hello");
        expect(saveAssistantMessage).toHaveBeenCalledWith("chat-new", "answer");
        expect(res.headers.get("X-Chat-Id")).toBe("chat-new");
        const leadCapture = vi.mocked(selectTools).mock.calls[0]?.[3]?.leadCapture;
        expect(leadCapture?.getChatId()).toBe("chat-new");
      });
    });
  });
});

function sendWidget(chatId: string) {
  return handleInternalChat({
    kind: "widget",
    companyId: "company-1",
    visitorId: "visitor-1",
    chatId,
    messages: [makeUIMessage("user", "hello")],
  });
}

/** Run the onFinish the handler gave streamText, as the stream end would. */
async function finishStream(text: string) {
  const options = vi.mocked(streamText).mock.calls.at(-1)?.[0] as unknown as {
    onFinish: (event: { text: string; usage: { totalTokens: number } }) => unknown;
  };
  await options.onFinish({ text, usage: { totalTokens: 0 } });
}

describe("handleInternalChat human handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(loadHandoffRuntime).mockResolvedValue(handoffRuntime());
  });

  it("stores the visitor's message but does not run the agent during a takeover", async () => {
    setupWidgetHappyPath();
    vi.mocked(db.query.chats.findFirst).mockResolvedValue(ownWidgetChat as never);
    vi.mocked(loadHandoffRuntime).mockResolvedValue(handoffRuntime(true));

    const res = await handleInternalChat({
      kind: "widget",
      companyId: "company-1",
      visitorId: "visitor-1",
      messages: [makeUIMessage("user", "are you there?")],
      chatId: "chat-1",
    });

    expect(saveUserMessage).toHaveBeenCalledWith("chat-1", "are you there?");
    expect(streamText).not.toHaveBeenCalled();
    expect(res.headers.get("X-Handoff-State")).toBe("taken_over");
    expect(res.headers.get("X-Chat-Id")).toBe("chat-1");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  it("offers ask_human to the public widget, bound to the widget chat", async () => {
    setupWidgetHappyPath();

    await handleInternalChat({
      kind: "widget",
      companyId: "company-1",
      visitorId: "visitor-1",
      messages: [makeUIMessage("user", "I want a refund")],
    });

    const options = vi.mocked(selectTools).mock.calls[0]?.[3];
    expect(options?.allowSendTools).toBe(false);
    expect(options?.askHuman).toMatchObject({ agentId: "agent-1", companyId: "company-1" });
    expect(options?.askHuman?.getChatId()).toBe("chat-new");
  });

  it("pauses the dashboard test chat during a takeover too", async () => {
    setupCustomerHappyPath();
    vi.mocked(db.query.agents.findFirst).mockResolvedValue(mockAgent as never);
    vi.mocked(db.query.knowledgeBase.findMany).mockResolvedValue([]);
    vi.mocked(db.query.channels.findMany).mockResolvedValue([]);
    vi.mocked(loadHandoffRuntime).mockResolvedValue(handoffRuntime(true));

    const res = await handleInternalChat({
      kind: "customer",
      companyId: "company-1",
      agentId: "agent-1",
      userId: "user-1",
      chatId: "chat-1",
      messages: [makeUIMessage("user", "hello")],
    });

    expect(streamText).not.toHaveBeenCalled();
    expect(res.headers.get("X-Handoff-State")).toBe("taken_over");
  });
});
