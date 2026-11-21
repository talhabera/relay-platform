import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectColumnNames } from "../test-utils/column-names";

const { messageFindFirst, updateFn, setFn, whereFn } = vi.hoisted(() => ({
  messageFindFirst: vi.fn(),
  updateFn: vi.fn(),
  setFn: vi.fn(),
  whereFn: vi.fn(),
}));

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      update: updateFn,
      query: { messages: { findFirst: messageFindFirst } },
    },
  };
});

import { recordFirstResponse } from "./first-response";

const INBOUND_AT = new Date("2026-11-06T10:00:00.000Z");
const REPLIED_AT = new Date("2026-11-06T10:00:42.500Z");

function collectStrings(node: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
  if (typeof node === "string") { out.push(node); return out; }
  if (!node || typeof node !== "object" || seen.has(node)) return out;
  seen.add(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out, seen));
    else collectStrings(value, out, seen);
  }
  return out;
}

beforeEach(() => {
  vi.clearAllMocks();
  updateFn.mockReturnValue({ set: setFn });
  setFn.mockReturnValue({ where: whereFn });
  whereFn.mockResolvedValue(undefined);
  messageFindFirst
    .mockResolvedValueOnce({ createdAt: INBOUND_AT })
    .mockResolvedValueOnce({ createdAt: REPLIED_AT });
});

describe("recordFirstResponse", () => {
  it("writes payload.firstResponse from the first user and assistant messages, as one merge", async () => {
    await recordFirstResponse("chat-1");

    expect(updateFn).toHaveBeenCalledTimes(1);
    const written = setFn.mock.calls[0][0].payload;
    // A merge (SQL), never a whole-object replacement: other payload keys survive.
    expect(written).not.toEqual(expect.objectContaining({ firstResponse: expect.anything() }));
    const params = collectStrings(written).filter((s) => s.startsWith("{"));
    expect(params.map((s) => JSON.parse(s))).toContainEqual({
      firstResponse: {
        inboundAt: INBOUND_AT.toISOString(),
        repliedAt: REPLIED_AT.toISOString(),
        ms: 42500,
      },
    });
    // Guarded on the chat-linked lead and on firstResponse being absent, so a
    // second call (from the other side) and a chat with no lead are no-ops.
    const whereArg = whereFn.mock.calls[0][0];
    expect(collectColumnNames(whereArg)).toEqual(expect.arrayContaining(["chat_id", "payload"]));
    expect(collectStrings(whereArg).join(" ")).toContain("firstResponse");
  });

  it("does nothing when there is no assistant message yet", async () => {
    messageFindFirst.mockReset();
    messageFindFirst
      .mockResolvedValueOnce({ createdAt: INBOUND_AT })
      .mockResolvedValueOnce(undefined);

    await recordFirstResponse("chat-1");
    expect(updateFn).not.toHaveBeenCalled();
  });

  it("does nothing when there is no user message", async () => {
    messageFindFirst.mockReset();
    messageFindFirst.mockResolvedValueOnce(undefined);

    await recordFirstResponse("chat-1");
    expect(updateFn).not.toHaveBeenCalled();
  });
});
