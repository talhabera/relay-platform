import { beforeEach, describe, expect, it, vi } from "vitest";

const { commentsFindFirst, channelsFindFirst, selectLimit } = vi.hoisted(() => ({
  commentsFindFirst: vi.fn(),
  channelsFindFirst: vi.fn(),
  selectLimit: vi.fn(),
}));

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      query: {
        instagramComments: { findFirst: commentsFindFirst },
        channels: { findFirst: channelsFindFirst },
      },
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({ limit: selectLimit }),
          }),
        }),
      }),
    },
  };
});

import {
  findCommentMedia,
  listMediaContext,
  loadAgentComment,
  loadCommentRun,
} from "./instagram-comment-store";

/**
 * Drizzle has no public API for inspecting a built `where` condition, so this
 * deliberately reaches into its internal `SQL` shape: each condition node
 * exposes its operands via `queryChunks`, and a column operand carries a
 * `name` (its snake_case DB name) alongside a `table` reference — which a
 * `StringChunk` or `Param` operand does not. This exists so the
 * `findCommentMedia` channel-scoping test can tell "scoped by channel" apart
 * from "scoped by nothing" — both resolve an unmatched row to null, so only
 * inspecting the built query proves the `channelId` argument was used.
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

const ROW = {
  id: "row-1",
  agentId: "agent-1",
  channelId: "channel-1",
  igCommentId: "17900000000000000",
  igMediaId: "17800000000000000",
  fromUsername: "alex.creative",
  content: "Bu urun stokta mi?",
  publicRepliedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("loadCommentRun", () => {
  it("returns the row with the channel credentials", async () => {
    commentsFindFirst.mockResolvedValue(ROW);
    channelsFindFirst.mockResolvedValue({
      config: { accountId: "17841400000000000", accessToken: "IGQVJtoken" },
    });

    const run = await loadCommentRun("row-1");

    expect(run).toMatchObject({
      id: "row-1",
      agentId: "agent-1",
      igCommentId: "17900000000000000",
      igMediaId: "17800000000000000",
      credentials: {
        accountId: "17841400000000000",
        accessToken: "IGQVJtoken",
      },
    });
  });

  it("returns null credentials when the channel config is incomplete", async () => {
    commentsFindFirst.mockResolvedValue(ROW);
    channelsFindFirst.mockResolvedValue({ config: { accountId: "17841400000000000" } });

    const run = await loadCommentRun("row-1");

    expect(run?.credentials).toBeNull();
  });

  it("returns null when there is no such row", async () => {
    commentsFindFirst.mockResolvedValue(undefined);

    expect(await loadCommentRun("row-1")).toBeNull();
  });
});

describe("findCommentMedia", () => {
  it("returns the media id for a row on that channel", async () => {
    commentsFindFirst.mockResolvedValue({ igMediaId: "17800000000000000" });

    expect(await findCommentMedia("row-1", "channel-1")).toBe(
      "17800000000000000",
    );
  });

  it("returns null when the row does not match the channel", async () => {
    commentsFindFirst.mockResolvedValue(undefined);

    expect(await findCommentMedia("row-1", "other-channel")).toBeNull();
  });

  it("scopes the lookup by both the row id and the channel id", async () => {
    commentsFindFirst.mockResolvedValue({ igMediaId: "17800000000000000" });

    await findCommentMedia("row-1", "channel-1");

    const call = commentsFindFirst.mock.calls[0][0] as { where?: unknown };
    expect(collectColumnNames(call.where)).toEqual(
      expect.arrayContaining(["id", "channel_id"])
    );
  });
});

describe("listMediaContext", () => {
  // The query is newest-first so the limit keeps the most recent comments;
  // the prompt reads oldest-first, so the rows come back reversed.
  it("returns the rows oldest first", async () => {
    selectLimit.mockResolvedValue([
      { fromUsername: "carl", content: "third", publicReplyText: null },
      { fromUsername: "bea", content: "second", publicReplyText: null },
      { fromUsername: "alex", content: "first", publicReplyText: "Yes!" },
    ]);

    const context = await listMediaContext("agent-1", "media-1", "row-1");

    expect(context.map((c) => c.content)).toEqual(["first", "second", "third"]);
    expect(context[0].publicReplyText).toBe("Yes!");
  });
});

describe("loadAgentComment", () => {
  // The agentId clause is the ownership boundary for all three comment tools:
  // without it, a commentId the model names resolves to whatever row carries
  // it, on any agent's channel. A mock returns the same row either way, so
  // only the built query can tell the guard is still there.
  it("scopes the lookup to the calling agent, not the comment id alone", async () => {
    commentsFindFirst.mockResolvedValue(ROW);
    channelsFindFirst.mockResolvedValue({
      config: { accountId: "17841400000000000", accessToken: "IGQVJtoken" },
    });

    await loadAgentComment("agent-1", "17900000000000000");

    const columns = collectColumnNames(
      commentsFindFirst.mock.calls[0][0].where,
    );
    expect(columns).toContain("agent_id");
    expect(columns).toContain("ig_comment_id");
  });

  it("returns null for a comment id that belongs to nobody it can see", async () => {
    commentsFindFirst.mockResolvedValue(undefined);

    expect(await loadAgentComment("agent-1", "17900000000000000")).toBeNull();
  });
});
