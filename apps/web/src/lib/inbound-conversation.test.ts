import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import {
  findOrCreateChat,
  saveInboundMessage,
  updateMessageStatus,
} from "./inbound-conversation";

const AGENT_ID = "11111111-1111-1111-1111-111111111111";
const COMPANY_ID = "22222222-2222-2222-2222-222222222222";

let valuesMock: ReturnType<typeof vi.fn>;
let returningMock: ReturnType<typeof vi.fn>;
let onConflictMock: ReturnType<typeof vi.fn>;
let setMock: ReturnType<typeof vi.fn>;
let whereMock: ReturnType<typeof vi.fn>;
let updateReturningMock: ReturnType<typeof vi.fn>;

/**
 * Drizzle has no public API for inspecting a built `where` condition, so
 * this deliberately reaches into its internal `SQL` shape: each condition
 * node exposes its operands via `queryChunks`, and a column operand carries
 * a `name` (its snake_case DB name) alongside a `table` reference — which a
 * `StringChunk` or `Param` operand does not. This exists only because the
 * archived-row filter in `findOrCreateChat` has no other regression
 * protection: dropping `isNull(chats.archivedAt)`, or any of the `eq(...)`
 * conditions, from the implementation would otherwise still pass every test.
 */
function collectColumnNames(node: unknown, names: string[] = []): string[] {
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
      for (const chunk of candidate.queryChunks) {
        collectColumnNames(chunk, names);
      }
    }
  }
  return names;
}

beforeEach(() => {
  vi.clearAllMocks();
  returningMock = vi.fn(() => [{ id: "new-chat" }]);
  onConflictMock = vi.fn(() => ({ returning: returningMock }));
  valuesMock = vi.fn(() => ({
    returning: returningMock,
    onConflictDoNothing: onConflictMock,
  }));
  vi.mocked(db.insert).mockReturnValue({ values: valuesMock } as never);

  updateReturningMock = vi.fn(() => [{ id: "msg-1" }]);
  whereMock = vi.fn(() => ({ returning: updateReturningMock }));
  setMock = vi.fn(() => ({ where: whereMock }));
  vi.mocked(db.update).mockReturnValue({ set: setMock } as never);
});

describe("findOrCreateChat", () => {
  const input = {
    agentId: AGENT_ID,
    companyId: COMPANY_ID,
    platform: "whatsapp" as const,
    senderId: "905551112233",
    title: "Sarah Johnson",
  };

  it("reuses the existing conversation for that sender", async () => {
    vi.mocked(db.query.chats.findFirst).mockResolvedValue({
      id: "existing-chat",
    } as never);

    expect(await findOrCreateChat(input)).toBe("existing-chat");
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("creates a chat carrying the platform and the sender id", async () => {
    vi.mocked(db.query.chats.findFirst).mockResolvedValue(undefined as never);

    expect(await findOrCreateChat(input)).toBe("new-chat");
    expect(valuesMock.mock.calls[0][0]).toMatchObject({
      companyId: COMPANY_ID,
      agentId: AGENT_ID,
      channelType: "whatsapp",
      visitorId: "905551112233",
      title: "Sarah Johnson",
      userId: null,
    });
    expect(onConflictMock).toHaveBeenCalled();
  });

  it("returns the winner's chat when a concurrent insert took the row", async () => {
    vi.mocked(db.query.chats.findFirst)
      .mockResolvedValueOnce(undefined as never)
      .mockResolvedValueOnce({ id: "winner-chat" } as never);
    returningMock.mockReturnValue([]);

    expect(await findOrCreateChat(input)).toBe("winner-chat");
    expect(db.query.chats.findFirst).toHaveBeenCalledTimes(2);
  });

  it("throws when the insert conflicted but no chat can be found", async () => {
    vi.mocked(db.query.chats.findFirst).mockResolvedValue(undefined as never);
    returningMock.mockReturnValue([]);

    await expect(findOrCreateChat(input)).rejects.toThrow(
      "insert conflicted but no chat found"
    );
  });

  it("looks up by agent, channel, and visitor, excluding archived chats", async () => {
    vi.mocked(db.query.chats.findFirst).mockResolvedValue({
      id: "existing-chat",
    } as never);

    await findOrCreateChat(input);

    const call = vi.mocked(db.query.chats.findFirst).mock.calls[0][0] as {
      where?: unknown;
    };
    expect(collectColumnNames(call.where)).toEqual(
      expect.arrayContaining([
        "agent_id",
        "channel_type",
        "visitor_id",
        "archived_at",
      ])
    );
  });
});

describe("saveInboundMessage", () => {
  const input = {
    chatId: "chat-1",
    content: "Siparisim ne zaman gelir?",
    platformMessageId: "wamid.A",
    senderName: "Sarah Johnson",
  };

  it("stores the message as a user turn carrying the platform id", async () => {
    expect(await saveInboundMessage(input)).toBe(true);
    expect(valuesMock.mock.calls[0][0]).toEqual({
      chatId: "chat-1",
      role: "user",
      content: "Siparisim ne zaman gelir?",
      metadata: {
        platformMessageId: "wamid.A",
        senderName: "Sarah Johnson",
      },
    });
  });

  it("omits senderName when the platform sent none", async () => {
    await saveInboundMessage({ ...input, senderName: null });

    expect(valuesMock.mock.calls[0][0].metadata).toEqual({
      platformMessageId: "wamid.A",
    });
  });

  it("keeps a Click-to-WhatsApp referral on the message", async () => {
    await saveInboundMessage({
      ...input,
      referral: { sourceId: "120212345", headline: "Mutfak yenileme" },
    });

    expect(valuesMock.mock.calls[0][0].metadata).toEqual({
      platformMessageId: "wamid.A",
      senderName: "Sarah Johnson",
      referral: { sourceId: "120212345", headline: "Mutfak yenileme" },
    });
  });

  it("reports false when the unique index rejected a redelivery", async () => {
    returningMock.mockReturnValue([]);

    expect(await saveInboundMessage(input)).toBe(false);
  });
});

describe("updateMessageStatus", () => {
  const input = {
    waMessageId: "wamid.OUT",
    agentId: AGENT_ID,
    status: "delivered" as const,
    statusAt: new Date("2026-09-08T10:00:00.000Z"),
  };

  /** The row as the relational query returns it, with its chat's owner. */
  function outboundRow(
    metadata: Record<string, unknown> = { platformMessageId: "wamid.OUT" },
    agentId = AGENT_ID,
  ) {
    return { id: "msg-1", metadata, chat: { agentId } } as never;
  }

  /**
   * The JSON patch the update merges into the row's metadata.
   *
   * The value handed to `set` is a Drizzle `SQL` object now, not a plain
   * object, so the assertion digs out its one JSON parameter. The walk keeps
   * a seen-set because `SQL` holds column references back to their table.
   */
  function mergedPatch() {
    const seen = new Set<unknown>();
    const walk = (node: unknown): string | undefined => {
      if (typeof node === "string") {
        return node.startsWith("{") ? node : undefined;
      }
      if (!node || typeof node !== "object" || seen.has(node)) return undefined;
      seen.add(node);
      for (const value of Object.values(node)) {
        const found = walk(value);
        if (found) return found;
      }
      return undefined;
    };

    const json = walk(setMock.mock.calls[0][0].metadata);
    if (!json) throw new Error("no JSON patch was passed to set()");
    return JSON.parse(json);
  }

  it("returns false and writes nothing when no message carries this platform id", async () => {
    vi.mocked(db.query.messages.findFirst).mockResolvedValue(undefined as never);

    expect(await updateMessageStatus(input)).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
  });

  // A status webhook is signed by Meta, not by the business it names, and the
  // wamid is the only thing identifying the message. Without this check any
  // WABA subscribed to the same Meta app can write a status onto another
  // company's message.
  it("refuses a status for a message that belongs to another agent", async () => {
    vi.mocked(db.query.messages.findFirst).mockResolvedValue(
      outboundRow({ platformMessageId: "wamid.OUT" }, "99999999-9999-9999-9999-999999999999"),
    );

    expect(await updateMessageStatus(input)).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
  });

  it("records the status and timestamp", async () => {
    vi.mocked(db.query.messages.findFirst).mockResolvedValue(outboundRow());

    expect(await updateMessageStatus(input)).toBe(true);
    expect(mergedPatch()).toEqual({
      status: "delivered",
      statusAt: "2026-09-08T10:00:00.000Z",
    });
  });

  // The send path writes platformMessageId onto this same row and a second
  // status can arrive at the same moment, so the write merges in the database
  // instead of putting back the object this function read.
  it("merges its fields rather than replacing the metadata it read", async () => {
    vi.mocked(db.query.messages.findFirst).mockResolvedValue(outboundRow());

    await updateMessageStatus(input);

    expect(mergedPatch()).not.toHaveProperty("platformMessageId");
  });

  it("captures the error only when the status is failed", async () => {
    vi.mocked(db.query.messages.findFirst).mockResolvedValue(outboundRow());

    await updateMessageStatus({
      ...input,
      status: "failed",
      error: { code: 131053, title: "Media upload error" },
    });

    expect(mergedPatch()).toEqual({
      status: "failed",
      statusAt: "2026-09-08T10:00:00.000Z",
      error: { code: 131053, title: "Media upload error" },
    });
  });

  it("does not attach an error to a non-failed status", async () => {
    vi.mocked(db.query.messages.findFirst).mockResolvedValue(outboundRow());

    await updateMessageStatus({
      ...input,
      error: { code: 1, title: "should be ignored" },
    });

    expect(mergedPatch()).not.toHaveProperty("error");
  });

  it("does not downgrade a status already further along", async () => {
    vi.mocked(db.query.messages.findFirst).mockResolvedValue(
      outboundRow({ platformMessageId: "wamid.OUT", status: "read" }),
    );

    expect(await updateMessageStatus({ ...input, status: "delivered" })).toBe(
      false,
    );
    expect(db.update).not.toHaveBeenCalled();
  });

  it("ignores a redelivered webhook for the status already stored", async () => {
    vi.mocked(db.query.messages.findFirst).mockResolvedValue(
      outboundRow({ platformMessageId: "wamid.OUT", status: "delivered" }),
    );

    expect(await updateMessageStatus({ ...input, status: "delivered" })).toBe(
      false,
    );
  });

  it("advances from a lower-ranked status to a higher one", async () => {
    vi.mocked(db.query.messages.findFirst).mockResolvedValue(
      outboundRow({ platformMessageId: "wamid.OUT", status: "sent" }),
    );

    expect(await updateMessageStatus({ ...input, status: "read" })).toBe(true);
  });

  it("lets failed override an earlier in-flight status", async () => {
    vi.mocked(db.query.messages.findFirst).mockResolvedValue(
      outboundRow({ platformMessageId: "wamid.OUT", status: "sent" }),
    );

    expect(await updateMessageStatus({ ...input, status: "failed" })).toBe(
      true,
    );
  });

  // Two statuses can be in flight at once; the one that lost the race matches
  // no row, because the guard in the WHERE still names the status it read.
  it("reports no write when another status overtook it", async () => {
    vi.mocked(db.query.messages.findFirst).mockResolvedValue(
      outboundRow({ platformMessageId: "wamid.OUT", status: "sent" }),
    );
    updateReturningMock.mockReturnValue([]);

    expect(await updateMessageStatus({ ...input, status: "read" })).toBe(false);
  });
});
