import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AgentsKindNav } from "../../_canvas/agents-kind-nav";
import { operatorAgentRedirect } from "./operator-agent-redirect";
import { OperatorCanvas } from "./operator-canvas";
import {
  buildOperatorCanvas,
  connectorNodeId,
  NO_SELECTION,
  operatorCardNodeId,
  type OperatorCanvasInput,
  type OperatorCanvasVersion,
} from "./operator-canvas-model";

const off = { webSearch: false, excel: false, companyMemory: false, proposeAction: false };
const day = (d: number) => new Date(Date.UTC(2026, 8, d));
const version = (
  id: string,
  agentId: string,
  extra: Partial<OperatorCanvasVersion> = {},
): OperatorCanvasVersion => ({
  id,
  agentId,
  name: "v1",
  status: "live",
  model: "sonnet",
  parentVersionId: null,
  toolToggles: off,
  createdAt: day(14),
  ...extra,
});

// Figma 07 `agents-operator/default` (414:55559), Acme copy.
const acme: OperatorCanvasInput = {
  agents: [
    { id: "gatherer", name: "Lead Gatherer", description: null, isActive: true },
    { id: "qualifier", name: "Lead Qualifier", description: "Scores gathered leads.", isActive: true },
    { id: "mail", name: "Mail Marketer", description: null, isActive: false },
  ],
  versions: [
    version("g1", "gatherer", { model: "haiku" }),
    version("q1", "qualifier"),
    version("q2", "qualifier", {
      name: "v2",
      status: "draft",
      parentVersionId: "q1",
      createdAt: day(23),
      toolToggles: { ...off, webSearch: true, companyMemory: true },
    }),
    version("m1", "mail", { status: "draft" }),
  ],
  integrations: [
    { type: "hunter", agentId: null, status: "connected" },
    { type: "snov", agentId: null, status: "pending" },
    { type: "slack", agentId: "qualifier", status: "connected" },
    { type: "slack", agentId: null, status: "error" },
    { type: "shopify", agentId: null, status: "connected" },
  ],
  stages: [{ agentId: "qualifier", workflowName: "Lead engine", stageName: "Qualify" }],
};

describe("buildOperatorCanvas", () => {
  it("lists the nine operator connectors with the worst status per type", () => {
    const model = buildOperatorCanvas(acme, undefined);
    expect(model.connectors.map((c) => c.name)).toEqual([
      "Hunter",
      "Snov",
      "Google Places",
      "Slack",
      "Google Workspace",
      "Meta",
      "LinkedIn",
      "Google Business Profile",
      "Trustpilot",
    ]);
    const status = Object.fromEntries(model.connectors.map((c) => [c.type, c.status]));
    expect(status).toMatchObject({ hunter: "connected", snov: "pending", google_places: "disconnected", slack: "error" });
  });

  it("links every agent to connected research connectors and an agent to its own rows", () => {
    const { edges } = buildOperatorCanvas(acme, undefined);
    const keys = edges.map((e) => `${e.from}->${e.to}`);
    for (const id of ["gatherer", "qualifier", "mail"]) {
      expect(keys).toContain(`${operatorCardNodeId(id)}->${connectorNodeId("hunter")}`);
      expect(keys).not.toContain(`${operatorCardNodeId(id)}->${connectorNodeId("snov")}`);
    }
    expect(keys).toContain(`${operatorCardNodeId("qualifier")}->${connectorNodeId("slack")}`);
    expect(keys).not.toContain(`${operatorCardNodeId("gatherer")}->${connectorNodeId("slack")}`);
    expect(keys).toHaveLength(4);
  });

  it("cards show the live model and version and a newer draft", () => {
    const { cards } = buildOperatorCanvas(acme, "qualifier");
    const byId = Object.fromEntries(cards.map((c) => [c.agentId, c]));
    expect(byId.gatherer).toMatchObject({ modelLabel: "Claude Haiku", liveVersion: "v1", state: "default" });
    expect(byId.gatherer.draftVersion).toBeUndefined();
    expect(byId.qualifier).toMatchObject({ liveVersion: "v1", draftVersion: "v2", state: "selected" });
    expect(byId.mail).toMatchObject({ draftVersion: "v1", state: "paused" });
    expect(byId.mail.liveVersion).toBeUndefined();
  });

  it("selects the first agent by default and none with ?agent=none", () => {
    expect(buildOperatorCanvas(acme, undefined).selected?.agentId).toBe("gatherer");
    expect(buildOperatorCanvas(acme, "missing").selected?.agentId).toBe("gatherer");
    const closed = buildOperatorCanvas(acme, NO_SELECTION);
    expect(closed.selected).toBeUndefined();
    expect(closed.selectedNodeId).toBeUndefined();
  });

  it("selection focuses the newest version, or ?version=, with its tools", () => {
    const sel = buildOperatorCanvas(acme, "qualifier").selected!;
    expect(sel.focusVersion).toEqual({ id: "q2", name: "v2", status: "draft" });
    expect(sel.versions.map((v) => [v.name, v.status, v.forkedFrom, v.focused])).toEqual([
      ["v2", "draft", "Forked from v1", true],
      ["v1", "live", undefined, false],
    ]);
    expect(sel.tools).toEqual(["Web search", "Company memory"]);
    expect(sel.connectors.map((c) => c.name)).toEqual(["Hunter", "Slack"]);
    expect(sel.usedIn).toEqual(["Lead engine · Qualify"]);

    const v1 = buildOperatorCanvas(acme, "qualifier", "q1").selected!;
    expect(v1.focusVersion?.name).toBe("v1");
    expect(v1.tools).toEqual([]);
  });
});

describe("OperatorCanvas", () => {
  it("renders agent cards, connector nodes and select links", () => {
    const html = renderToStaticMarkup(h(OperatorCanvas, { model: buildOperatorCanvas(acme, "qualifier") }));
    expect(html).toContain("Operator agents canvas");
    expect(html).toContain("Lead Qualifier");
    expect(html).toContain("Accounts operator agents act through.");
    expect(html).toContain("Google Business Profile");
    expect(html).toContain('href="/agents/operator?agent=gatherer"');
  });
});

describe("AgentsKindNav", () => {
  it("points Operator agents at the operator canvas", () => {
    const html = renderToStaticMarkup(h(AgentsKindNav, { active: "operator" }));
    expect(html).toContain('href="/agents/operator"');
    expect(html).not.toContain('href="/operator"');
  });
});

describe("operatorAgentRedirect", () => {
  it("sends the old settings route to the canvas with the agent selected", () => {
    expect(operatorAgentRedirect("a1", {})).toBe("/agents/operator?agent=a1");
    expect(operatorAgentRedirect("a1", { versionId: "v2" })).toBe("/agents/operator?agent=a1&version=v2");
  });
});
