import { beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import { answerNowAsCompanyUser } from "@/lib/handoff/requests";
import { requirePageAccess } from "@/lib/page-access";
import { deliverHumanMessageOnWorker } from "@/lib/worker-proxy";

import { handBackFromInbox, sendInboxMessage, takeOverFromInbox } from "./actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/page-access", () => ({ requirePageAccess: vi.fn() }));
vi.mock("@/lib/handoff/requests", () => ({ answerNowAsCompanyUser: vi.fn() }));
vi.mock("@/lib/worker-proxy", () => ({ deliverHumanMessageOnWorker: vi.fn(async () => true) }));

const companyId = "11111111-1111-4111-8111-111111111111";
const chatId = "22222222-2222-4222-8222-222222222222";

const access = {
  session: { user: { id: "user-1", name: "Markus Albrecht" } },
  company: { id: companyId, name: "Acme GmbH", ownerId: "owner-1" },
  permissions: { messaging: true },
};

/** A query chain that resolves to `rows` wherever it is awaited. */
function chain(rows: unknown[]) {
  const target: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(target, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve(rows);
      return () => proxy;
    },
  });
  return proxy;
}

type Tx = { select: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; insert: ReturnType<typeof vi.fn> };

function stubDb(options: { chat?: boolean; latest?: { id: string; status: string } | null; held?: boolean }) {
  const inserted: unknown[] = [];
  const mock = db as unknown as Record<string, unknown>;
  mock.select = vi.fn(() => chain(options.chat === false ? [] : [{ id: chatId }]));
  const tx: Tx = {
    select: vi.fn(() => chain(options.latest ? [options.latest] : [])),
    update: vi.fn(() => chain(options.held === false ? [] : [{ id: "r1" }])),
    insert: vi.fn(() => ({
      values: vi.fn(async (row: unknown) => {
        inserted.push(row);
      }),
    })),
  };
  mock.transaction = vi.fn(async (fn: (t: Tx) => unknown) => fn(tx));
  return { inserted, tx };
}

describe("Inbox actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePageAccess).mockResolvedValue(access as never);
  });

  describe("sendInboxMessage", () => {
    it("rejects an empty message", async () => {
      expect(await sendInboxMessage({ companyId, chatId, text: "  " })).toEqual({ ok: false, error: "invalid" });
    });

    it("refuses users without Inbox access (members without messaging, clients)", async () => {
      vi.mocked(requirePageAccess).mockRejectedValue(new Error("Unauthorized"));
      expect(await sendInboxMessage({ companyId, chatId, text: "Hi" })).toEqual({ ok: false, error: "forbidden" });
      expect(requirePageAccess).toHaveBeenCalledWith(companyId, "messaging");
    });

    it("refuses a chat outside the company or an internal chat", async () => {
      stubDb({ chat: false });
      expect(await sendInboxMessage({ companyId, chatId, text: "Hi" })).toEqual({ ok: false, error: "not_found" });
    });

    it("answers Waiting for you as the company and delivers after commit", async () => {
      const { inserted } = stubDb({ latest: { id: "r1", status: "expired" } });
      expect(await sendInboxMessage({ companyId, chatId, text: "We fix it Thursday." })).toEqual({ ok: true });
      expect(inserted).toEqual([
        expect.objectContaining({
          chatId,
          content: "We fix it Thursday.",
          role: "assistant",
          author: "human",
          authorDisplayName: "Acme GmbH",
        }),
      ]);
      const id = (inserted[0] as { id: string }).id;
      expect(deliverHumanMessageOnWorker).toHaveBeenCalledWith(id);
    });

    it("writes under the person's name during a takeover", async () => {
      const { inserted, tx } = stubDb({ latest: { id: "r1", status: "taken_over" } });
      expect(await sendInboxMessage({ companyId, chatId, text: "Hello" })).toEqual({ ok: true });
      expect(tx.update).toHaveBeenCalled();
      expect(inserted).toEqual([expect.objectContaining({ authorDisplayName: "Markus Albrecht" })]);
    });

    it("stays read-only while the agent or the recipient handles the chat", async () => {
      for (const status of ["open", "answered", "handed_back"]) {
        const { inserted } = stubDb({ latest: { id: "r1", status } });
        expect(await sendInboxMessage({ companyId, chatId, text: "Hi" })).toEqual({ ok: false, error: "read_only" });
        expect(inserted).toEqual([]);
      }
      stubDb({ latest: null });
      expect(await sendInboxMessage({ companyId, chatId, text: "Hi" })).toEqual({ ok: false, error: "read_only" });
      expect(deliverHumanMessageOnWorker).not.toHaveBeenCalled();
    });

    it("reports a conflict when the takeover ended meanwhile", async () => {
      const { inserted } = stubDb({ latest: { id: "r1", status: "taken_over" }, held: false });
      expect(await sendInboxMessage({ companyId, chatId, text: "Hi" })).toEqual({ ok: false, error: "conflict" });
      expect(inserted).toEqual([]);
    });
  });

  describe("takeOverFromInbox", () => {
    it("takes over under the signed-in user's name", async () => {
      vi.mocked(answerNowAsCompanyUser).mockResolvedValue({ ok: true } as never);
      expect(await takeOverFromInbox({ companyId, chatId })).toEqual({ ok: true });
      expect(answerNowAsCompanyUser).toHaveBeenCalledWith({ companyId, chatId, authorName: "Markus Albrecht" });
    });

    it("needs Inbox access", async () => {
      vi.mocked(requirePageAccess).mockRejectedValue(new Error("Unauthorized"));
      expect(await takeOverFromInbox({ companyId, chatId })).toEqual({ ok: false, error: "forbidden" });
      expect(answerNowAsCompanyUser).not.toHaveBeenCalled();
    });

    it("passes a conflict through", async () => {
      vi.mocked(answerNowAsCompanyUser).mockResolvedValue({ ok: false, error: "conflict" });
      expect(await takeOverFromInbox({ companyId, chatId })).toEqual({ ok: false, error: "conflict" });
    });
  });

  describe("handBackFromInbox", () => {
    it("hands a taken-over chat back", async () => {
      (db as unknown as Record<string, unknown>).update = vi.fn(() => chain([{ id: "r1" }]));
      expect(await handBackFromInbox({ companyId, chatId })).toEqual({ ok: true });
    });

    it("reports a conflict when nothing is taken over", async () => {
      (db as unknown as Record<string, unknown>).update = vi.fn(() => chain([]));
      expect(await handBackFromInbox({ companyId, chatId })).toEqual({ ok: false, error: "conflict" });
    });
  });
});
