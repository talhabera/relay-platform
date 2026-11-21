import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";

import {
  SESSIONS_HREF,
  conversationItems,
  sessionHeaderModel,
  toolLabel,
  versionPill,
} from "./operator-chat-model";

const user = (id: string, text: string): UIMessage => ({ id, role: "user", parts: [{ type: "text", text }] });
const agent = (id: string, text: string): UIMessage => ({ id, role: "assistant", parts: [{ type: "text", text }] });
const toolMsg = (id: string, name: string, state: "output-available" | "input-available", output?: unknown): UIMessage =>
  ({
    id,
    role: "assistant",
    parts: [
      state === "output-available"
        ? { type: "dynamic-tool", toolName: name, toolCallId: id, state, input: {}, output }
        : { type: "dynamic-tool", toolName: name, toolCallId: id, state, input: {} },
    ],
  }) as UIMessage;

describe("sessionHeaderModel", () => {
  const base = {
    title: "Lead re-check — offices of 20–300 employees",
    status: "running" as const,
    createdAt: new Date("2026-09-25T10:02:00Z"),
    timeZone: "Europe/Berlin",
    agentName: "Lead Qualifier",
    version: { name: "v1", status: "live" as const },
    needsYouCount: 0,
  };

  it("breadcrumb Operator / Sessions / title, back to the sessions list", () => {
    const m = sessionHeaderModel(base);
    expect(m.crumbs).toEqual([
      { label: "Operator", href: "/operator" },
      { label: "Sessions", href: SESSIONS_HREF },
      { label: base.title },
    ]);
    expect(m.backHref).toBe("/operator?tab=sessions");
    expect(m.title).toBe(base.title);
  });

  it("start time in the company timezone", () => {
    expect(sessionHeaderModel(base).startedLabel).toBe("Started Fri 25 Sep, 12:02");
  });

  it("maps chats.status and carries the needs-you count", () => {
    const m = sessionHeaderModel({ ...base, status: "needs_you", needsYouCount: 2 });
    expect(m.status).toBe("needs-you");
    expect(m.needsYouCount).toBe(2);
    expect(sessionHeaderModel({ ...base, status: "completed" }).status).toBe("done");
  });

  it("agent chip with version, or none without a version", () => {
    expect(sessionHeaderModel(base).agent).toEqual({ kind: "operator", name: "Lead Qualifier", version: "v1", status: "live" });
    expect(sessionHeaderModel({ ...base, version: null }).agent.status).toBe("none");
  });

  it("untitled fallback", () => {
    const m = sessionHeaderModel({ ...base, title: "  " });
    expect(m.title).toBe("Untitled session");
    expect(m.crumbs.at(-1)).toEqual({ label: "Untitled session" });
  });
});

describe("versionPill / toolLabel", () => {
  it("formats the version pill", () => {
    expect(versionPill({ name: "v1", status: "live" })).toBe("v1 Live");
    expect(versionPill({ name: "v2", status: "draft" })).toBe("v2 Draft");
    expect(versionPill(null)).toBeUndefined();
  });

  it("humanizes tool names", () => {
    expect(toolLabel("searchPlaces")).toBe("Search places");
    expect(toolLabel("hunter_email_lookup")).toBe("Hunter email lookup");
    expect(toolLabel("")).toBe("Tool");
  });
});

describe("conversationItems", () => {
  it("starts a new agent bubble for text written after a tool call", () => {
    const items = conversationItems(
      [
        user("u1", "Find offices"),
        agent("a1", "Searching."),
        toolMsg("t1", "googlePlacesSearch", "output-available", { count: 3 }),
        agent("a2", "Found 3."),
        user("u2", "Thanks"),
      ],
      { isStreaming: false, streamFailed: false },
    );
    expect(items.map((i) => i.role)).toEqual(["operator", "agent", "agent", "operator"]);
    expect(items[1].text).toBe("Searching.");
    expect(items[1].tools.map((t) => [t.label, t.state])).toEqual([["Google places search", "done"]]);
    expect(items[2].text).toBe("Found 3.");
    expect(items[2].tools).toEqual([]);
    expect(items.every((i) => i.state === "default")).toBe(true);
  });

  it("splits one streamed message at each tool call", () => {
    const streamed: UIMessage = {
      id: "s1",
      role: "assistant",
      parts: [
        { type: "text", text: "Looking." },
        { type: "tool-webSearch", toolCallId: "c1", state: "output-available", input: {}, output: {} },
        { type: "text", text: "Checking one more." },
        { type: "tool-fetchUrl", toolCallId: "c2", state: "input-available", input: {} },
      ] as UIMessage["parts"],
    };
    const items = conversationItems([user("u1", "Go"), streamed], { isStreaming: true, streamFailed: false });
    expect(items.map((i) => [i.id, i.text, i.tools.length])).toEqual([
      ["u1", "Go", 0],
      ["s1", "Looking.", 1],
      ["s1-1", "Checking one more.", 1],
    ]);
    expect(items[1].state).toBe("default");
    expect(items[2].state).toBe("streaming");
  });

  it("running tool chip and streaming state on the last agent turn", () => {
    const items = conversationItems(
      [user("u1", "Go"), toolMsg("t1", "hunterEmailLookup", "input-available")],
      { isStreaming: true, streamFailed: false },
    );
    expect(items[1].state).toBe("streaming");
    expect(items[1].tools[0].state).toBe("running");
  });

  it("error state on the last message when the stream failed", () => {
    const failedAgent = conversationItems([user("u1", "Go"), agent("a1", "Half")], {
      isStreaming: false,
      streamFailed: true,
    });
    expect(failedAgent[1].state).toBe("error");
    const failedSend = conversationItems([user("u1", "Go")], { isStreaming: false, streamFailed: true });
    expect(failedSend[0].state).toBe("error");
  });

  it("keeps every part of the turn so checkpoint cards still render", () => {
    const items = conversationItems(
      [agent("a1", "Proposing."), toolMsg("t1", "proposeOutreach", "output-available", { ok: true })],
      { isStreaming: false, streamFailed: false },
    );
    expect(items).toHaveLength(1);
    expect(items[0].parts).toHaveLength(2);
  });
});
