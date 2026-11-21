import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchMessageBatchResults,
  pollMessageBatch,
  submitMessageBatch,
} from "./anthropic-batch";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
  delete process.env.ANTHROPIC_API_KEY;
});

describe("submitMessageBatch", () => {
  it("sends custom_id in requests", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "batch_123" }),
    });

    const id = await submitMessageBatch([
      {
        customId: "run-1",
        params: { model: "claude-haiku-4-5-20251001", max_tokens: 1024, messages: [] },
      },
    ]);

    expect(id).toBe("batch_123");
    expect(fetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/messages/batches",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body as string,
    );
    expect(body.requests[0].custom_id).toBe("run-1");
  });
});

describe("pollMessageBatch", () => {
  it("maps processing_status to open or ended", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ processing_status: "in_progress" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ processing_status: "ended" }),
      });

    await expect(pollMessageBatch("batch_1")).resolves.toBe("open");
    await expect(pollMessageBatch("batch_1")).resolves.toBe("ended");
  });
});

describe("fetchMessageBatchResults", () => {
  it("parses jsonl succeeded lines", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";
    const line = JSON.stringify({
      custom_id: "run-1",
      result: {
        type: "succeeded",
        message: { id: "msg_1", content: [{ type: "text", text: "done" }] },
      },
    });
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => `${line}\n`,
    });

    const results = await fetchMessageBatchResults("batch_1");
    expect(results).toEqual([
      {
        customId: "run-1",
        ok: true,
        body: { id: "msg_1", content: [{ type: "text", text: "done" }] },
      },
    ]);
  });
});
