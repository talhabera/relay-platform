import { describe, expect, it } from "vitest";

import {
  buildTimeline,
  composerMode,
  conversationChip,
  countTabs,
  filterConversations,
  formatDuration,
  formatListTime,
  handoffEvents,
  handoffNarrative,
  handoffRowChip,
  humanizeTool,
  isWaitingForYou,
  toInboxSource,
  type InboxConversation,
  type InboxHandoff,
} from "./inbox-model";

const TZ = "Europe/Berlin";
const at = (iso: string) => new Date(iso);

function conversation(overrides: Partial<InboxConversation>): InboxConversation {
  return {
    id: "c1",
    customer: "Katrin Vogel",
    source: "widget",
    agentLine: "Acme Website Assistant",
    handoff: false,
    time: "14:32",
    snippet: "Quote for a 1,200 m² office",
    chip: { tone: "live", label: "Open" },
    waiting: false,
    escalated: false,
    ...overrides,
  };
}

function request(overrides: Partial<InboxHandoff>): InboxHandoff {
  return {
    id: "r1",
    status: "open",
    mode: "quick_answer",
    reason: "complaints go to a person.",
    questions: [{ text: "Bins were not emptied", askedAt: "2026-09-24T14:10:00.000Z" }],
    recipientName: "Markus Albrecht",
    recipientWhatsapp: "+491700000000",
    createdAt: at("2026-09-24T14:10:00.000Z"),
    notifiedAt: null,
    expiresAt: at("2026-09-24T16:10:00.000Z"),
    answeredAt: null,
    takenOverAt: null,
    expiredAt: null,
    handedBackAt: null,
    handBackReason: null,
    ...overrides,
  };
}

describe("toInboxSource", () => {
  it("maps web and widget to the website widget, keeps the rest", () => {
    expect(toInboxSource("web")).toBe("widget");
    expect(toInboxSource("widget")).toBe("widget");
    expect(toInboxSource(null)).toBe("widget");
    expect(toInboxSource("whatsapp")).toBe("whatsapp");
    expect(toInboxSource("instagram")).toBe("instagram");
  });
});

describe("Waiting for you", () => {
  const expired = { status: "expired" as const, expiredAt: at("2026-09-24T16:10:00.000Z") };

  it("holds expired requests nobody answered from the Inbox", () => {
    expect(isWaitingForYou(expired, null)).toBe(true);
    expect(isWaitingForYou(expired, at("2026-09-24T15:00:00.000Z"))).toBe(true);
  });

  it("drops the conversation as soon as anyone replies from the Inbox", () => {
    expect(isWaitingForYou(expired, at("2026-09-24T16:11:00.000Z"))).toBe(false);
  });

  it("ignores every other state", () => {
    for (const status of ["open", "answered", "taken_over", "handed_back"] as const) {
      expect(isWaitingForYou({ status, expiredAt: null }, null)).toBe(false);
    }
    expect(isWaitingForYou(null, null)).toBe(false);
  });
});

describe("tabs, search and source filter", () => {
  const list = [
    conversation({ id: "a" }),
    conversation({ id: "b", customer: "Tobias Lang", escalated: true, waiting: true, handoff: true }),
    conversation({ id: "c", customer: "Lukas Brenner", escalated: true, handoff: true, source: "whatsapp" }),
    conversation({ id: "d", customer: "Lisa Hofmann", source: "instagram", snippet: "Do you use eco products?" }),
  ];

  it("counts Waiting for you and Escalated", () => {
    expect(countTabs(list)).toEqual({ all: 4, waiting: 1, escalated: 2 });
  });

  it("filters by tab", () => {
    expect(filterConversations(list, { tab: "waiting", query: "", source: "all" }).map((c) => c.id)).toEqual(["b"]);
    expect(filterConversations(list, { tab: "escalated", query: "", source: "all" }).map((c) => c.id)).toEqual(["b", "c"]);
    expect(filterConversations(list, { tab: "all", query: "", source: "all" })).toHaveLength(4);
  });

  it("searches customer, agent line and snippet, case-insensitively", () => {
    expect(filterConversations(list, { tab: "all", query: "ECO", source: "all" }).map((c) => c.id)).toEqual(["d"]);
    expect(filterConversations(list, { tab: "all", query: "tobias", source: "all" }).map((c) => c.id)).toEqual(["b"]);
  });

  it("filters by source", () => {
    expect(filterConversations(list, { tab: "all", query: "", source: "whatsapp" }).map((c) => c.id)).toEqual(["c"]);
    expect(filterConversations(list, { tab: "escalated", query: "", source: "instagram" })).toEqual([]);
  });
});

describe("chips", () => {
  it("shows the handoff state on handed-off rows", () => {
    expect(handoffRowChip("expired")).toEqual({ tone: "needs-you", label: "Expired" });
    expect(handoffRowChip("answered")).toEqual({ tone: "success", label: "Answered" });
    expect(handoffRowChip("handed_back")).toEqual({ tone: "neutral", label: "Handed back" });
    expect(handoffRowChip("taken_over").label).toBe("Taken over");
  });

  it("calls a conversation open for 24 h after its last message", () => {
    const now = at("2026-09-25T12:00:00.000Z");
    expect(conversationChip(at("2026-09-25T11:00:00.000Z"), now).label).toBe("Open");
    expect(conversationChip(at("2026-09-24T11:00:00.000Z"), now).label).toBe("Resolved");
  });
});

describe("time formatting", () => {
  const now = at("2026-09-25T12:40:00.000Z");

  it("shows the clock today, the weekday this week and the date before", () => {
    expect(formatListTime(at("2026-09-25T12:32:00.000Z"), now, TZ)).toBe("14:32");
    expect(formatListTime(at("2026-09-24T13:49:00.000Z"), now, TZ)).toBe("Thu");
    expect(formatListTime(at("2026-09-10T13:49:00.000Z"), now, TZ)).toBe("10 Sep");
  });

  it("formats durations", () => {
    expect(formatDuration(372_000)).toBe("6 min 12 s");
    expect(formatDuration(21 * 60_000)).toBe("21 min");
    expect(formatDuration(45_000)).toBe("45 s");
    expect(formatDuration(2 * 3_600_000 + 5 * 60_000)).toBe("2 h 5 min");
  });
});

describe("handoff events in the transcript", () => {
  it("records sent and expiry for an expired request", () => {
    const events = handoffEvents(
      request({ status: "expired", expiredAt: at("2026-09-24T16:10:00.000Z") }),
      TZ,
    );
    expect(events.map((e) => e.text)).toEqual([
      "16:10 · Handoff sent to Markus Albrecht by WhatsApp",
      "18:10 · No answer from Markus Albrecht. Back in the Inbox.",
    ]);
  });

  it("records answer, takeover and the automatic hand-back", () => {
    const events = handoffEvents(
      request({
        status: "handed_back",
        answeredAt: at("2026-09-24T14:12:00.000Z"),
        takenOverAt: at("2026-09-24T14:15:00.000Z"),
        handedBackAt: at("2026-09-24T14:45:00.000Z"),
        handBackReason: "idle",
      }),
      TZ,
    );
    expect(events.map((e) => e.text)).toEqual([
      "16:10 · Handoff sent to Markus Albrecht by WhatsApp",
      "16:12 · Markus Albrecht answered by WhatsApp",
      "16:15 · Markus Albrecht took over",
      "16:45 · Takeover ended after 30 min without a reply. The agent is answering again.",
    ]);
  });

  it("says the Inbox got it when there was no confirmed recipient", () => {
    const [sent] = handoffEvents(request({ recipientName: null, recipientWhatsapp: null }), TZ);
    expect(sent.text).toBe("16:10 · Handoff came to the Inbox (no confirmed recipient)");
  });

  it("merges events into the messages by time, events after a message at the same time", () => {
    const timeline = buildTimeline(
      [
        { kind: "message", id: "m1", at: at("2026-09-24T14:09:00.000Z") },
        { kind: "message", id: "m2", at: at("2026-09-24T14:10:00.000Z") },
        { kind: "message", id: "m3", at: at("2026-09-24T14:20:00.000Z") },
      ],
      handoffEvents(request({}), TZ),
    );
    expect(timeline.map((item) => (item.kind === "message" ? item.id : "event"))).toEqual([
      "m1",
      "m2",
      "event",
      "m3",
    ]);
  });
});

describe("Human handoff card copy", () => {
  it("tells the viewer to answer an expired request as the company", () => {
    const text = handoffNarrative(
      request({ status: "expired", expiredAt: at("2026-09-24T16:10:00.000Z") }),
      { customer: "Tobias Lang", company: "Acme GmbH", timeZone: TZ },
    );
    expect(text).toBe(
      "Sent to Markus Albrecht by WhatsApp at 16:10. The link expired at 18:10 with no answer, so it came back to the Inbox. Answer Tobias here as Acme GmbH.",
    );
  });

  it("explains the automatic hand-back", () => {
    const text = handoffNarrative(
      request({
        status: "handed_back",
        takenOverAt: at("2026-09-24T09:52:00.000Z"),
        handedBackAt: at("2026-09-24T10:24:00.000Z"),
        handBackReason: "idle",
      }),
      { customer: "Lukas Brenner", company: "Acme GmbH", timeZone: TZ },
    );
    expect(text).toBe(
      "Markus Albrecht took over at 11:52. No message from Markus Albrecht for 30 min, so the chat went back to the agent at 12:24 with the full transcript.",
    );
  });
});

describe("composer", () => {
  it("answers Waiting for you as the company and writes during a takeover", () => {
    expect(composerMode("expired", true)).toBe("reply");
    expect(composerMode("taken_over", false)).toBe("takeover");
  });

  it("stays read-only otherwise", () => {
    expect(composerMode("expired", false)).toBeNull();
    expect(composerMode("open", false)).toBeNull();
    expect(composerMode("handed_back", false)).toBeNull();
    expect(composerMode(null, false)).toBeNull();
  });
});

describe("humanizeTool", () => {
  it("turns a tool id into a label", () => {
    expect(humanizeTool("knowledge_base_search")).toBe("Knowledge base search");
    expect(humanizeTool("record-lead")).toBe("Record lead");
  });
});

describe("formatStarted", () => {
  it("reads like the Details card", async () => {
    const { formatStarted } = await import("./inbox-model");
    expect(formatStarted(at("2026-09-25T12:26:00.000Z"), TZ)).toBe("Fri 25 Sep, 14:26");
  });
});
