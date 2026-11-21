import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentsCanvas } from "./agents-canvas";
import { AgentsEmpty } from "./agents-empty";
import { bindSourceInput, sourceOptionHint } from "./bind-source";
import { AgentsKindNav } from "./agents-kind-nav";
import {
  buildAgentsCanvas,
  cardNodeId,
  sourceNodeId,
  type AgentsCanvasAgent,
  type AgentsCanvasInput,
  NO_SELECTION,
} from "./agents-canvas-model";

// Figma 07 `agents-customer/default` (411:27660), Acme copy.
const agent = (id: string, extra: Partial<AgentsCanvasAgent> = {}): AgentsCanvasAgent => ({
  id,
  name: id,
  description: null,
  model: "sonnet",
  isActive: true,
  ...extra,
});

const acme: AgentsCanvasInput = {
  agents: [
    agent("website", { name: "Acme Website Assistant", description: "Answers quote requests." }),
    agent("insta", { name: "Acme Instagram Concierge", model: "haiku" }),
  ],
  channels: [
    { id: "ch-widget", agentId: "website", type: "widget", active: true },
    { id: "ch-wa", agentId: "website", type: "whatsapp", active: true },
    { id: "ch-ig", agentId: "insta", type: "instagram", active: true },
    { id: "ch-fb", agentId: "insta", type: "messenger", active: true },
    { id: "ch-tg", agentId: "insta", type: "telegram", active: false },
  ],
  chatsThisWeek: new Map([
    ["website", 14],
    ["insta", 8],
  ]),
  leadsToQualify: new Map([["website", 6]]),
};

describe("buildAgentsCanvas", () => {
  it("lists all five sources in Figma order, connected only when an active channel exists", () => {
    const model = buildAgentsCanvas(acme, undefined);
    expect(model.sources.map((s) => [s.source, s.state])).toEqual([
      ["website", "connected"],
      ["whatsapp", "connected"],
      ["instagram", "connected"],
      ["messenger", "connected"],
      ["telegram", "disconnected"],
    ]);
  });

  it("draws one edge per active channel from source to agent card", () => {
    const model = buildAgentsCanvas(acme, undefined);
    expect(model.edges).toEqual([
      { from: sourceNodeId("website"), to: cardNodeId("website") },
      { from: sourceNodeId("whatsapp"), to: cardNodeId("website") },
      { from: sourceNodeId("instagram"), to: cardNodeId("insta") },
      { from: sourceNodeId("messenger"), to: cardNodeId("insta") },
    ]);
  });

  it("selects the first agent by default and the requested one when it exists", () => {
    expect(buildAgentsCanvas(acme, undefined).selectedNodeId).toBe(cardNodeId("website"));
    expect(buildAgentsCanvas(acme, "insta").selectedNodeId).toBe(cardNodeId("insta"));
    expect(buildAgentsCanvas(acme, "missing").selectedNodeId).toBe(cardNodeId("website"));
    const model = buildAgentsCanvas(acme, "insta");
    expect(model.cards.map((c) => c.state)).toEqual(["default", "selected"]);
  });

  it("fills metrics, model label and source glyphs per card", () => {
    const [website, insta] = buildAgentsCanvas(acme, undefined).cards;
    expect(website.metrics).toEqual([
      { value: 14, label: "Chats this week" },
      { value: 6, label: "Leads to qualify" },
    ]);
    expect(website.modelLabel).toBe("Claude Sonnet");
    expect(website.glyphs).toEqual(["website", "whatsapp"]);
    expect(insta.metrics[1].value).toBe(0);
    expect(insta.modelLabel).toBe("Claude Haiku");
    expect(insta.glyphs).toEqual(["instagram", "messenger"]);
  });

  it("marks inactive agents paused unless selected", () => {
    const input = { ...acme, agents: [acme.agents[0], { ...acme.agents[1], isActive: false }] };
    expect(buildAgentsCanvas(input, undefined).cards[1].state).toBe("paused");
  });

  it("returns no cards and no selection without agents", () => {
    const model = buildAgentsCanvas({ ...acme, agents: [], channels: [] }, undefined);
    expect(model.cards).toEqual([]);
    expect(model.selectedNodeId).toBeUndefined();
    expect(model.sources.every((s) => s.state === "disconnected")).toBe(true);
  });
});

describe("buildAgentsCanvas selection (Sources inspector + Add source)", () => {
  it("lists the selected agent's bindings live or paused, in source order", () => {
    const website = buildAgentsCanvas(acme, undefined).selected;
    expect(website?.name).toBe("Acme Website Assistant");
    expect(website?.modelLabel).toBe("Claude Sonnet");
    expect(website?.bindings).toEqual([
      { channelId: "ch-widget", source: "website", status: "live" },
      { channelId: "ch-wa", source: "whatsapp", status: "live" },
    ]);
    const insta = buildAgentsCanvas(acme, "insta").selected;
    expect(insta?.bindings.map((b) => [b.source, b.status])).toEqual([
      ["instagram", "live"],
      ["messenger", "live"],
      ["telegram", "paused"],
    ]);
  });

  it("offers every source the agent lacks, naming the agents already bound to it (Figma add-binding)", () => {
    const website = buildAgentsCanvas(acme, undefined).selected;
    expect(website?.addOptions).toEqual([
      { source: "instagram", boundTo: ["Acme Instagram Concierge"] },
      { source: "messenger", boundTo: ["Acme Instagram Concierge"] },
      { source: "telegram", boundTo: ["Acme Instagram Concierge"] },
    ]);
    const lone = buildAgentsCanvas({ ...acme, channels: [] }, undefined).selected;
    expect(lone?.addOptions.map((o) => o.source)).toEqual(["website", "whatsapp", "instagram", "messenger", "telegram"]);
    expect(lone?.addOptions.every((o) => o.boundTo.length === 0)).toBe(true);
  });

  it("closes the inspector with ?agent=none", () => {
    const model = buildAgentsCanvas(acme, NO_SELECTION);
    expect(model.selected).toBeUndefined();
    expect(model.selectedNodeId).toBeUndefined();
    expect(model.cards.every((c) => c.state !== "selected")).toBe(true);
  });

  it("has no selection without agents", () => {
    expect(buildAgentsCanvas({ ...acme, agents: [], channels: [] }, undefined).selected).toBeUndefined();
  });
});

describe("bindSourceInput", () => {
  it("builds the createChannel input for a Telegram bot token", () => {
    expect(bindSourceInput("telegram", "6f1c1a0e-1b8f-4d7a-9a3e-2b1f5c6d7e8f", { botToken: "  123:abc  " })).toEqual({
      ok: true,
      input: {
        name: "Telegram",
        type: "telegram",
        agentId: "6f1c1a0e-1b8f-4d7a-9a3e-2b1f5c6d7e8f",
        config: { botToken: "123:abc" },
      },
    });
  });

  it("maps the website source to a widget channel without credentials", () => {
    const result = bindSourceInput("website", "6f1c1a0e-1b8f-4d7a-9a3e-2b1f5c6d7e8f", {});
    expect(result.ok && result.input.type).toBe("widget");
    expect(result.ok && result.input.name).toBe("Website widget");
  });

  it("reports empty required credentials and skips empty optional ones", () => {
    expect(bindSourceInput("whatsapp", "6f1c1a0e-1b8f-4d7a-9a3e-2b1f5c6d7e8f", { phoneNumberId: " " })).toEqual({
      ok: false,
      missing: ["phoneNumberId", "accessToken"],
    });
    const messenger = bindSourceInput("messenger", "6f1c1a0e-1b8f-4d7a-9a3e-2b1f5c6d7e8f", { accessToken: "t", apiKey: "" });
    expect(messenger.ok && messenger.input.config).toEqual({ accessToken: "t" });
  });

  it("words the option hint per Figma", () => {
    expect(sourceOptionHint("instagram", ["Acme Instagram Concierge"])).toBe("Bound to Acme Instagram Concierge");
    expect(sourceOptionHint("telegram", [])).toBe("Connect with a bot token");
    expect(sourceOptionHint("whatsapp", ["A", "B", "C"])).toBe("Bound to A and 2 more");
  });
});

describe("AgentsCanvas", () => {
  it("wires Connect on disconnected sources and renders the source menu", () => {
    const html = renderToStaticMarkup(
      h(AgentsCanvas, {
        model: buildAgentsCanvas(acme, undefined),
        onConnectSource: () => {},
        sourceMenu: (source) => h("span", { "data-menu": source }),
      }),
    );
    expect(html).toMatch(/data-source="telegram"[^]*?>Connect</);
    expect(html).toContain('data-menu="website"');
    expect(html).not.toContain('data-menu="telegram"');
  });

  it("renders the empty state beside the sources panel when there are no agents", () => {
    const html = renderToStaticMarkup(
      h(AgentsCanvas, {
        model: buildAgentsCanvas({ ...acme, agents: [], channels: [] }, undefined),
        empty: h(AgentsEmpty, { companyName: "Brightline Dental" }),
      }),
    );
    expect(html).toContain("Connect customer channels and platforms.");
    expect(html).toContain("No customer agents yet");
    expect(html).toContain("Create a customer agent for Brightline Dental");
    expect(html).not.toContain("No agents yet");
  });

  it("renders the sources panel, agent cards and selection links", () => {
    const html = renderToStaticMarkup(h(AgentsCanvas, { model: buildAgentsCanvas(acme, undefined) }));
    expect(html).toContain("Connect customer channels and platforms.");
    expect(html).toContain("Acme Website Assistant");
    expect(html).toContain("Chats this week");
    expect(html).toContain('href="/agents?agent=insta"');
    expect(html).toContain('href="/agents/website"');
    expect(html).toContain('data-canvas-node="card:website" data-selected="true"');
  });
});

describe("AgentsKindNav", () => {
  it("marks the customer segment current", () => {
    const html = renderToStaticMarkup(h(AgentsKindNav, { active: "customer" }));
    expect(html).toContain("Customer agents");
    expect(html).toContain("Operator agents");
    expect(html).toMatch(/aria-current="page"[^>]*>Customer agents/);
  });
});
