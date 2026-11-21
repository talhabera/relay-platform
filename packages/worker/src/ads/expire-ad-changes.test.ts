import { describe, expect, it } from "vitest";
import type { ChatStatus, CheckpointKind, CheckpointStatus } from "@relay/db";
import {
  expireAdChangeCards,
  isExpiredAdChangeCard,
  type ExpireAdChangeStore,
} from "./expire-ad-changes";

const now = new Date("2026-11-06T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);

type Card = {
  id: string;
  kind: CheckpointKind;
  status: CheckpointStatus;
  createdAt: Date;
  chatId: string | null;
  executeResult: Record<string, unknown> | null;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
};

const card = (id: string, over: Partial<Card>): Card => ({
  id,
  kind: "ad_change",
  status: "pending",
  createdAt: hoursAgo(25),
  chatId: "chat-1",
  executeResult: null,
  resolvedAt: null,
  resolvedByUserId: null,
  ...over,
});

function memStore(cards: Card[], chats: Map<string, ChatStatus>) {
  let updates = 0;
  const store: ExpireAdChangeStore = {
    async discardExpired({ cutoff, now: at, result }) {
      const moved: { id: string; chatId: string | null }[] = [];
      for (const c of cards) {
        if (!isExpiredAdChangeCard(c, cutoff)) continue;
        Object.assign(c, { status: "discarded", executeResult: result, resolvedAt: at, resolvedByUserId: null });
        moved.push({ id: c.id, chatId: c.chatId });
      }
      return moved;
    },
    async sessionState(chatId) {
      const status = chats.get(chatId);
      if (!status) return null;
      const open = cards.filter(
        (c) => c.chatId === chatId && ["pending", "stale", "failed"].includes(c.status),
      ).length;
      return { status, openCheckpoints: open, openQuestions: 0 };
    },
    async setSessionStatus(chatId, status) {
      updates++;
      chats.set(chatId, status);
    },
  };
  return { store, updates: () => updates };
}

describe("expireAdChangeCards", () => {
  it("discards a pending ad_change card older than 24 h and leaves the rest alone", async () => {
    const cards = [
      card("old", {}),
      card("young", { createdAt: hoursAgo(23) }),
      card("approved", { status: "approved", resolvedByUserId: "u-1" }),
      card("lead", { kind: "lead_delivery" }),
    ];
    const chats = new Map<string, ChatStatus>([["chat-1", "needs_you"]]);
    const { store } = memStore(cards, chats);

    expect(await expireAdChangeCards(now, store)).toEqual(["old"]);
    expect(cards[0]).toMatchObject({
      status: "discarded",
      executeResult: { status: "expired" },
      resolvedAt: now,
      resolvedByUserId: null,
    });
    expect(cards.slice(1).map((c) => [c.id, c.status, c.executeResult])).toEqual([
      ["young", "pending", null],
      ["approved", "approved", null],
      ["lead", "pending", null],
    ]);
    // Two cards are still open on the session.
    expect(chats.get("chat-1")).toBe("needs_you");
  });

  it("running twice changes nothing the second time", async () => {
    const cards = [card("old", { chatId: "chat-2" })];
    const chats = new Map<string, ChatStatus>([["chat-2", "needs_you"]]);
    const { store, updates } = memStore(cards, chats);
    await expireAdChangeCards(now, store);
    expect(chats.get("chat-2")).toBe("completed");
    const snapshot = JSON.stringify(cards);
    expect(await expireAdChangeCards(new Date(now.getTime() + 60_000), store)).toEqual([]);
    expect(JSON.stringify(cards)).toBe(snapshot);
    expect(updates()).toBe(1);
  });

  it("a card approved a moment before the sweep is not discarded (status = 'pending' guard)", async () => {
    const cards = [card("raced", { status: "approved", resolvedByUserId: "u-1", resolvedAt: hoursAgo(0) })];
    const { store } = memStore(cards, new Map([["chat-1", "running"]]));
    expect(await expireAdChangeCards(now, store)).toEqual([]);
    expect(cards[0].status).toBe("approved");
  });

  it("cron cards have no session to recompute", async () => {
    const cards = [card("cron", { chatId: null })];
    const { store, updates } = memStore(cards, new Map());
    expect(await expireAdChangeCards(now, store)).toEqual(["cron"]);
    expect(updates()).toBe(0);
  });
});
