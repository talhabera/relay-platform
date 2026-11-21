import { beforeEach, describe, expect, it, vi } from "vitest";

const { findCommentMedia, enqueueCommentRun } = vi.hoisted(() => ({
  findCommentMedia: vi.fn(),
  enqueueCommentRun: vi.fn(),
}));

vi.mock("./ai/instagram-comment-store", () => ({
  findCommentMedia: (...a: unknown[]) => findCommentMedia(...a),
}));

vi.mock("./handle-instagram-comment", () => ({
  enqueueCommentRun: (...a: unknown[]) => enqueueCommentRun(...a),
}));

import { handleCommentRequest, parseCommentRequest } from "./comment-request";

const BODY = { channelId: "channel-1", commentId: "row-1" };

beforeEach(() => {
  vi.clearAllMocks();
  findCommentMedia.mockResolvedValue("17800000000000000");
});

describe("parseCommentRequest", () => {
  it("accepts a well-formed body", () => {
    expect(parseCommentRequest(BODY)).toEqual(BODY);
  });

  it.each([
    null,
    "channel-1",
    {},
    { channelId: "channel-1" },
    { commentId: "row-1" },
    { channelId: "", commentId: "row-1" },
    { channelId: "channel-1", commentId: "" },
    { channelId: 1, commentId: "row-1" },
  ])("rejects %j", (body) => {
    expect(parseCommentRequest(body)).toBeNull();
  });
});

describe("handleCommentRequest", () => {
  it("enqueues under the comment's media and answers 202", async () => {
    const result = await handleCommentRequest(BODY);

    expect(findCommentMedia).toHaveBeenCalledWith("row-1", "channel-1");
    expect(enqueueCommentRun).toHaveBeenCalledWith(BODY, "17800000000000000");
    expect(result.status).toBe(202);
  });

  it("answers 400 and enqueues nothing for a malformed body", async () => {
    const result = await handleCommentRequest({ channelId: "channel-1" });

    expect(result.status).toBe(400);
    expect(enqueueCommentRun).not.toHaveBeenCalled();
  });

  // A body naming another channel's comment, or a row that is already gone.
  it("answers 404 and enqueues nothing when no row matches", async () => {
    findCommentMedia.mockResolvedValue(null);

    const result = await handleCommentRequest(BODY);

    expect(result.status).toBe(404);
    expect(enqueueCommentRun).not.toHaveBeenCalled();
  });
});
