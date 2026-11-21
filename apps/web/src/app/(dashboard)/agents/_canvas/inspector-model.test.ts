import { describe, expect, it } from "vitest";

import { buildAgentsCanvas, type AgentsCanvasInput } from "./agents-canvas-model";
import { canSaveInstructions, instructionsMeta, integrationRows, toolLabel } from "./inspector-model";
import {
  DEFAULT_WIDGET_COLOR,
  widgetEmbedSnippet,
  widgetFormDefaults,
  widgetFormErrors,
  widgetPreviewTitle,
  widgetReassignNote,
  widgetSaveInput,
  type AgentsWidget,
} from "./widget-config-model";

const input: AgentsCanvasInput = {
  agents: [
    {
      id: "website",
      name: "Acme Website Assistant",
      description: null,
      model: "sonnet",
      isActive: true,
      instructions: "Reply in German or English.",
      updatedAt: new Date(2026, 8, 24, 16, 40),
    },
    { id: "insta", name: "Acme Instagram Concierge", description: null, model: "haiku", isActive: true },
  ],
  channels: [],
  chatsThisWeek: new Map(),
  leadsToQualify: new Map(),
  integrations: [
    { id: "i-company", agentId: null, name: "Team Slack", type: "slack", connected: true },
    { id: "i-other", agentId: "insta", name: "Insta shop", type: "shopify", connected: true },
    { id: "i-own", agentId: "website", name: "Acme Shop", type: "shopify", connected: false },
  ],
};

describe("buildAgentsCanvas selection (inspector tabs)", () => {
  it("carries the instructions and their save time", () => {
    const sel = buildAgentsCanvas(input, "website").selected!;
    expect(sel.instructions).toBe("Reply in German or English.");
    expect(sel.instructionsSavedAt).toEqual(new Date(2026, 8, 24, 16, 40));
  });

  it("lists the agent's own integrations, then company-wide ones, never another agent's", () => {
    expect(buildAgentsCanvas(input, "website").selected!.integrations.map((i) => i.id)).toEqual([
      "i-own",
      "i-company",
    ]);
  });

  it("defaults to empty instructions and no integrations", () => {
    const sel = buildAgentsCanvas({ ...input, integrations: undefined }, "insta").selected!;
    expect(sel.instructions).toBe("");
    expect(sel.instructionsSavedAt).toBeUndefined();
    expect(sel.integrations).toEqual([]);
  });
});

describe("instructions", () => {
  it("formats the saved line like Figma", () => {
    expect(instructionsMeta(new Date(2026, 8, 24, 16, 40), 434)).toBe("Saved 24 Sep, 16:40 · 434 characters");
    expect(instructionsMeta(undefined, 1)).toBe("1 character");
  });

  it("saves only changed text, for owners, within 5000 characters", () => {
    expect(canSaveInstructions("a", "a", true)).toBe(false);
    expect(canSaveInstructions("a", "b", false)).toBe(false);
    expect(canSaveInstructions("a", "b", true)).toBe(true);
    expect(canSaveInstructions("a", "x".repeat(5001), true)).toBe(false);
  });
});

describe("integrationRows", () => {
  it("starts with the built-in knowledge search, then integrations on when connected", () => {
    const rows = integrationRows(buildAgentsCanvas(input, "website").selected!.integrations);
    expect(rows.map((r) => [r.label, r.on, r.builtin, r.icon])).toEqual([
      ["Knowledge base search", true, true, "book-open"],
      ["Acme Shop", false, false, "store"],
      ["Team Slack", true, false, "hash"],
    ]);
  });
});

describe("toolLabel", () => {
  it("names known tools and words unknown ones", () => {
    expect(toolLabel("searchKnowledgeBase")).toBe("Knowledge base search");
    expect(toolLabel("ask_human")).toBe("Hand off to a person");
    expect(toolLabel("listInstagramComments")).toBe("List instagram comments");
  });
});

describe("widget config model (Figma 411:31887)", () => {
  const widget: AgentsWidget = {
    companyId: "acme",
    companyName: "Acme GmbH",
    widgetId: "w123",
    config: {
      primaryColor: "#2DD4BF",
      welcomeMessage: "Hi, how can we help?",
      title: null,
      position: "bottom-left",
      agentId: "insta",
    },
    agentName: "Acme Instagram Concierge",
  };

  it("fills the form from the stored config, with defaults before the first save", () => {
    expect(widgetFormDefaults(widget)).toEqual({
      primaryColor: "#2DD4BF",
      welcomeMessage: "Hi, how can we help?",
      position: "bottom-left",
    });
    expect(widgetFormDefaults({ ...widget, config: null })).toEqual({
      primaryColor: DEFAULT_WIDGET_COLOR,
      welcomeMessage: "",
      position: "bottom-right",
    });
  });

  it("rejects a bad color and a long greeting", () => {
    expect(widgetFormErrors({ primaryColor: "teal", welcomeMessage: "", position: "bottom-right" })).toHaveProperty(
      "primaryColor",
    );
    expect(
      widgetFormErrors({ primaryColor: "#000000", welcomeMessage: "x".repeat(501), position: "bottom-right" }),
    ).toHaveProperty("welcomeMessage");
    expect(widgetFormErrors(widgetFormDefaults(widget))).toEqual({});
  });

  it("saves the fields and points the widget at the selected agent", () => {
    expect(widgetSaveInput(widgetFormDefaults(widget), "website")).toEqual({
      primaryColor: "#2DD4BF",
      welcomeMessage: "Hi, how can we help?",
      position: "bottom-left",
      agentId: "website",
    });
  });

  it("warns before moving the widget off another agent", () => {
    expect(widgetReassignNote(widget, "website")).toContain("Acme Instagram Concierge");
    expect(widgetReassignNote(widget, "insta")).toBeUndefined();
    expect(widgetReassignNote({ ...widget, config: null }, "website")).toBeUndefined();
  });

  it("titles the preview and builds the backward-compatible embed snippet", () => {
    expect(widgetPreviewTitle(widget)).toBe("Acme GmbH");
    expect(widgetEmbedSnippet("https://relay.app/", "w123")).toBe(
      '<script src="https://relay.app/widget.js" data-widget-id="w123"></script>',
    );
  });
});
