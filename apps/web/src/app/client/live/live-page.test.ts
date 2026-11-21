import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// db.select() chains resolve by the table passed to `from()`.
const tableRows = new Map<unknown, unknown[]>();
const chatsFindFirst = vi.fn();
const agentsFindFirst = vi.fn();

function chain() {
  let table: unknown;
  const c: Record<string, unknown> = {};
  for (const m of ["where", "orderBy", "limit", "groupBy"]) c[m] = () => c;
  c.from = (t: unknown) => {
    table = t;
    return c;
  };
  c.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(tableRows.get(table) ?? []).then(resolve, reject);
  return c;
}

vi.mock("@/db", () => ({
  db: {
    select: () => chain(),
    query: {
      chats: { findFirst: (...a: unknown[]) => chatsFindFirst(...a) },
      agents: { findFirst: (...a: unknown[]) => agentsFindFirst(...a) },
    },
  },
}));
vi.mock("@/lib/auth-server", () => ({ requireSession: vi.fn() }));
vi.mock("@/lib/operator/access", () => ({ requireClientAccess: vi.fn() }));
vi.mock("@/lib/client/portal", () => ({ resolvePortalCompanyId: vi.fn() }));
vi.mock("@/lib/live/summary", () => ({ getLiveSummary: vi.fn() }));
vi.mock("@/lib/live/feed", () => ({
  FEED_DEFAULT_LIMIT: 20,
  portalEventsReader: { listPortalEvents: vi.fn() },
}));

import { handoffRequests, messages, portalEvents } from "@/db/schema";
import { requireSession } from "@/lib/auth-server";
import { resolvePortalCompanyId } from "@/lib/client/portal";
import { portalEventsReader } from "@/lib/live/feed";
import type { LiveSummary } from "@/lib/live/summary";
import { getLiveSummary } from "@/lib/live/summary";
import { requireClientAccess } from "@/lib/operator/access";

import { FeedList, feedStreamUrl } from "./live-feed";
import { feedRow, toFeedEvent } from "./live-model";
import { LiveCharts, LiveGoalStrip, PreviewBar, TodayMetrics } from "./live-view";
import { loadLivePage, resolveEventChatId } from "./load-live";

const COMPANY = { id: "c-acme", name: "Acme GmbH" };
const NOW = new Date("2026-09-25T09:52:00.000Z");
const CHAT = "22222222-2222-4222-8222-222222222222";
const EVENT = "33333333-3333-4333-8333-333333333333";

const summary: LiveSummary = {
  companyId: COMPANY.id,
  timeZone: "Europe/Berlin",
  generatedAt: NOW,
  week: {
    weekId: "2026-W39",
    range: { from: new Date("2026-09-20T22:00:00.000Z"), to: new Date("2026-09-27T22:00:00.000Z") },
    qualifiedDelivered: 6,
    inbound: 9,
    qualityScore: 82,
    costPerQualifiedLead: { tokens: 1, tokensPerLead: 1, estimatedUsdPerLead: 41 },
    target: { metricKey: "leads.qualified_delivered", weeklyTarget: 10, value: 6 },
  },
  today: {
    range: { from: new Date("2026-09-24T22:00:00.000Z"), to: new Date("2026-09-25T22:00:00.000Z") },
    conversations: 14,
    inboundQualified: 3,
    waitingForStaff: { count: 1, oldestAt: new Date("2026-09-25T09:46:00.000Z") },
    hourly: {
      points: [
        { hour: 10, label: "10:00", value: 3 },
        { hour: 11, label: "11:00", value: 4 },
      ],
      total: 7,
      busiestHour: 11,
    },
    sources: [
      { channel: "widget", value: 7 },
      { channel: "whatsapp", value: 4 },
    ],
  },
};

const event = {
  id: EVENT,
  companyId: COMPANY.id,
  type: "handoff_sent" as const,
  at: new Date("2026-09-25T09:46:00.000Z"),
  title: "Handoff sent to Markus Albrecht",
  detail: "Weekend cleaning quote",
  channel: "widget" as const,
  refId: "h1",
};

beforeEach(() => {
  vi.clearAllMocks();
  tableRows.clear();
  vi.mocked(requireSession).mockResolvedValue({ user: { id: "u-markus" } } as never);
  vi.mocked(resolvePortalCompanyId).mockResolvedValue(COMPANY.id);
  vi.mocked(requireClientAccess).mockResolvedValue({ company: COMPANY, role: "client" } as never);
  vi.mocked(getLiveSummary).mockResolvedValue(summary);
  vi.mocked(portalEventsReader.listPortalEvents).mockResolvedValue([event]);
  chatsFindFirst.mockResolvedValue({
    id: CHAT,
    title: "Lukas Brenner",
    visitorId: null,
    channelType: "widget",
    agentId: "a1",
    createdAt: new Date("2026-09-25T09:43:00.000Z"),
  });
  agentsFindFirst.mockResolvedValue({ name: "Acme Website Assistant" });
});

describe("loadLivePage", () => {
  it("authorizes with requireClientAccess (read, not mutation) and serializes the feed", async () => {
    const data = await loadLivePage({ event: null, chat: null }, NOW);
    expect(requireClientAccess).toHaveBeenCalledWith(COMPANY.id);
    expect(portalEventsReader.listPortalEvents).toHaveBeenCalledWith(COMPANY.id, { limit: 20 });
    if (data.kind !== "live") throw new Error(data.kind);
    expect(data.readOnly).toBe(false);
    expect(data.events[0].at).toBe("2026-09-25T09:46:00.000Z");
    expect(data.conversation).toBeNull();
  });

  it("returns no-company when the viewer has no portal company", async () => {
    vi.mocked(resolvePortalCompanyId).mockResolvedValue(null);
    expect(await loadLivePage({ event: null, chat: null }, NOW)).toEqual({ kind: "no-company" });
    expect(requireClientAccess).not.toHaveBeenCalled();
  });

  it("is read-only for the owner / member preview", async () => {
    vi.mocked(requireClientAccess).mockResolvedValue({ company: COMPANY, role: "owner" } as never);
    const data = await loadLivePage({ event: null, chat: null }, NOW);
    expect(data.kind === "live" && data.readOnly).toBe(true);
  });

  it("opens the waiting conversation from ?chat and finds the oldest waiting request", async () => {
    tableRows.set(handoffRequests, [
      {
        chatId: CHAT,
        since: new Date("2026-09-25T09:46:00.000Z"),
        id: "h1",
        status: "open",
        mode: "quick_answer",
        reason: "price",
        questions: [{ text: "Weekend rate?", askedAt: "" }],
        recipientName: "Markus Albrecht",
        recipientWhatsapp: "+49",
        createdAt: new Date("2026-09-25T09:46:00.000Z"),
        notifiedAt: null,
        expiresAt: new Date("2026-09-25T11:46:00.000Z"),
      },
    ]);
    tableRows.set(messages, [
      { id: "m1", role: "user", author: null, authorDisplayName: null, content: "Hi", createdAt: new Date("2026-09-25T09:43:00.000Z") },
    ]);
    const data = await loadLivePage({ event: null, chat: CHAT }, NOW);
    if (data.kind !== "live") throw new Error(data.kind);
    expect(data.waitingOldest).toMatchObject({ chatId: CHAT, customer: "Lukas Brenner" });
    expect(data.conversation).toMatchObject({
      chatId: CHAT,
      customer: "Lukas Brenner",
      meta: "Acme Website Assistant · Website widget",
      banner: { title: "Waiting for your answer", waited: "Customer waiting 6 min" },
    });
  });

  it("ignores a chat outside the company", async () => {
    chatsFindFirst.mockResolvedValue(undefined);
    const data = await loadLivePage({ event: null, chat: CHAT }, NOW);
    expect(data.kind === "live" && data.conversation).toBeNull();
  });
});

describe("resolveEventChatId", () => {
  it("follows a handoff_sent row to its request's chat", async () => {
    tableRows.set(portalEvents, [{ type: "handoff_sent", refId: "h1" }]);
    tableRows.set(handoffRequests, [{ chatId: CHAT }]);
    expect(await resolveEventChatId(COMPANY.id, EVENT)).toBe(CHAT);
  });

  it("returns null for rows without a conversation", async () => {
    tableRows.set(portalEvents, [{ type: "review_new", refId: "r1" }]);
    expect(await resolveEventChatId(COMPANY.id, EVENT)).toBeNull();
    tableRows.set(portalEvents, []);
    expect(await resolveEventChatId(COMPANY.id, EVENT)).toBeNull();
  });
});

describe("Live view", () => {
  it("renders only cards with a source", () => {
    const html = renderToStaticMarkup(
      h(TodayMetrics, {
        summary,
        waitingOldest: { chatId: CHAT, customer: "Lukas Brenner", since: new Date("2026-09-25T09:46:00.000Z") },
        waitingHref: `/client/live?chat=${CHAT}`,
        now: NOW,
      }),
    );
    expect(html).toContain("Conversations today");
    expect(html).toContain("Qualified inbound leads");
    expect(html).toContain("Lukas Brenner · 6 min");
    expect(html).toContain(`href="/client/live?chat=${CHAT}"`);
    for (const hidden of ["Site visits booked", "Median first reply", "Resolved without staff", "live now"]) {
      expect(html).not.toContain(hidden);
    }
  });

  it("renders the goal strip only with a weekly target", () => {
    expect(renderToStaticMarkup(h(LiveGoalStrip, { summary }))).toContain("6");
    const noTarget = { ...summary, week: { ...summary.week, target: null } };
    expect(renderToStaticMarkup(h(LiveGoalStrip, { summary: noTarget }))).toBe("");
  });

  it("renders the hourly chart and sources", () => {
    const html = renderToStaticMarkup(h(LiveCharts, { summary }));
    expect(html).toContain("Conversations by hour");
    expect(html).toContain("7 conversations so far · busiest hour 11:00");
    expect(html).toContain("Website widget");
    expect(html).toContain("14 conversations");
  });

  it("links openable feed rows to the sheet", () => {
    const rows = [feedRow(toFeedEvent(event), "Europe/Berlin")];
    const html = renderToStaticMarkup(h(FeedList, { rows, basePath: "/client/live/preview" }));
    expect(html).toContain(`href="/client/live/preview?event=${EVENT}"`);
    expect(html).toContain("11:46");
    expect(renderToStaticMarkup(h(FeedList, { rows: [], basePath: "/client/live" }))).toContain("Nothing yet today");
  });

  it("tails after the newest server row", () => {
    expect(feedStreamUrl(COMPANY.id, EVENT)).toBe(`/api/client/live/events?companyId=${COMPANY.id}&after=${EVENT}`);
    expect(feedStreamUrl(COMPANY.id, undefined)).toBe(`/api/client/live/events?companyId=${COMPANY.id}`);
  });

  it("renders the preview bar", () => {
    const html = renderToStaticMarkup(h(PreviewBar, { companyName: "Acme GmbH", exitHref: "/home" }));
    expect(html).toContain("Client portal preview");
    expect(html).toContain("You are seeing what Acme GmbH client users see.");
    expect(html).toContain('href="/home"');
  });
});
