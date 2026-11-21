import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import {
  getAgentPerformance,
  getAnalyticsSummary,
  getMessagesOverTime,
} from "./analytics-queries";

type MockedDb = {
  select: ReturnType<typeof vi.fn>;
  selectDistinct: ReturnType<typeof vi.fn>;
};

const mockedDb = db as unknown as MockedDb;

/** Chainable Drizzle-style builder: every link returns itself, awaiting yields `rows`. */
function chain(rows: unknown[]) {
  const builder: Record<string, unknown> = {};
  for (const link of [
    "from",
    "where",
    "leftJoin",
    "innerJoin",
    "groupBy",
    "orderBy",
  ]) {
    builder[link] = vi.fn(() => builder);
  }
  builder.then = (resolve: (value: unknown[]) => unknown) => resolve(rows);
  return builder;
}

const start = new Date("2026-09-01T00:00:00Z");
const end = new Date("2026-09-30T00:00:00Z");

beforeEach(() => {
  mockedDb.select = vi.fn();
  mockedDb.selectDistinct = vi.fn();
});

/** Feeds getAnalyticsSummary queries in call order. */
function feedSummary(q: {
  events?: unknown[];
  chats?: unknown[];
  messages?: unknown[];
  activeAgents?: unknown[];
  byType?: unknown[];
  byAgent?: unknown[];
  byIntegration?: unknown[];
}) {
  mockedDb.select
    .mockReturnValueOnce(chain(q.events ?? []))
    .mockReturnValueOnce(chain(q.chats ?? []))
    .mockReturnValueOnce(chain(q.messages ?? []))
    .mockReturnValueOnce(chain(q.byType ?? []))
    .mockReturnValueOnce(chain(q.byAgent ?? []))
    .mockReturnValueOnce(chain(q.byIntegration ?? []));
  mockedDb.selectDistinct.mockReturnValueOnce(chain(q.activeAgents ?? []));
}

describe("getAnalyticsSummary", () => {
  it("returns zeros and empty maps when every query is empty", async () => {
    feedSummary({});

    const result = await getAnalyticsSummary("c1", start, end);

    expect(result).toEqual({
      totalEvents: 0,
      totalChats: 0,
      totalMessages: 0,
      activeAgents: 0,
      eventsByType: {},
      eventsByAgent: {},
      eventsByIntegration: {},
    });
  });

  it("falls back to agentId as key when agentName is null", async () => {
    feedSummary({ byAgent: [{ agentId: "a1", agentName: null, value: 4 }] });

    const result = await getAnalyticsSummary("c1", start, end);

    expect(result.eventsByAgent).toEqual({ a1: 4 });
  });

  it('uses "Unknown" as key when agentName and agentId are both null', async () => {
    feedSummary({ byAgent: [{ agentId: null, agentName: null, value: 2 }] });

    const result = await getAnalyticsSummary("c1", start, end);

    expect(result.eventsByAgent).toEqual({ Unknown: 2 });
  });

  it("skips integration rows whose integrationType is null", async () => {
    feedSummary({
      byIntegration: [
        { integrationType: null, value: 3 },
        { integrationType: "whatsapp", value: 2 },
      ],
    });

    const result = await getAnalyticsSummary("c1", start, end);

    expect(result.eventsByIntegration).toEqual({ whatsapp: 2 });
  });

  it("builds the full summary on the happy path", async () => {
    feedSummary({
      events: [{ value: 15 }],
      chats: [{ value: 6 }],
      messages: [{ value: 40 }],
      activeAgents: [{ agentId: "a1" }, { agentId: "a2" }],
      byType: [
        { event: "chat_started", value: 9 },
        { event: "message_sent", value: 6 },
      ],
      byAgent: [
        { agentId: "a1", agentName: "Sales Bot", value: 10 },
        { agentId: "a2", agentName: "Support Bot", value: 5 },
      ],
      byIntegration: [{ integrationType: "whatsapp", value: 7 }],
    });

    const result = await getAnalyticsSummary("c1", start, end);

    expect(result).toEqual({
      totalEvents: 15,
      totalChats: 6,
      totalMessages: 40,
      activeAgents: 2,
      eventsByType: { chat_started: 9, message_sent: 6 },
      eventsByAgent: { "Sales Bot": 10, "Support Bot": 5 },
      eventsByIntegration: { whatsapp: 7 },
    });
  });
});

describe("getMessagesOverTime", () => {
  it("formats a Date row as a UTC YYYY-MM-DD string", async () => {
    mockedDb.select.mockReturnValueOnce(
      chain([{ date: new Date("2026-09-28T00:00:00Z"), count: 5 }]),
    );

    const result = await getMessagesOverTime("c1", start, end);

    expect(result).toEqual([{ date: "2026-09-28", count: 5 }]);
  });

  it("truncates a string row at the T separator", async () => {
    mockedDb.select.mockReturnValueOnce(
      chain([{ date: "2026-09-28T00:00:00", count: 3 }]),
    );

    const result = await getMessagesOverTime("c1", start, end);

    expect(result).toEqual([{ date: "2026-09-28", count: 3 }]);
  });

  it("returns an empty array when there are no rows", async () => {
    mockedDb.select.mockReturnValueOnce(chain([]));

    const result = await getMessagesOverTime("c1", start, end);

    expect(result).toEqual([]);
  });

  it("shifts a +03:00 Date back one day because toISOString converts to UTC", async () => {
    // KNOWN RISK: UTC kayması
    // 2026-09-28T00:00:00+03:00 == 2026-09-27T21:00:00Z, so the day is reported as 27th.
    mockedDb.select.mockReturnValueOnce(
      chain([{ date: new Date("2026-09-28T00:00:00+03:00"), count: 1 }]),
    );

    const result = await getMessagesOverTime("c1", start, end);

    expect(result).toEqual([{ date: "2026-09-27", count: 1 }]);
  });
});

describe("getAgentPerformance", () => {
  it("reports messageCount 0 for an agent with chats but no message row", async () => {
    mockedDb.select
      .mockReturnValueOnce(
        chain([{ agentId: "a1", agentName: "Sales Bot", chatCount: 2 }]),
      )
      .mockReturnValueOnce(chain([]));

    const result = await getAgentPerformance("c1", start, end);

    expect(result).toEqual([
      { agentId: "a1", agentName: "Sales Bot", messageCount: 0, chatCount: 2 },
    ]);
  });

  it("maps message counts to the matching agent only", async () => {
    mockedDb.select
      .mockReturnValueOnce(
        chain([
          { agentId: "a1", agentName: "Sales Bot", chatCount: 3 },
          { agentId: "a2", agentName: "Support Bot", chatCount: 1 },
        ]),
      )
      .mockReturnValueOnce(
        chain([
          { agentId: "a1", messageCount: 12 },
          { agentId: "a2", messageCount: 4 },
        ]),
      );

    const result = await getAgentPerformance("c1", start, end);

    expect(result).toEqual([
      { agentId: "a1", agentName: "Sales Bot", messageCount: 12, chatCount: 3 },
      { agentId: "a2", agentName: "Support Bot", messageCount: 4, chatCount: 1 },
    ]);
  });
});
