import { describe, expect, it, vi } from "vitest";
import { enqueue, pendingKeys } from "./serial-queue";

/** A promise plus the handles to settle it from the test body. */
function deferred() {
  let resolve!: () => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("enqueue", () => {
  it("runs two entries on one key in order, never overlapping", async () => {
    const first = deferred();
    const order: string[] = [];

    enqueue("k", async () => {
      order.push("first:start");
      await first.promise;
      order.push("first:end");
    });
    enqueue("k", async () => {
      order.push("second:start");
    });

    await Promise.resolve();
    expect(order).toEqual(["first:start"]);

    first.resolve();
    await vi.waitFor(() => expect(order).toHaveLength(3));
    expect(order).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("runs different keys concurrently", async () => {
    const blocked = deferred();
    const order: string[] = [];

    enqueue("a", async () => {
      order.push("a:start");
      await blocked.promise;
    });
    enqueue("b", async () => {
      order.push("b:start");
    });

    await vi.waitFor(() => expect(order).toContain("b:start"));
    blocked.resolve();
  });

  it("lets the next entry run after the previous one throws", async () => {
    const order: string[] = [];
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    enqueue("k", async () => {
      order.push("first");
      throw new Error("boom");
    });
    enqueue("k", async () => {
      order.push("second");
    });

    await vi.waitFor(() => expect(order).toEqual(["first", "second"]));
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  // A worker process lives for weeks; a map that only grows is a leak.
  it("forgets a key once its chain has drained", async () => {
    enqueue("k", async () => {});

    await vi.waitFor(() => expect(pendingKeys()).toBe(0));
  });
});
