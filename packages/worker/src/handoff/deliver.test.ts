import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  sendMessage: vi.fn(),
  messagesFindFirst: vi.fn(),
  chatsFindFirst: vi.fn(),
  companiesFindFirst: vi.fn(),
  channelsFindFirst: vi.fn(),
  metadataUpdate: vi.fn(),
}));

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      update: () => ({ set: (v: unknown) => ({ where: async () => m.metadataUpdate(v) }) }),
      query: {
        messages: { findFirst: m.messagesFindFirst },
        chats: { findFirst: m.chatsFindFirst },
        companies: { findFirst: m.companiesFindFirst },
        channels: { findFirst: m.channelsFindFirst },
      },
    },
  };
});
vi.mock("../integrations/messaging", () => ({
  sendMessage: (...a: unknown[]) => m.sendMessage(...a),
}));

import { deliverHumanMessage, personPrefix } from "./deliver";

function humanMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "msg-1",
    chatId: "chat-1",
    role: "assistant",
    author: "human",
    authorDisplayName: "Markus Albrecht",
    content: "The price is 1,200 EUR.",
    metadata: null,
    ...overrides,
  };
}

function chat(channelType: string, visitorId = "4915100000") {
  return { id: "chat-1", companyId: "company-1", agentId: "agent-1", channelType, visitorId };
}

beforeEach(() => {
  vi.clearAllMocks();
  m.messagesFindFirst.mockResolvedValue(humanMessage());
  m.companiesFindFirst.mockResolvedValue({ id: "company-1", name: "Acme" });
  m.sendMessage.mockResolvedValue({ success: true, messageId: "wamid.1", error: null });
});

describe("personPrefix", () => {
  it("uses the first name and the company", () => {
    expect(personPrefix("Markus Albrecht", "Acme")).toBe("Markus (Acme): ");
    expect(personPrefix("  Team ", "Acme GmbH")).toBe("Team (Acme GmbH): ");
  });
});

describe("deliverHumanMessage", () => {
  it("sends a WhatsApp message with the person prefix and records the wamid", async () => {
    m.chatsFindFirst.mockResolvedValue(chat("whatsapp"));
    m.channelsFindFirst.mockResolvedValue({
      id: "ch-1",
      config: { phoneNumberId: "pn-1", accessToken: "tok" },
    });

    expect(await deliverHumanMessage("msg-1")).toBe("sent");
    expect(m.sendMessage).toHaveBeenCalledWith(
      "whatsapp",
      "4915100000",
      "Markus (Acme): The price is 1,200 EUR.",
      { phoneNumberId: "pn-1", accessToken: "tok" },
    );
    expect(m.metadataUpdate).toHaveBeenCalledTimes(1);
  });

  it("sends on Instagram with the account credentials", async () => {
    m.chatsFindFirst.mockResolvedValue(chat("instagram", "igsid-1"));
    m.channelsFindFirst.mockResolvedValue({
      id: "ch-2",
      config: { accountId: "acc-1", accessToken: "tok" },
    });

    expect(await deliverHumanMessage("msg-1")).toBe("sent");
    expect(m.sendMessage).toHaveBeenCalledWith(
      "instagram",
      "igsid-1",
      "Markus (Acme): The price is 1,200 EUR.",
      { accountId: "acc-1", accessToken: "tok" },
    );
  });

  it("sends on Messenger through the page credentials", async () => {
    m.chatsFindFirst.mockResolvedValue(chat("messenger", "psid-1"));
    m.channelsFindFirst.mockResolvedValue({
      id: "ch-3",
      config: { pageId: "page-1", accessToken: "tok" },
    });

    expect(await deliverHumanMessage("msg-1")).toBe("sent");
    expect(m.sendMessage).toHaveBeenCalledWith(
      "facebook",
      "psid-1",
      "Markus (Acme): The price is 1,200 EUR.",
      { pageId: "page-1", accessToken: "tok" },
    );
  });

  it("leaves widget messages stored for the widget to pick up", async () => {
    m.chatsFindFirst.mockResolvedValue(chat("widget", "203.0.113.9"));

    expect(await deliverHumanMessage("msg-1")).toBe("stored");
    expect(m.sendMessage).not.toHaveBeenCalled();
  });

  it("never sends a message twice", async () => {
    m.messagesFindFirst.mockResolvedValue(
      humanMessage({ metadata: { platformMessageId: "wamid.0" } }),
    );

    expect(await deliverHumanMessage("msg-1")).toBe("already_sent");
    expect(m.chatsFindFirst).not.toHaveBeenCalled();
    expect(m.sendMessage).not.toHaveBeenCalled();
  });

  it("refuses rows that are not a person's message", async () => {
    m.messagesFindFirst.mockResolvedValue(humanMessage({ author: null }));
    expect(await deliverHumanMessage("msg-1")).toBe("not_found");

    m.messagesFindFirst.mockResolvedValue(undefined);
    expect(await deliverHumanMessage("msg-x")).toBe("not_found");
    expect(m.sendMessage).not.toHaveBeenCalled();
  });

  it("reports failure when the channel has no credentials", async () => {
    m.chatsFindFirst.mockResolvedValue(chat("whatsapp"));
    m.channelsFindFirst.mockResolvedValue(undefined);

    expect(await deliverHumanMessage("msg-1")).toBe("failed");
    expect(m.sendMessage).not.toHaveBeenCalled();
    expect(m.metadataUpdate).not.toHaveBeenCalled();
  });

  it("reports failure when the platform rejects the send", async () => {
    m.chatsFindFirst.mockResolvedValue(chat("whatsapp"));
    m.channelsFindFirst.mockResolvedValue({
      id: "ch-1",
      config: { phoneNumberId: "pn-1", accessToken: "tok" },
    });
    m.sendMessage.mockResolvedValue({ success: false, messageId: null, error: "window closed" });

    expect(await deliverHumanMessage("msg-1")).toBe("failed");
    expect(m.metadataUpdate).not.toHaveBeenCalled();
  });
});

describe("enqueueHumanMessageDelivery", () => {
  it("rejects ids that are not a person's message without touching the queue", async () => {
    const { enqueueHumanMessageDelivery } = await import("./deliver");
    expect(await enqueueHumanMessageDelivery("not-a-uuid")).toBe(false);
    expect(m.messagesFindFirst).not.toHaveBeenCalled();

    m.messagesFindFirst.mockResolvedValue(humanMessage({ author: "agent" }));
    expect(await enqueueHumanMessageDelivery("6f1c2a52-3a7e-4c41-9a43-1b2c3d4e5f60")).toBe(false);
  });

  it("queues a person's message and delivers it", async () => {
    const { enqueueHumanMessageDelivery } = await import("./deliver");
    m.chatsFindFirst.mockResolvedValue(chat("whatsapp"));
    m.channelsFindFirst.mockResolvedValue({
      id: "ch-1",
      config: { phoneNumberId: "pn-1", accessToken: "tok" },
    });

    expect(await enqueueHumanMessageDelivery("6f1c2a52-3a7e-4c41-9a43-1b2c3d4e5f60")).toBe(true);
    await vi.waitFor(() => expect(m.sendMessage).toHaveBeenCalledTimes(1));
  });
});
