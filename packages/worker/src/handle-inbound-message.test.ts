import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbInsert, dbTransaction, insertValues, agentQuestionsFindFirst, recordFirstResponse } =
  vi.hoisted(() => ({
    dbInsert: vi.fn(),
    dbTransaction: vi.fn(),
    insertValues: vi.fn(),
    agentQuestionsFindFirst: vi.fn(),
    recordFirstResponse: vi.fn(),
  }));

const {
  selectTools,
  dbMessagesToUIMessages,
  generateText,
  sendMessage,
  saveAssistantMessage,
  getChatHistory,
  checkTokenBudget,
  recordTokenUsage,
  updateWhere,
  updateSet,
  channelsFindFirst,
  chatsFindFirst,
  agentsFindFirst,
  companiesFindFirst,
} = vi.hoisted(() => {
  const updateWhere = vi.fn();
  return {
    selectTools: vi.fn((..._args: unknown[]) => ({}) as Record<string, unknown>),
    dbMessagesToUIMessages: vi.fn((..._args: unknown[]) => []),
    generateText: vi.fn(),
    sendMessage: vi.fn(),
    saveAssistantMessage: vi.fn(async (..._args: unknown[]) => "message-1"),
    getChatHistory: vi.fn(
      async (..._args: unknown[]) =>
        [] as { id: string; role: string; content: string }[],
    ),
    checkTokenBudget: vi.fn(async (..._args: unknown[]) => ({ allowed: true })),
    recordTokenUsage: vi.fn(),
    updateWhere,
    updateSet: vi.fn(() => ({ where: updateWhere })),
    channelsFindFirst: vi.fn(),
    chatsFindFirst: vi.fn(),
    agentsFindFirst: vi.fn(),
    companiesFindFirst: vi.fn(),
  };
});

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: (...args: unknown[]) => generateText(...args),
    convertToModelMessages: () => [],
  };
});

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      query: {
        channels: { findFirst: channelsFindFirst, findMany: vi.fn(async () => []) },
        chats: { findFirst: chatsFindFirst },
        agents: { findFirst: agentsFindFirst },
        companies: { findFirst: companiesFindFirst },
        integrations: { findMany: vi.fn(async () => []) },
        knowledgeBase: { findMany: vi.fn(async () => []) },
        agentQuestions: { findFirst: agentQuestionsFindFirst },
      },
      update: vi.fn(() => ({ set: updateSet })),
      insert: dbInsert,
      transaction: dbTransaction,
    },
  };
});

vi.mock("./ai/provider", () => ({ getModel: vi.fn(() => "mock-model") }));
vi.mock("./ai/system-prompt", () => ({
  buildSystemPrompt: (...a: unknown[]) => buildSystemPromptMock(...a),
}));
vi.mock("./ai/tools", () => ({
  selectTools: (...a: unknown[]) => selectTools(...a),
}));
vi.mock("./operator/messages", () => ({
  dbMessagesToUIMessages: (...a: unknown[]) => dbMessagesToUIMessages(...a),
}));
vi.mock("./ai/chat-persistence", () => ({
  getChatHistory: (...a: unknown[]) => getChatHistory(...a),
  saveAssistantMessage: (...a: unknown[]) => saveAssistantMessage(...a),
}));
vi.mock("./ai/token-limiter", () => ({
  checkTokenBudget: (...a: unknown[]) => checkTokenBudget(...a),
  recordTokenUsage: (...a: unknown[]) => recordTokenUsage(...a),
}));
vi.mock("./integrations/messaging", () => ({
  sendMessage: (...a: unknown[]) => sendMessage(...a),
}));
vi.mock("./leads/first-response", () => ({
  recordFirstResponse: (...a: unknown[]) => recordFirstResponse(...a),
}));

const { loadHandoffRuntime, isChatTakenOver, buildSystemPromptMock } = vi.hoisted(() => ({
  loadHandoffRuntime: vi.fn(),
  isChatTakenOver: vi.fn(),
  buildSystemPromptMock: vi.fn((..._args: unknown[]) => "system"),
}));
vi.mock("./handoff/runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./handoff/runtime")>();
  return {
    ...actual,
    loadHandoffRuntime: (...a: unknown[]) => loadHandoffRuntime(...a),
  };
});
vi.mock("./handoff/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./handoff/store")>();
  return {
    ...actual,
    isChatTakenOver: (...a: unknown[]) => isChatTakenOver(...a),
  };
});

import { eq } from "drizzle-orm";
import { messages } from "@relay/db";
import { enqueueInboundRun, runInboundMessage } from "./handle-inbound-message";
import { defaultHandoffSettings } from "./handoff/store";

function handoffRuntime(overrides: Record<string, unknown> = {}) {
  return {
    settings: defaultHandoffSettings({ id: "agent-1", companyId: "company-1" }),
    latest: null,
    takeoverMessages: [],
    paused: false,
    ...overrides,
  };
}

const REQUEST = {
  platform: "whatsapp" as const,
  chatId: "chat-1",
  channelId: "channel-1",
};

beforeEach(() => {
  vi.clearAllMocks();
  selectTools.mockReturnValue({});
  dbMessagesToUIMessages.mockReturnValue([]);
  getChatHistory.mockResolvedValue([]);
  channelsFindFirst.mockResolvedValue({
    id: "channel-1",
    agentId: "agent-1",
    type: "whatsapp",
    status: "active",
    config: {
      phoneNumberId: "106540352242922",
      accessToken: "EAAtoken",
      autoReply: true,
    },
  });
  chatsFindFirst.mockResolvedValue({
    id: "chat-1",
    companyId: "company-1",
    agentId: "agent-1",
    visitorId: "905551112233",
  });
  agentsFindFirst.mockResolvedValue({
    id: "agent-1",
    companyId: "company-1",
    kind: "customer",
    model: "sonnet",
    leadCaptureEnabled: true,
    leadCaptureWorkflowId: null,
  });
  companiesFindFirst.mockResolvedValue({ id: "company-1", name: "Acme" });
  generateText.mockResolvedValue({
    text: "Kargonuz yarin cikiyor.",
    usage: { totalTokens: 1200 },
  });
  sendMessage.mockResolvedValue({
    success: true,
    messageId: "wamid.OUT",
    error: null,
    platform: "whatsapp",
  });
  checkTokenBudget.mockResolvedValue({ allowed: true });
  loadHandoffRuntime.mockResolvedValue(handoffRuntime());
  isChatTakenOver.mockResolvedValue(false);
  dbInsert.mockReturnValue({ values: insertValues });
  insertValues.mockResolvedValue(undefined);
  agentQuestionsFindFirst.mockResolvedValue(undefined);
  recordFirstResponse.mockResolvedValue(undefined);
});

/**
 * The JSON parameters inside a Drizzle `SQL` value. The metadata write is a
 * jsonb merge now, so the patch is a parameter rather than a plain object.
 * The walk keeps a seen-set because column references point back at tables.
 */
function jsonParamsOf(node: unknown): unknown[] {
  const seen = new Set<unknown>();
  const found: unknown[] = [];
  const walk = (value: unknown) => {
    if (typeof value === "string" && value.startsWith("{")) {
      try {
        found.push(JSON.parse(value));
      } catch {
        // not JSON, ignore
      }
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    Object.values(value).forEach(walk);
  };
  walk(node);
  return found;
}

describe("runInboundMessage", () => {
  it("saves the reply before sending it", async () => {
    const order: string[] = [];
    saveAssistantMessage.mockImplementation(async () => {
      order.push("save");
      return "message-1";
    });
    sendMessage.mockImplementation(async () => {
      order.push("send");
      return { success: true, messageId: "wamid.OUT", error: null, platform: "whatsapp" };
    });

    await runInboundMessage(REQUEST);

    expect(order).toEqual(["save", "send"]);
  });

  it("sends to the chat's visitor with the channel's credentials", async () => {
    await runInboundMessage(REQUEST);

    expect(sendMessage).toHaveBeenCalledWith(
      "whatsapp",
      "905551112233",
      "Kargonuz yarin cikiyor.",
      { phoneNumberId: "106540352242922", accessToken: "EAAtoken" },
    );
  });

  it("records the returned platform id on the saved reply", async () => {
    await runInboundMessage(REQUEST);

    // Merged, not replaced: a delivery-status webhook writes status fields
    // onto this same row, and saveAssistantMessage may have written its own.
    const written = (updateSet.mock.calls[0] as unknown as [{ metadata: unknown }])[0].metadata;
    expect(written).not.toEqual({ platformMessageId: "wamid.OUT" });
    expect(jsonParamsOf(written)).toContainEqual({
      platformMessageId: "wamid.OUT",
    });
    // Pinned to the saved message: patching the wrong row would otherwise pass.
    expect(updateWhere).toHaveBeenCalledWith(eq(messages.id, "message-1"));
  });

  it("hides the outbound send tools from an untrusted inbound sender", async () => {
    selectTools.mockReturnValue({
      searchKnowledgeBase: { description: "kb" },
      listInstagramComments: { description: "list" },
      sendPlatformMessage: { description: "send" },
      replyToInstagramComment: { description: "reply" },
      sendInstagramPrivateReply: { description: "private" },
    });

    await runInboundMessage(REQUEST);

    const tools = (generateText.mock.calls[0][0] as { tools: object }).tools;
    expect(Object.keys(tools)).not.toContain("sendPlatformMessage");
    expect(Object.keys(tools)).not.toContain("replyToInstagramComment");
    expect(Object.keys(tools)).not.toContain("sendInstagramPrivateReply");
    expect(Object.keys(tools)).toContain("searchKnowledgeBase");
    expect(Object.keys(tools)).toContain("listInstagramComments");
  });

  it("binds record_lead to the chat's agent, company, the chat and the legacy intake", async () => {
    await runInboundMessage(REQUEST);

    const options = selectTools.mock.calls[0][3] as {
      leadCapture?: {
        agentId: string;
        companyId: string;
        getChatId: () => string | null;
        intake: { key: string }[];
      };
    };
    expect(options.leadCapture).toMatchObject({
      agentId: "agent-1",
      companyId: "company-1",
    });
    expect(options.leadCapture?.getChatId()).toBe("chat-1");
    expect(options.leadCapture?.intake.map((f) => f.key)).toEqual([
      "tip",
      "m2",
      "lokasyon",
      "butce",
      "iletisim",
    ]);
  });

  it("offers no record_lead when the agent's Lead capture is off", async () => {
    agentsFindFirst.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      kind: "customer",
      model: "sonnet",
      leadCaptureEnabled: false,
      leadCaptureWorkflowId: null,
    });

    await runInboundMessage(REQUEST);

    const options = selectTools.mock.calls[0][3] as { leadCapture?: unknown };
    expect(options.leadCapture).toBeUndefined();
  });

  // Decision 9: a lead exists only because the agent called record_lead.
  // Answering a support question writes the reply and nothing else.
  it("never creates a lead for a support chat the agent just answers", async () => {
    await runInboundMessage(REQUEST);

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(dbInsert).not.toHaveBeenCalled();
    expect(dbTransaction).not.toHaveBeenCalled();
  });

  it("feeds the model only the most recent 40 messages", async () => {
    const history = Array.from({ length: 45 }, (_, i) => ({
      id: `m-${i}`,
      role: "user",
      content: `msg ${i}`,
    }));
    getChatHistory.mockResolvedValue(history);

    await runInboundMessage(REQUEST);

    const passed = dbMessagesToUIMessages.mock.calls[0][0] as typeof history;
    expect(passed).toHaveLength(40);
    expect(passed[0].id).toBe("m-5");
    expect(passed[39].id).toBe("m-44");
  });

  // A blind slice(-40) of an alternating thread starts on an assistant row:
  // the just-persisted inbound turn is last, so the total is odd and the cut
  // offset is odd too. The Messages API rejects an assistant-first array with
  // a 400 that the fire-and-forget queue swallows, so the customer would
  // silently never get a reply.
  it("starts the window on a user turn, never an assistant one", async () => {
    const history = Array.from({ length: 45 }, (_, i) => ({
      id: `m-${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      content: `msg ${i}`,
    }));
    getChatHistory.mockResolvedValue(history);

    await runInboundMessage(REQUEST);

    const passed = dbMessagesToUIMessages.mock.calls[0][0] as typeof history;
    expect(passed[0].role).toBe("user");
    // m-45 would be the inbound turn; m-44 is the last stored row and is a
    // user turn, so the alternation matches the real ascending history.
    expect(passed[0].id).toBe("m-6");
    expect(passed).toHaveLength(39);
  });

  it("bills the channel, not a user", async () => {
    await runInboundMessage(REQUEST);

    expect(checkTokenBudget).toHaveBeenCalledWith("channel-1", "channel");
    expect(recordTokenUsage).toHaveBeenCalledWith("channel-1", "channel", 1200);
  });

  it("skips the run when the channel's weekly budget is spent", async () => {
    checkTokenBudget.mockResolvedValue({ allowed: false });

    await runInboundMessage(REQUEST);

    expect(generateText).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("sends nothing when the model produced no text", async () => {
    generateText.mockResolvedValue({ text: "   ", usage: { totalTokens: 10 } });

    await runInboundMessage(REQUEST);

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("keeps the saved reply when the send fails", async () => {
    sendMessage.mockResolvedValue({
      success: false,
      messageId: null,
      error: "rejected",
      platform: "whatsapp",
    });

    await runInboundMessage(REQUEST);

    expect(saveAssistantMessage).toHaveBeenCalled();
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("does nothing for an inactive channel", async () => {
    channelsFindFirst.mockResolvedValue({
      id: "channel-1",
      agentId: "agent-1",
      type: "whatsapp",
      status: "inactive",
      config: {},
    });

    await runInboundMessage(REQUEST);

    expect(generateText).not.toHaveBeenCalled();
  });

  // The queue can be deep, so the flag that was on when this run was queued
  // may be off by the time it reaches the front. Same rule the comment path
  // already follows.
  it("does nothing when auto-reply was switched off while the run waited", async () => {
    channelsFindFirst.mockResolvedValue({
      id: "channel-1",
      agentId: "agent-1",
      type: "whatsapp",
      status: "active",
      config: { phoneNumberId: "106540352242922", accessToken: "EAAtoken" },
    });

    await runInboundMessage(REQUEST);

    expect(generateText).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  // The web route derives both ids from one channel lookup today, but this is
  // the entry point's own check: a caller that paired them wrongly would
  // otherwise answer one company's customer out of another company's number.
  it("refuses a chat that belongs to another agent", async () => {
    chatsFindFirst.mockResolvedValue({
      id: "chat-1",
      companyId: "company-1",
      agentId: "agent-2",
      visitorId: "905551112233",
    });

    await runInboundMessage(REQUEST);

    expect(generateText).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  // The doc comment promises this; the queue only logs a generic label, so a
  // failure that escaped would say nothing about which chat went unanswered.
  it("raises one open agent question when the model call throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    generateText.mockRejectedValue(new Error("anthropic is down secret-xyz"));

    await runInboundMessage(REQUEST);

    expect(dbInsert).toHaveBeenCalledTimes(1);
    expect(insertValues).toHaveBeenCalledTimes(1);
    const row = insertValues.mock.calls[0][0];
    expect(row).toMatchObject({
      companyId: "company-1",
      agentId: "agent-1",
      chatId: "chat-1",
      question: "Karşılama ajanı bir mesaja yanıt veremedi. Sohbeti açıp elle yanıtla.",
      suggestedAnswers: [],
      status: "open",
    });
    expect(JSON.stringify(row)).not.toContain("secret-xyz");
  });

  it("does not raise a second question while one is open for the chat", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    agentQuestionsFindFirst.mockResolvedValue({ id: "q-open" });
    generateText.mockRejectedValue(new Error("down again"));

    await runInboundMessage(REQUEST);

    expect(dbInsert).not.toHaveBeenCalled();
  });

  it("records the first response once after a successful send", async () => {
    await runInboundMessage(REQUEST);
    expect(recordFirstResponse).toHaveBeenCalledTimes(1);
    expect(recordFirstResponse).toHaveBeenCalledWith("chat-1");
  });

  it("swallows and logs a failure instead of rejecting", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    generateText.mockRejectedValue(new Error("anthropic is down"));

    await expect(runInboundMessage(REQUEST)).resolves.toBeUndefined();
    expect(logged).toHaveBeenCalled();

    logged.mockRestore();
  });

  it("does nothing for an operator agent", async () => {
    agentsFindFirst.mockResolvedValue({
      id: "agent-1",
      companyId: "company-1",
      kind: "operator",
      model: "sonnet",
    });

    await runInboundMessage(REQUEST);

    expect(generateText).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("uses the Instagram account id when the platform is instagram", async () => {
    channelsFindFirst.mockResolvedValue({
      id: "channel-1",
      agentId: "agent-1",
      type: "instagram",
      status: "active",
      config: {
        accountId: "17841400000000000",
        accessToken: "IGQVJtoken",
        autoReply: true,
      },
    });
    chatsFindFirst.mockResolvedValue({
      id: "chat-1",
      companyId: "company-1",
      agentId: "agent-1",
      visitorId: "9876543210",
    });

    await runInboundMessage({ ...REQUEST, platform: "instagram" });

    expect(sendMessage).toHaveBeenCalledWith(
      "instagram",
      "9876543210",
      "Kargonuz yarin cikiyor.",
      { accountId: "17841400000000000", accessToken: "IGQVJtoken" },
    );
  });
});

describe("runInboundMessage human handoff", () => {
  it("stays quiet while a person has taken over", async () => {
    loadHandoffRuntime.mockResolvedValue(handoffRuntime({ paused: true }));

    await runInboundMessage(REQUEST);

    expect(generateText).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("drops the reply when a takeover starts during the run", async () => {
    isChatTakenOver.mockResolvedValue(true);

    await runInboundMessage(REQUEST);

    expect(generateText).toHaveBeenCalled();
    expect(saveAssistantMessage).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("offers ask_human bound to this chat when a trigger is on", async () => {
    await runInboundMessage(REQUEST);

    const options = selectTools.mock.calls[0][3] as {
      askHuman?: { agentId: string; companyId: string; getChatId: () => string | null };
    };
    expect(options.askHuman?.agentId).toBe("agent-1");
    expect(options.askHuman?.companyId).toBe("company-1");
    expect(options.askHuman?.getChatId()).toBe("chat-1");
  });

  it("does not offer ask_human when every trigger is off", async () => {
    const settings = {
      ...defaultHandoffSettings({ id: "agent-1", companyId: "company-1" }),
      triggerPriceNotListed: false,
      triggerAsksForPerson: false,
      triggerComplaintOrRefund: false,
      triggerLowConfidence: false,
    };
    loadHandoffRuntime.mockResolvedValue(handoffRuntime({ settings }));

    await runInboundMessage(REQUEST);

    const options = selectTools.mock.calls[0][3] as { askHuman?: unknown };
    expect(options.askHuman).toBeUndefined();
  });

  it("writes the enabled triggers into the prompt", async () => {
    await runInboundMessage(REQUEST);

    const input = buildSystemPromptMock.mock.calls[0][0] as { handoffSection: string };
    expect(input.handoffSection).toContain("less than 60% confident");
    expect(input.handoffSection).toContain("talk to a person");
  });
});

describe("enqueueInboundRun", () => {
  it("runs two messages for one chat in sequence, not in parallel", async () => {
    let active = 0;
    let maxActive = 0;
    generateText.mockImplementation(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { text: "ok", usage: { totalTokens: 1 } };
    });

    enqueueInboundRun(REQUEST);
    enqueueInboundRun(REQUEST);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(generateText).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
  });

  it("does not reject when a run throws", async () => {
    generateText.mockRejectedValue(new Error("model down"));

    expect(() => enqueueInboundRun(REQUEST)).not.toThrow();
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
});
