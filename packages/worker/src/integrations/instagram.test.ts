import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  postInstagramCommentReply,
  sendInstagramDirectMessage,
  sendInstagramPrivateReply,
  type InstagramCredentials,
} from "./instagram";

const CREDENTIALS: InstagramCredentials = {
  accountId: "17841400000000000",
  accessToken: "IGQVJsecrettoken",
};

const RECIPIENT = "5551234567890123";
const COMMENT_ID = "17900000000000000";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Mirrors a Graph API error envelope. */
function graphErrorBody(message: string) {
  return {
    error: {
      message,
      type: "OAuthException",
      code: 10,
      fbtrace_id: "AbCdEfGhIjK",
    },
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

function sentRequest() {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init };
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("sendInstagramDirectMessage", () => {
  it("posts to the messages endpoint of the configured account", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message_id: "mid.ONE" }));

    await sendInstagramDirectMessage(CREDENTIALS, RECIPIENT, "Merhaba");

    const { url, init } = sentRequest();
    expect(url).toBe(
      "https://graph.facebook.com/v21.0/17841400000000000/messages",
    );
    expect(init.method).toBe("POST");
  });

  it("addresses the recipient by id and carries the text", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message_id: "mid.TWO" }));

    await sendInstagramDirectMessage(CREDENTIALS, RECIPIENT, "Siparisiniz yolda");

    expect(JSON.parse(sentRequest().init.body as string)).toEqual({
      recipient: { id: RECIPIENT },
      message: { text: "Siparisiniz yolda" },
    });
  });

  it("authorizes with the channel access token", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message_id: "mid.THREE" }));

    await sendInstagramDirectMessage(CREDENTIALS, RECIPIENT, "Merhaba");

    const headers = sentRequest().init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer IGQVJsecrettoken");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("bounds the request with an abort signal", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message_id: "mid.FOUR" }));

    await sendInstagramDirectMessage(CREDENTIALS, RECIPIENT, "Merhaba");

    expect(sentRequest().init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns the message id instagram assigned", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ recipient_id: RECIPIENT, message_id: "mid.ASSIGNED" }),
    );

    const result = await sendInstagramDirectMessage(
      CREDENTIALS,
      RECIPIENT,
      "Merhaba",
    );

    expect(result).toEqual({ success: true, id: "mid.ASSIGNED", error: null });
  });

  it("reports the graph error message when instagram rejects the send", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        graphErrorBody("(#10) This message is sent outside of allowed window"),
        400,
      ),
    );

    const result = await sendInstagramDirectMessage(
      CREDENTIALS,
      RECIPIENT,
      "Merhaba",
    );

    expect(result.success).toBe(false);
    expect(result.id).toBeNull();
    expect(result.error).toContain(
      "(#10) This message is sent outside of allowed window",
    );
  });

  it("reports failure rather than throwing when the network call fails", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await sendInstagramDirectMessage(
      CREDENTIALS,
      RECIPIENT,
      "Merhaba",
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("reports failure when the response body is not JSON", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>gateway timeout</html>", { status: 504 }),
    );

    const result = await sendInstagramDirectMessage(
      CREDENTIALS,
      RECIPIENT,
      "Merhaba",
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("504");
  });

  it("reports failure when a 200 response carries no id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ recipient_id: RECIPIENT }));

    const result = await sendInstagramDirectMessage(
      CREDENTIALS,
      RECIPIENT,
      "Merhaba",
    );

    expect(result.success).toBe(false);
    expect(result.id).toBeNull();
  });

  it("keeps the access token out of the logs", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockResolvedValue(jsonResponse({ message_id: "mid.LOG" }));

    await sendInstagramDirectMessage(CREDENTIALS, RECIPIENT, "Merhaba");

    const logged = [...log.mock.calls, ...error.mock.calls]
      .flat()
      .map((arg) => JSON.stringify(arg))
      .join(" ");
    expect(logged).not.toContain(CREDENTIALS.accessToken);
  });
});

describe("postInstagramCommentReply", () => {
  it("posts to the replies edge of the comment", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "17911111111111111" }));

    await postInstagramCommentReply(CREDENTIALS, COMMENT_ID, "Tesekkurler!");

    const { url, init } = sentRequest();
    expect(url).toBe(
      "https://graph.facebook.com/v21.0/17900000000000000/replies",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      message: "Tesekkurler!",
    });
  });

  it("returns the id of the created reply comment", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "17911111111111111" }));

    const result = await postInstagramCommentReply(
      CREDENTIALS,
      COMMENT_ID,
      "Tesekkurler!",
    );

    expect(result).toEqual({
      success: true,
      id: "17911111111111111",
      error: null,
    });
  });

  it("reports the graph error when the comment no longer exists", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(graphErrorBody("Unsupported get request"), 400),
    );

    const result = await postInstagramCommentReply(
      CREDENTIALS,
      COMMENT_ID,
      "Tesekkurler!",
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Unsupported get request");
  });
});

describe("sendInstagramPrivateReply", () => {
  it("addresses the recipient by comment id on the account messages endpoint", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message_id: "mid.PRIVATE" }));

    await sendInstagramPrivateReply(CREDENTIALS, COMMENT_ID, "Detay icin DM");

    const { url, init } = sentRequest();
    expect(url).toBe(
      "https://graph.facebook.com/v21.0/17841400000000000/messages",
    );
    expect(JSON.parse(init.body as string)).toEqual({
      recipient: { comment_id: COMMENT_ID },
      message: { text: "Detay icin DM" },
    });
  });

  it("returns the message id", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message_id: "mid.PRIVATE" }));

    const result = await sendInstagramPrivateReply(
      CREDENTIALS,
      COMMENT_ID,
      "Detay icin DM",
    );

    expect(result).toEqual({ success: true, id: "mid.PRIVATE", error: null });
  });

  it("reports the graph error when the one private reply was already used", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        graphErrorBody("(#10) Private reply already sent for this comment"),
        400,
      ),
    );

    const result = await sendInstagramPrivateReply(
      CREDENTIALS,
      COMMENT_ID,
      "Detay icin DM",
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("already sent");
  });
});
