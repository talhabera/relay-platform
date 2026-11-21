import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeInstagramCommentTools } from "./instagram-tools";

const AGENT_ID = "11111111-1111-1111-1111-111111111111";
const COMMENT_ID = "17900000000000000";

const listAgentComments = vi.fn();
const loadAgentComment = vi.fn();
const markPublicReplied = vi.fn();
const markPrivateReplySent = vi.fn();

vi.mock("./instagram-comment-store", () => ({
  listAgentComments: (...args: unknown[]) => listAgentComments(...args),
  loadAgentComment: (...args: unknown[]) => loadAgentComment(...args),
  markPublicReplied: (...args: unknown[]) => markPublicReplied(...args),
  markPrivateReplySent: (...args: unknown[]) => markPrivateReplySent(...args),
}));

const CREDENTIALS = {
  accountId: "17841400000000000",
  accessToken: "IGQVJtoken",
};

/** A comment owned by this agent with nothing answered yet. */
function unansweredComment(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    igCommentId: COMMENT_ID,
    publicRepliedAt: null,
    privateReplySentAt: null,
    credentials: CREDENTIALS,
    ...overrides,
  };
}

const CONTEXT = { toolCallId: "call-1", messages: [] };

let fetchMock: ReturnType<typeof vi.fn>;

function tools() {
  return makeInstagramCommentTools(AGENT_ID);
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listInstagramComments limit", () => {
  /** The zod schema the model fills in for the read tool. */
  function limitSchema() {
    const tool = makeInstagramCommentTools(AGENT_ID).listInstagramComments;
    const shape = (tool.inputSchema as { shape?: Record<string, unknown> }).shape;
    return shape?.limit as { safeParse: (value: unknown) => { success: boolean } };
  }

  // The model fills this in. Postgres rejects a negative LIMIT with an error,
  // and execute has no try/catch, so an unvalidated value ends the run rather
  // than returning something the model can recover from.
  it.each([0, -1, 1.5, 101])("rejects %s", (value) => {
    expect(limitSchema().safeParse(value).success).toBe(false);
  });

  it.each([1, 25, 100])("accepts %s", (value) => {
    expect(limitSchema().safeParse(value).success).toBe(true);
  });
});

describe("listInstagramComments", () => {
  it("does not let the model choose which agent it reads", () => {
    const schema = tools().listInstagramComments.inputSchema as {
      shape?: Record<string, unknown>;
    };

    expect(Object.keys(schema.shape ?? {}).sort()).toEqual(
      ["limit", "mediaId", "onlyUnanswered"].sort(),
    );
  });

  it("reads the bound agent's comments from the store", async () => {
    listAgentComments.mockResolvedValue([
      {
        igCommentId: COMMENT_ID,
        igMediaId: "17800000000000000",
        parentIgCommentId: null,
        fromUsername: "alex.creative",
        content: "Bu urun stokta mi?",
        commentedAt: new Date("2026-09-05T10:00:00Z"),
        publicRepliedAt: null,
        privateReplySentAt: null,
      },
    ]);

    const result = await tools().listInstagramComments.execute!(
      { onlyUnanswered: true, limit: 10 },
      CONTEXT,
    );

    expect(listAgentComments).toHaveBeenCalledWith(AGENT_ID, {
      mediaId: undefined,
      onlyUnanswered: true,
      limit: 10,
    });
    expect(result).toMatchObject({ total: 1 });
  });
});

describe("replyToInstagramComment", () => {
  it("posts the reply and records it", async () => {
    loadAgentComment.mockResolvedValue(unansweredComment());
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: "17911111111111111" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await tools().replyToInstagramComment.execute!(
      { commentId: COMMENT_ID, content: "Evet, stokta!" },
      CONTEXT,
    );

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe(
      "https://graph.facebook.com/v21.0/17900000000000000/replies",
    );
    expect(markPublicReplied).toHaveBeenCalledWith(
      "row-1",
      "17911111111111111",
      "Evet, stokta!",
    );
    expect(result).toMatchObject({ success: true });
  });

  it("refuses a comment belonging to another agent without calling the API", async () => {
    loadAgentComment.mockResolvedValue(null);

    const result = await tools().replyToInstagramComment.execute!(
      { commentId: COMMENT_ID, content: "Evet, stokta!" },
      CONTEXT,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(markPublicReplied).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false });
  });

  it("does not record a reply the API rejected", async () => {
    loadAgentComment.mockResolvedValue(unansweredComment());
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Unsupported request" } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await tools().replyToInstagramComment.execute!(
      { commentId: COMMENT_ID, content: "Evet, stokta!" },
      CONTEXT,
    );

    expect(markPublicReplied).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining("Unsupported request"),
    });
  });

  it("fails when the channel lost its credentials", async () => {
    loadAgentComment.mockResolvedValue(
      unansweredComment({ credentials: null }),
    );

    const result = await tools().replyToInstagramComment.execute!(
      { commentId: COMMENT_ID, content: "Evet, stokta!" },
      CONTEXT,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false });
  });
});

describe("sendInstagramPrivateReply", () => {
  it("sends the private reply and records it", async () => {
    loadAgentComment.mockResolvedValue(unansweredComment());
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message_id: "mid.PRIVATE" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    const result = await tools().sendInstagramPrivateReply.execute!(
      { commentId: COMMENT_ID, content: "Detaylari DM'den yolladim" },
      CONTEXT,
    );

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://graph.facebook.com/v21.0/17841400000000000/messages",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      recipient: { comment_id: COMMENT_ID },
      message: { text: "Detaylari DM'den yolladim" },
    });
    expect(markPrivateReplySent).toHaveBeenCalledWith("row-1", "mid.PRIVATE");
    expect(result).toMatchObject({ success: true });
  });

  it("refuses a second private reply without calling the API", async () => {
    loadAgentComment.mockResolvedValue(
      unansweredComment({ privateReplySentAt: new Date("2026-09-05T10:00:00Z") }),
    );

    const result = await tools().sendInstagramPrivateReply.execute!(
      { commentId: COMMENT_ID, content: "Bir kez daha" },
      CONTEXT,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(markPrivateReplySent).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/already/i),
    });
  });

  it("refuses a comment belonging to another agent without calling the API", async () => {
    loadAgentComment.mockResolvedValue(null);

    const result = await tools().sendInstagramPrivateReply.execute!(
      { commentId: COMMENT_ID, content: "Merhaba" },
      CONTEXT,
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: false });
  });
});
