import { describe, expect, it } from "vitest";

import {
  filterNeedsYou,
  formatNeedsYouAge,
  needsYouFacets,
  needsYouPageHref,
  parseNeedsYouFilter,
  toNeedsYouRow,
  type NeedsYouItemLike,
} from "./needs-you-view";

const NOW = new Date("2026-09-25T11:52:00.000Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

function item(over: Partial<NeedsYouItemLike> & Pick<NeedsYouItemLike, "id" | "type">): NeedsYouItemLike {
  return {
    agentId: "agent",
    agentName: "Agent",
    title: over.id,
    createdAt: ago(10),
    chatId: null,
    cronRunId: null,
    cronJobId: null,
    tier: 3,
    href: `/operator?x=${over.id}`,
    workflow: null,
    ...over,
  };
}

// The canonical Needs you snapshot (docs/design/README.md), already in server order.
const snapshot: NeedsYouItemLike[] = [
  item({ id: "places", type: "failed_run", tier: 1, workflow: "Lead engine", createdAt: ago(360), error: "Gather paused" }),
  item({ id: "offices", type: "agent_question", tier: 2, workflow: "Lead engine", createdAt: ago(38) }),
  item({ id: "sequence", type: "checkpoint", tier: 2, workflow: "Lead engine", createdAt: ago(12) }),
  item({ id: "posts", type: "checkpoint", workflow: "Content calendar", createdAt: ago(120) }),
  item({ id: "replies", type: "checkpoint", workflow: "Review management", createdAt: ago(60) }),
];

describe("formatNeedsYouAge", () => {
  it("formats minutes, hours and days", () => {
    expect(formatNeedsYouAge(ago(0), NOW)).toBe("just now");
    expect(formatNeedsYouAge(ago(12), NOW)).toBe("12m ago");
    expect(formatNeedsYouAge(new Date(ago(360)), NOW)).toBe("6h ago");
    expect(formatNeedsYouAge(ago(60 * 24 * 3), NOW)).toBe("3d ago");
  });
});

describe("toNeedsYouRow", () => {
  it("maps type to kind, workflow tag and a failed run's error as impact", () => {
    expect(toNeedsYouRow(snapshot[0], NOW)).toEqual({
      id: "places",
      kind: "failed-run",
      title: "places",
      workflow: "Lead engine",
      impact: "Gather paused",
      agent: "Agent",
      age: "6h ago",
      href: "/operator?x=places",
    });
    const q = toNeedsYouRow(item({ id: "q", type: "agent_question" }), NOW);
    expect(q.kind).toBe("question");
    expect(q.workflow).toBeUndefined();
    expect(q.impact).toBeUndefined();
  });

  it("maps a brief to the brief kind, linked to the Home tile", () => {
    const b = toNeedsYouRow(item({ id: "b", type: "brief", title: "Today's brief", href: "/home#brief" }), NOW);
    expect(b).toMatchObject({ kind: "brief", title: "Today's brief", href: "/home#brief" });
    expect(b.impact).toBeUndefined();
  });

  it("shows a brief under All only, with no KIND chip of its own", () => {
    const items = [item({ id: "b", type: "brief" }), item({ id: "q", type: "agent_question" })];
    const f = needsYouFacets(items, { kind: "all", workflow: null });
    expect(f.kind).toEqual({ all: 2, checkpoint: 0, question: 1, "failed-run": 0 });
    expect(filterNeedsYou(items, { kind: "question", workflow: null }).map((i) => i.id)).toEqual(["q"]);
    expect(filterNeedsYou(items, { kind: "all", workflow: null })).toHaveLength(2);
  });
});

describe("filter", () => {
  it("parses unknown values to all", () => {
    expect(parseNeedsYouFilter({})).toEqual({ kind: "all", workflow: null });
    expect(parseNeedsYouFilter({ kind: "nope", workflow: " " })).toEqual({ kind: "all", workflow: null });
    expect(parseNeedsYouFilter({ kind: ["question"], workflow: "Lead engine" })).toEqual({
      kind: "question",
      workflow: "Lead engine",
    });
  });

  it("filters by kind and workflow, keeping server order", () => {
    expect(filterNeedsYou(snapshot, { kind: "checkpoint", workflow: null }).map((i) => i.id)).toEqual([
      "sequence",
      "posts",
      "replies",
    ]);
    expect(filterNeedsYou(snapshot, { kind: "all", workflow: "Lead engine" }).map((i) => i.id)).toEqual([
      "places",
      "offices",
      "sequence",
    ]);
    expect(filterNeedsYou(snapshot, { kind: "question", workflow: "Content calendar" })).toEqual([]);
  });

  it("counts chips like Figma 06/needs-you/list (All 5, Checkpoints 3, Questions 1, Failed runs 1)", () => {
    const f = needsYouFacets(snapshot, { kind: "all", workflow: null });
    expect(f.kind).toEqual({ all: 5, checkpoint: 3, question: 1, "failed-run": 1 });
    expect(f.workflows).toEqual([
      { name: "Lead engine", count: 3 },
      { name: "Content calendar", count: 1 },
      { name: "Review management", count: 1 },
    ]);
  });

  it("kind counts follow the workflow filter and workflow counts follow the kind filter", () => {
    const f = needsYouFacets(snapshot, { kind: "checkpoint", workflow: "Lead engine" });
    expect(f.kind).toEqual({ all: 3, checkpoint: 1, question: 1, "failed-run": 1 });
    expect(f.workflows.map((w) => [w.name, w.count])).toEqual([
      ["Lead engine", 1],
      ["Content calendar", 1],
      ["Review management", 1],
    ]);
  });

  it("builds page hrefs", () => {
    expect(needsYouPageHref({ kind: "all", workflow: null })).toBe("/needs-you");
    expect(needsYouPageHref({ kind: "question", workflow: "Lead engine" }, "q1")).toBe(
      "/needs-you?kind=question&workflow=Lead+engine&item=q1",
    );
  });
});

describe("detail pane helpers", () => {
  it("maps state to a status chip", async () => {
    const { needsYouStatus } = await import("./needs-you-view");
    expect(needsYouStatus(snapshot[0])).toEqual({ tone: "error", label: "Run failed" });
    expect(needsYouStatus(snapshot[1])).toEqual({ tone: "needs-you", label: "Needs you" });
    expect(needsYouStatus({ ...snapshot[2], checkpointStatus: "stale" })).toEqual({ tone: "pending", label: "Stale" });
    expect(needsYouStatus({ ...snapshot[2], checkpointStatus: "failed" })).toEqual({ tone: "error", label: "Failed" });
    expect(needsYouStatus({ ...snapshot[2], checkpointStatus: "pending" }).tone).toBe("needs-you");
  });

  it("labels the open action by destination and explains the tier", async () => {
    const { needsYouImpactCopy, needsYouOpenLabel } = await import("./needs-you-view");
    expect(needsYouOpenLabel("/messaging?chatId=c")).toBe("Open conversation");
    expect(needsYouOpenLabel("/operator?agentId=a")).toBe("Open session");
    expect(needsYouOpenLabel("/home#brief")).toBe("Open brief");
    expect(needsYouImpactCopy(1)).toMatch(/lead workflow stopped/);
    expect(needsYouImpactCopy(2)).toMatch(/qualified leads/);
    expect(needsYouImpactCopy(3)).toMatch(/Does not hold up leads/);
  });

  it("puts the live card in the pane only for a customer-chat lead_delivery checkpoint (W5GAP)", async () => {
    const { needsYouLiveCheckpoint } = await import("./needs-you-view");
    const leadDelivery = item({
      id: "cp-1",
      type: "checkpoint",
      checkpointKind: "lead_delivery",
      chatId: "chat-c",
      onCustomerChat: true,
    });
    expect(needsYouLiveCheckpoint(leadDelivery)).toEqual({ chatId: "chat-c", checkpointId: "cp-1" });
    expect(needsYouLiveCheckpoint({ ...leadDelivery, onCustomerChat: false })).toBeNull();
    expect(needsYouLiveCheckpoint({ ...leadDelivery, checkpointKind: "outreach" })).toBeNull();
    expect(needsYouLiveCheckpoint({ ...leadDelivery, chatId: null })).toBeNull();
    expect(needsYouLiveCheckpoint({ ...leadDelivery, type: "agent_question" })).toBeNull();
  });
});
