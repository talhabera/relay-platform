import { describe, expect, it } from "vitest";

import {
  feedRow,
  formatLiveStamp,
  formatWaited,
  formatWeekLabel,
  hourlyView,
  inboxHref,
  liveHref,
  mergeFeed,
  parseLiveSearch,
  sourcesView,
  toFeedEvent,
  type FeedEvent,
} from "./live-model";

const TZ = "Europe/Berlin";
const ID = "11111111-1111-4111-8111-111111111111";

function ev(id: string, at: string, over: Partial<FeedEvent> = {}): FeedEvent {
  return {
    id,
    companyId: "c",
    type: "handoff_sent",
    at,
    title: "Handoff sent to Markus Albrecht",
    detail: "Weekend cleaning quote",
    channel: "widget",
    refId: "r",
    ...over,
  };
}

describe("parseLiveSearch / hrefs", () => {
  it("accepts uuids only", () => {
    expect(parseLiveSearch({})).toEqual({ event: null, chat: null });
    expect(parseLiveSearch({ event: ID, chat: "nope" })).toEqual({ event: ID, chat: null });
    expect(parseLiveSearch({ chat: [ID, "x"] })).toEqual({ event: null, chat: ID });
  });

  it("builds sheet and inbox links", () => {
    expect(liveHref("/client/live")).toBe("/client/live");
    expect(liveHref("/client/live", { event: ID })).toBe(`/client/live?event=${ID}`);
    expect(liveHref("/client/live/preview", { chat: ID })).toBe(`/client/live/preview?chat=${ID}`);
    expect(inboxHref(ID)).toBe(`/messaging?chatId=${ID}`);
  });
});

describe("feed", () => {
  it("merges by id, newest first, capped", () => {
    const a = ev("a", "2026-09-25T09:00:00.000Z");
    const b = ev("b", "2026-09-25T10:00:00.000Z");
    const merged = mergeFeed([b], [a, b]);
    expect(merged.map((e) => e.id)).toEqual(["b", "a"]);
    const many = Array.from({ length: 70 }, (_, i) => ev(`e${i}`, new Date(Date.UTC(2026, 8, 25, 0, i)).toISOString()));
    expect(mergeFeed(many)).toHaveLength(50);
  });

  it("serializes dates for the client", () => {
    const row = toFeedEvent({ ...ev("a", ""), at: new Date("2026-09-25T09:46:00.000Z") });
    expect(row.at).toBe("2026-09-25T09:46:00.000Z");
  });

  it("maps types to Live event row kinds, copy and sources", () => {
    const handoff = feedRow(ev("a", "2026-09-25T09:46:00.000Z"), TZ);
    expect(handoff).toMatchObject({
      kind: "handoff",
      time: "11:46",
      text: "Handoff sent to Markus Albrecht",
      detail: "Weekend cleaning quote",
      source: "website",
      openable: true,
    });
    const lead = feedRow(
      ev("b", "2026-09-25T09:05:00.000Z", { type: "lead_inbound_qualified", title: "Isar Data GmbH", channel: "whatsapp" }),
      TZ,
    );
    expect(lead).toMatchObject({ kind: "lead", text: "Inbound lead qualified: Isar Data GmbH", source: "whatsapp" });
    const review = feedRow(ev("c", "2026-09-25T08:52:00.000Z", { type: "review_new", detail: "", channel: null }), TZ);
    expect(review).toMatchObject({ kind: "review", detail: undefined, source: null, openable: false });
  });
});

describe("formatting", () => {
  it("stamps the title row in company time", () => {
    expect(formatLiveStamp(new Date("2026-09-25T09:52:00.000Z"), TZ)).toMatch(/^Fri 25 Sept? 2026 · 11:52 /);
  });

  it("labels the ISO week", () => {
    const range = { from: new Date("2026-09-20T22:00:00.000Z"), to: new Date("2026-09-27T22:00:00.000Z") };
    expect(formatWeekLabel(range, TZ)).toMatch(/^21–27 Sept?$/);
    const split = { from: new Date("2026-09-27T22:00:00.000Z"), to: new Date("2026-10-04T22:00:00.000Z") };
    expect(formatWeekLabel(split, TZ)).toMatch(/^28 Sept? – 4 Oct$/);
  });

  it("formats waiting time", () => {
    const now = new Date("2026-09-25T10:00:00.000Z");
    expect(formatWaited(new Date("2026-09-25T09:54:00.000Z"), now)).toBe("6 min");
    expect(formatWaited(new Date("2026-09-25T08:30:00.000Z"), now)).toBe("1 h 30 min");
  });
});

describe("charts", () => {
  it("scales hourly bars to the busiest hour", () => {
    const view = hourlyView(
      {
        points: [
          { hour: 0, label: "00:00", value: 0 },
          { hour: 1, label: "01:00", value: 2 },
          { hour: 2, label: "02:00", value: 4 },
        ],
        total: 6,
        busiestHour: 2,
      },
      new Date("2026-09-25T01:30:00.000Z"),
      TZ,
    );
    expect(view.bars.map((b) => b.pct)).toEqual([0, 50, 100]);
    expect(view.bars.map((b) => b.busiest)).toEqual([false, false, true]);
    expect(view.summary).toBe("6 conversations so far · busiest hour 02:00");
    expect(view.range).toMatch(/^Today · 00–03 /);
  });

  it("folds web into the widget and sorts sources", () => {
    const rows = sourcesView([
      { channel: "whatsapp", value: 4 },
      { channel: "widget", value: 5 },
      { channel: "web", value: 2 },
      { channel: "instagram", value: 2 },
    ]);
    expect(rows.map((r) => [r.label, r.value, r.pct])).toEqual([
      ["Website widget", 7, 100],
      ["WhatsApp", 4, 57],
      ["Instagram", 2, 29],
    ]);
  });
});
