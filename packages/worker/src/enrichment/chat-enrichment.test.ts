import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const { generateText, captured } = vi.hoisted(() => ({
  generateText: vi.fn(),
  captured: { where: null as SQL | null, having: null as SQL | null, rows: [] as unknown[], first: [] as unknown[] },
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return { ...actual, generateText: (...a: unknown[]) => generateText(...a) };
});

vi.mock("@relay/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@relay/db")>();
  return {
    ...actual,
    db: {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: (cond: SQL) => {
              captured.where = cond;
              return {
                groupBy: () => ({
                  having: (cond: SQL) => {
                    captured.having = cond;
                    return { orderBy: () => ({ limit: async () => captured.rows }) };
                  },
                }),
              };
            },
          }),
          where: () => ({ orderBy: () => ({ limit: async () => captured.first }) }),
        }),
      }),
    },
  };
});

import {
  buildTranscript,
  classifyConversation,
  durationSeconds,
  enrichChat,
  enrichQuietChats,
  ENRICH_BATCH_SIZE,
  listChatsDueForEnrichment,
  normalizeClassification,
  TRANSCRIPT_CHAR_LIMIT,
  TRANSCRIPT_MESSAGE_LIMIT,
  type EnrichmentDeps,
} from "./chat-enrichment";

const dialect = new PgDialect();

function fakeDeps(overrides: Partial<EnrichmentDeps> = {}): EnrichmentDeps & { saved: Array<[string, unknown]> } {
  const saved: Array<[string, unknown]> = [];
  return {
    saved,
    listDue: vi.fn(async () => []),
    loadTranscript: vi.fn(async () => [
      { role: "user", content: "Hallo, wann holt ihr den Müll ab?" },
      { role: "assistant", content: "Am Dienstag." },
    ]),
    classify: vi.fn(async () => ({ sentimentScore: 25, language: "de" })),
    save: vi.fn(async (chatId: string, enrichment: unknown) => {
      saved.push([chatId, enrichment]);
    }),
    ...overrides,
  };
}

describe("durationSeconds", () => {
  it("rounds the first-to-last span to seconds and never goes negative", () => {
    expect(durationSeconds(new Date("2026-10-01T10:00:00Z"), new Date("2026-10-01T10:21:00.400Z"))).toBe(1260);
    expect(durationSeconds(new Date("2026-10-01T10:00:05Z"), new Date("2026-10-01T10:00:00Z"))).toBe(0);
  });
});

describe("buildTranscript", () => {
  it("keeps customer and business turns, labelled, without tool or system rows", () => {
    const text = buildTranscript([
      { role: "system", content: "internal" },
      { role: "user", content: "Hi   there\nfriend" },
      { role: "tool", content: "{}" },
      { role: "assistant", content: "Hello!" },
      { role: "user", content: "   " },
    ]);
    expect(text).toBe("Customer: Hi there friend\nBusiness: Hello!");
  });

  it("keeps only the most recent messages and clips long ones", () => {
    const rows = Array.from({ length: TRANSCRIPT_MESSAGE_LIMIT + 5 }, (_, i) => ({
      role: "user",
      content: i === TRANSCRIPT_MESSAGE_LIMIT + 4 ? "x".repeat(TRANSCRIPT_CHAR_LIMIT + 50) : `m${i}`,
    }));
    const lines = buildTranscript(rows).split("\n");
    expect(lines).toHaveLength(TRANSCRIPT_MESSAGE_LIMIT);
    expect(lines[0]).toBe("Customer: m5");
    expect(lines.at(-1)).toBe(`Customer: ${"x".repeat(TRANSCRIPT_CHAR_LIMIT)}…`);
  });
});

describe("normalizeClassification", () => {
  it("clamps and rounds the score and lower-cases the language", () => {
    expect(normalizeClassification({ sentimentScore: 104.6, language: "EN" })).toEqual({ sentimentScore: 100, language: "en" });
    expect(normalizeClassification({ sentimentScore: -3, language: "de-DE" })).toEqual({ sentimentScore: 0, language: "de" });
  });

  it("drops an unusable language and rejects a non-numeric score", () => {
    expect(normalizeClassification({ sentimentScore: 50, language: "??" })).toEqual({ sentimentScore: 50, language: null });
    expect(normalizeClassification({ sentimentScore: 50, language: null })).toEqual({ sentimentScore: 50, language: null });
    expect(normalizeClassification({ sentimentScore: Number.NaN, language: "en" })).toBeNull();
  });
});

describe("classifyConversation", () => {
  const key = process.env.ANTHROPIC_API_KEY;
  // A block body: a function returned from beforeEach runs as its teardown.
  beforeEach(() => {
    generateText.mockReset();
  });
  afterEach(() => {
    if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = key;
  });

  it("skips the model without an API key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(await classifyConversation("Customer: hi")).toBeNull();
    expect(generateText).not.toHaveBeenCalled();
  });

  it("returns the normalized structured output", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    generateText.mockResolvedValue({ output: { sentimentScore: 82.2, language: "TR" } });
    expect(await classifyConversation("Customer: teşekkürler")).toEqual({ sentimentScore: 82, language: "tr" });
    expect(generateText.mock.calls[0][0]).toMatchObject({ prompt: "Customer: teşekkürler" });
  });

  it("returns null when the call fails", async () => {
    process.env.ANTHROPIC_API_KEY = "test";
    generateText.mockImplementation(async () => {
      throw new Error("overloaded");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await classifyConversation("Customer: hi")).toBeNull();
  });
});

describe("enrichChat", () => {
  const due = {
    chatId: "c1",
    firstAt: new Date("2026-09-24T15:49:00Z"),
    lastAt: new Date("2026-09-24T16:10:00Z"),
  };

  it("writes duration, sentiment band, score, language and the enriched-through mark", async () => {
    const deps = fakeDeps();
    await enrichChat(due, deps);
    expect(deps.saved).toEqual([
      [
        "c1",
        {
          durationSeconds: 1260,
          enrichedThrough: due.lastAt,
          sentimentScore: 25,
          sentiment: "negative",
          language: "de",
        },
      ],
    ]);
    expect(deps.classify).toHaveBeenCalledWith("Customer: Hallo, wann holt ihr den Müll ab?\nBusiness: Am Dienstag.");
  });

  it("maps scores to bands", async () => {
    for (const [score, band] of [[50, "neutral"], [61, "positive"], [39, "negative"], [40, "neutral"], [60, "neutral"]] as const) {
      const deps = fakeDeps({ classify: async () => ({ sentimentScore: score, language: "en" }) });
      await enrichChat(due, deps);
      expect(deps.saved[0][1]).toMatchObject({ sentiment: band, sentimentScore: score });
    }
  });

  it("keeps stored sentiment and language when classification fails, but still marks the chat", async () => {
    const deps = fakeDeps({ classify: async () => null });
    await enrichChat(due, deps);
    expect(deps.saved[0][1]).toEqual({ durationSeconds: 1260, enrichedThrough: due.lastAt });
  });

  it("does not call the model for a conversation with no text turns", async () => {
    const deps = fakeDeps({ loadTranscript: async () => [{ role: "tool", content: "{}" }] });
    await enrichChat(due, deps);
    expect(deps.classify).not.toHaveBeenCalled();
    expect(deps.saved).toHaveLength(1);
  });
});

describe("enrichQuietChats", () => {
  it("enriches one batch and isolates per-chat failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const now = new Date("2026-10-06T12:00:00Z");
    const at = new Date("2026-10-06T11:00:00Z");
    const deps = fakeDeps({
      listDue: vi.fn(async () => [
        { chatId: "a", firstAt: at, lastAt: at },
        { chatId: "b", firstAt: at, lastAt: at },
      ]),
      save: vi.fn(async (chatId: string) => {
        if (chatId === "a") throw new Error("db down");
      }),
    });
    expect(await enrichQuietChats(now, deps)).toEqual({ enriched: 1, failed: 1 });
    expect(deps.listDue).toHaveBeenCalledWith(now, ENRICH_BATCH_SIZE);
  });
});

describe("listChatsDueForEnrichment", () => {
  it("selects quiet customer chats with messages newer than the enriched mark", async () => {
    const lastAt = new Date("2026-10-06T11:00:00Z");
    const firstAt = new Date("2026-10-06T10:30:00Z");
    captured.rows = [{ chatId: "c1", lastAt }];
    captured.first = [{ at: firstAt }];

    const due = await listChatsDueForEnrichment(new Date("2026-10-06T12:00:00Z"), 5);
    expect(due).toEqual([{ chatId: "c1", firstAt, lastAt }]);

    const where = dialect.sqlToQuery(captured.where!);
    expect(where.sql).toContain('"chats"."channel_type" in');
    expect(where.params).toEqual(expect.arrayContaining(["whatsapp", "widget", "web"]));
    expect(where.params).not.toContain("operator");

    const having = dialect.sqlToQuery(captured.having!).sql;
    expect(having).toContain("date_trunc('milliseconds', max(\"messages\".\"created_at\"))");
    expect(having).toContain('"chats"."enriched_through" is null or "chats"."enriched_through" <');
  });
});
