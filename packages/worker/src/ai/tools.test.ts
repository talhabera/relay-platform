import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAllTools, selectTools, type AgentChannelSummary } from "./tools";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const AGENT_ID = "11111111-1111-1111-1111-111111111111";

const findFirst = vi.fn();

// The real table definitions are kept and only `db` is replaced: the channel
// scoping test reads the built `where`, which needs actual Drizzle columns to
// carry the names it asserts on.
vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      query: { channels: { findFirst: (args: unknown) => findFirst(args) } },
    },
  };
});

/** An active WhatsApp channel with complete credentials. */
function whatsappChannel(
  overrides: Partial<AgentChannelSummary> = {},
): AgentChannelSummary {
  return {
    type: "whatsapp",
    status: "active",
    config: { phoneNumberId: "123456789012345", accessToken: "EAAGtoken" },
    ...overrides,
  };
}

/** An active Instagram channel with complete credentials. */
function instagramChannel(
  overrides: Partial<AgentChannelSummary> = {},
): AgentChannelSummary {
  return {
    type: "instagram",
    status: "active",
    config: { accountId: "17841400000000000", accessToken: "IGQVJtoken" },
    ...overrides,
  };
}

/** selectTools as a trusted call site sees it, with send tools registered. */
function sendableTools(
  integrations: string[],
  agentId: string,
  channels: AgentChannelSummary[],
) {
  return selectTools(integrations, agentId, channels, { allowSendTools: true });
}

describe("customer tools isolation", () => {
  it("does not register operator exclusive tools", () => {
    expect(Object.keys(getAllTools(AGENT_ID)).sort()).toEqual(
      [
        "getConversations",
        "getMessageHistory",
        "getShopifyCollections",
        "getShopifyProducts",
        "listInstagramComments",
        "replyToInstagramComment",
        "searchKnowledgeBase",
        "sendInstagramPrivateReply",
        "sendPlatformMessage",
      ].sort(),
    );
    const src = readFileSync(path.join(dirname, "tools.ts"), "utf8");
    expect(src).not.toContain("proposeAction");
    expect(src).not.toContain("searchCompanyRecords");
  });
});

describe("selectTools messaging availability", () => {
  it("offers the send tool when an active whatsapp channel is configured", () => {
    const selected = sendableTools([], AGENT_ID, [whatsappChannel()]);

    expect(Object.keys(selected).sort()).toEqual(
      ["searchKnowledgeBase", "sendPlatformMessage"].sort(),
    );
  });

  it("never offers the still-mocked conversation read tools", () => {
    const selected = sendableTools([], AGENT_ID, [whatsappChannel()]);

    expect(selected).not.toHaveProperty("getConversations");
    expect(selected).not.toHaveProperty("getMessageHistory");
  });

  it("withholds the messaging tools when the agent has no channels", () => {
    const selected = sendableTools([], AGENT_ID, []);

    expect(selected).not.toHaveProperty("sendPlatformMessage");
  });

  it("withholds the messaging tools when the whatsapp channel is inactive", () => {
    const selected = sendableTools([], AGENT_ID, [
      whatsappChannel({ status: "inactive" }),
    ]);

    expect(selected).not.toHaveProperty("sendPlatformMessage");
  });

  it("withholds the messaging tools when the channel config has no access token", () => {
    const selected = sendableTools([], AGENT_ID, [
      whatsappChannel({ config: { phoneNumberId: "123456789012345" } }),
    ]);

    expect(selected).not.toHaveProperty("sendPlatformMessage");
  });

  it("withholds the messaging tools when the channel config has no phone number id", () => {
    const selected = sendableTools([], AGENT_ID, [
      whatsappChannel({ config: { accessToken: "EAAGtoken" } }),
    ]);

    expect(selected).not.toHaveProperty("sendPlatformMessage");
  });

  it("still offers shopify tools independently of messaging", () => {
    const selected = sendableTools(["shopify"], AGENT_ID, []);

    expect(selected).toHaveProperty("getShopifyProducts");
    expect(selected).not.toHaveProperty("sendPlatformMessage");
  });
});

describe("sendPlatformMessage agent binding", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    findFirst.mockReset();
    fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          messaging_product: "whatsapp",
          messages: [{ id: "wamid.SENT" }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function sendTool() {
    const tool = sendableTools([], AGENT_ID, [whatsappChannel()])
      .sendPlatformMessage;
    if (!tool?.execute) throw new Error("sendPlatformMessage was not selected");
    return tool;
  }

  it("does not let the model choose which agent sends", () => {
    const schema = sendTool().inputSchema as { shape?: Record<string, unknown> };

    expect(Object.keys(schema.shape ?? {}).sort()).toEqual(
      ["content", "platform", "recipientId"].sort(),
    );
  });

  it("sends with the credentials of the bound agent's whatsapp channel", async () => {
    findFirst.mockResolvedValue({
      config: { phoneNumberId: "999888777666555", accessToken: "EAAGbound" },
    });

    const result = await sendTool().execute!(
      { platform: "whatsapp", recipientId: "905551112233", content: "Merhaba" },
      { toolCallId: "call-1", messages: [] },
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://graph.facebook.com/v21.0/999888777666555/messages",
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(
      "Bearer EAAGbound",
    );
    expect(result).toMatchObject({ success: true, messageId: "wamid.SENT" });
  });

  it("reports a failure without calling the API when the channel has vanished", async () => {
    findFirst.mockResolvedValue(undefined);

    const result = await sendTool().execute!(
      { platform: "whatsapp", recipientId: "905551112233", content: "Merhaba" },
      { toolCallId: "call-2", messages: [] },
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false, messageId: null });
  });
});

describe("sendPlatformMessage platform enum", () => {
  function platformsOf(channels: AgentChannelSummary[]) {
    const tool = sendableTools([], AGENT_ID, channels).sendPlatformMessage;
    if (!tool) throw new Error("sendPlatformMessage was not selected");
    const shape = (tool.inputSchema as { shape?: Record<string, unknown> })
      .shape;
    const platform = shape?.platform as { options?: string[] };
    return [...(platform.options ?? [])].sort();
  }

  it("offers only whatsapp when only whatsapp is configured", () => {
    expect(platformsOf([whatsappChannel()])).toEqual(["whatsapp"]);
  });

  it("offers only instagram when only instagram is configured", () => {
    expect(platformsOf([instagramChannel()])).toEqual(["instagram"]);
  });

  it("offers both when both are configured", () => {
    expect(platformsOf([whatsappChannel(), instagramChannel()])).toEqual(
      ["instagram", "whatsapp"],
    );
  });

  it("never offers facebook, which has no implementation", () => {
    expect(platformsOf([whatsappChannel(), instagramChannel()])).not.toContain(
      "facebook",
    );
  });

  it("withholds the send tool when instagram is missing its accountId", () => {
    const selected = sendableTools([], AGENT_ID, [
      instagramChannel({ config: { accessToken: "IGQVJtoken" } }),
    ]);

    expect(selected.sendPlatformMessage).toBeUndefined();
  });
});

describe("selectTools instagram comment availability", () => {
  it("offers the comment tools when an active instagram channel is configured", () => {
    const selected = sendableTools([], AGENT_ID, [instagramChannel()]);

    expect(Object.keys(selected).sort()).toEqual(
      [
        "listInstagramComments",
        "replyToInstagramComment",
        "searchKnowledgeBase",
        "sendInstagramPrivateReply",
        "sendPlatformMessage",
      ].sort(),
    );
  });

  it("withholds them when the instagram channel is inactive", () => {
    const selected = sendableTools([], AGENT_ID, [
      instagramChannel({ status: "inactive" }),
    ]);

    expect(selected.listInstagramComments).toBeUndefined();
    expect(selected.replyToInstagramComment).toBeUndefined();
    expect(selected.sendInstagramPrivateReply).toBeUndefined();
  });

  it("withholds them when the instagram channel lacks an access token", () => {
    const selected = sendableTools([], AGENT_ID, [
      instagramChannel({ config: { accountId: "17841400000000000" } }),
    ]);

    expect(selected.listInstagramComments).toBeUndefined();
  });

  it("does not offer them to a whatsapp-only agent", () => {
    const selected = sendableTools([], AGENT_ID, [whatsappChannel()]);

    expect(selected.listInstagramComments).toBeUndefined();
    expect(selected.replyToInstagramComment).toBeUndefined();
    expect(selected.sendInstagramPrivateReply).toBeUndefined();
  });
});

describe("send tools are opt-in", () => {
  // The widget chat is public: anyone on a customer's website reaches this
  // tool surface. A send tool there means an anonymous visitor can drive a
  // message out of the business's verified number, so registration has to be
  // something a call site asks for, not something a configured channel grants.
  it("withholds every send tool when the caller does not ask for them", () => {
    const selected = selectTools([], AGENT_ID, [
      whatsappChannel(),
      instagramChannel(),
    ]);

    expect(selected).not.toHaveProperty("sendPlatformMessage");
    expect(selected).not.toHaveProperty("replyToInstagramComment");
    expect(selected).not.toHaveProperty("sendInstagramPrivateReply");
  });

  it("still offers the read-only comment tool to a caller that cannot send", () => {
    const selected = selectTools([], AGENT_ID, [instagramChannel()]);

    expect(selected).toHaveProperty("listInstagramComments");
  });

  it("offers the send tools when the caller opts in", () => {
    const selected = selectTools([], AGENT_ID, [
      whatsappChannel(),
      instagramChannel(),
    ], { allowSendTools: true });

    expect(selected).toHaveProperty("sendPlatformMessage");
    expect(selected).toHaveProperty("replyToInstagramComment");
    expect(selected).toHaveProperty("sendInstagramPrivateReply");
  });

  it("opting in grants nothing when no channel is configured", () => {
    const selected = selectTools([], AGENT_ID, [], { allowSendTools: true });

    expect(selected).not.toHaveProperty("sendPlatformMessage");
  });
});

describe("sendPlatformMessage channel scoping", () => {
  /**
   * Drizzle has no public API for reading a built `where`, so this walks its
   * internal `SQL` shape: a column operand carries a `name` and a `table`,
   * which a string or parameter chunk does not. It exists because the mock
   * returns the same channel row whatever the query says — only the built
   * condition can show that the lookup is still bound to this agent and to an
   * active channel.
   */
  function columnNamesIn(node: unknown, names: string[] = []): string[] {
    if (node && typeof node === "object") {
      const candidate = node as {
        name?: unknown;
        table?: unknown;
        queryChunks?: unknown[];
      };
      if (typeof candidate.name === "string" && candidate.table !== undefined) {
        names.push(candidate.name);
      }
      if (Array.isArray(candidate.queryChunks)) {
        for (const chunk of candidate.queryChunks) columnNamesIn(chunk, names);
      }
    }
    return names;
  }

  it("looks the channel up by agent, type and status, not by type alone", async () => {
    findFirst.mockReset();
    findFirst.mockResolvedValue({
      config: { phoneNumberId: "999888777666555", accessToken: "EAAGbound" },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ messages: [{ id: "wamid.SENT" }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const tool = sendableTools([], AGENT_ID, [whatsappChannel()])
      .sendPlatformMessage;
    await tool!.execute!(
      { platform: "whatsapp", recipientId: "905551112233", content: "Merhaba" },
      { toolCallId: "call-scope", messages: [] },
    );

    const columns = columnNamesIn(findFirst.mock.calls[0][0].where);
    expect(columns).toContain("agent_id");
    expect(columns).toContain("type");
    expect(columns).toContain("status");

    vi.unstubAllGlobals();
  });
});
