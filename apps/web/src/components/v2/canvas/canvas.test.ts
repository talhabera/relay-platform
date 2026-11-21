import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OPERATOR_TOOL_CATALOG } from "@/lib/operator/tool-catalog";

import {
  BindingRow,
  CanvasAgentCard,
  CanvasAgentNode,
  type CanvasAgentCardProps,
  ConnectorNode,
  HandoffNode,
  InspectorPanel,
  operatorToolIcon,
  SourceNode,
  ToolToggleRow,
} from "./index";

const render = (el: ReactElement) => renderToStaticMarkup(el);
const classOf = (html: string, slot: string) => {
  const m = html.match(new RegExp(`data-slot="${slot}"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*data-slot="${slot}"`));
  return m ? (m[1] ?? m[2]).replaceAll("&amp;", "&") : "";
};
const portOf = (html: string) => {
  const m = html.match(/<span[^>]*data-slot="canvas-port"[^>]*>/);
  return m ? m[0].replaceAll("&amp;", "&") : "";
};
const count = (html: string, needle: string) => html.split(needle).length - 1;

// Figma 02 `374:1154` v2/canvas, Acme copy.
const operatorCard: CanvasAgentCardProps = {
  kind: "operator",
  name: "Lead Gatherer",
  description: "Finds Munich and Augsburg offices with 20 to 300 employees from Google Places, Hunter and Snov.",
  model: "Claude Haiku",
  version: "v1",
  metrics: [
    { value: "146", label: "Gathered this week" },
    { value: "06:00", label: "Daily run" },
  ],
  glyphs: ["hunter", "snov", "google-places"],
};

const customerCard: CanvasAgentCardProps = {
  kind: "customer",
  name: "Acme Website Assistant",
  description: "Answers quote requests in German and English and books on-site consultations.",
  model: "Claude Sonnet",
  metrics: [
    { value: "14", label: "Chats this week" },
    { value: "6", label: "Leads to Qualify" },
  ],
  glyphs: ["website", "whatsapp"],
};

describe("Canvas agent card (375:23496)", () => {
  it.each([
    ["default", "border-border", "shadow-elevation-1", "idle"],
    ["selected", "border-primary", "shadow-glow-primary", "active"],
    ["paused", "border-border", "shadow-elevation-1", "idle"],
    ["error", "border-destructive", "shadow-elevation-1", "error"],
  ] as const)("operator state=%s: border, shadow and right port tone", (state, border, shadow, tone) => {
    const html = render(h(CanvasAgentCard, { ...operatorCard, state, alert: "Google Places quota reached · 06:00" }));
    expect(html).toContain(`data-state="${state}"`);
    expect(classOf(html, "canvas-agent-card")).toContain(border);
    expect(classOf(html, "canvas-agent-card")).toContain(shadow);
    expect(portOf(html)).toContain('data-side="right"');
    expect(portOf(html)).toContain(`data-tone="${tone}"`);
  });

  it("operator default: kind label, name, description, model chip with v1 Live, metrics, connector glyphs", () => {
    const html = render(h(CanvasAgentCard, operatorCard));
    expect(html).toContain("Operator agent");
    expect(html).toContain("Lead Gatherer");
    expect(html).toContain("Finds Munich and Augsburg");
    expect(html).toContain('data-icon="bot"');
    expect(html).toMatch(/data-slot="agent-chip"[^>]*data-kind="operator"[^>]*data-status="live"/);
    expect(html).toContain("Claude Haiku");
    expect(html).toMatch(/v1<\/span><span>Live/);
    expect(html).not.toContain('data-slot="status-chip"');
    expect(count(html, 'data-slot="canvas-agent-metric"')).toBe(2);
    expect(html).toContain("Gathered this week");
    expect(html).toContain("06:00");
    expect(html).toContain("Connectors");
    expect(count(html, 'data-slot="brand-glyph"')).toBe(3);
    expect(html).toContain('data-brand="hunter"');
    expect(html).toContain('aria-label="Lead Gatherer actions"');
  });

  it("customer default: Live status chip, no version, left port, source glyphs", () => {
    const html = render(h(CanvasAgentCard, customerCard));
    expect(html).toContain("Customer agent");
    expect(html).toContain('data-icon="messages-square"');
    expect(html).toMatch(/data-slot="agent-chip"[^>]*data-kind="customer"[^>]*data-status="none"/);
    expect(html).toMatch(/data-slot="status-chip"[^>]*data-tone="live"/);
    expect(html).toContain("Sources");
    expect(portOf(html)).toContain('data-side="left"');
  });

  it("paused: muted avatar tile and neutral Paused chip", () => {
    const html = render(h(CanvasAgentCard, { ...customerCard, state: "paused" }));
    expect(classOf(html, "canvas-agent-avatar")).toContain("bg-muted");
    expect(html).toMatch(/data-tone="neutral"[^>]*>.*Paused/);
  });

  it("error: inline alert and Error chip; alert hidden in other states", () => {
    const err = render(h(CanvasAgentCard, { ...customerCard, state: "error", alert: "WhatsApp token expired · reconnect" }));
    expect(err).toMatch(/data-slot="canvas-agent-alert"[^>]*role="alert"/);
    expect(err).toContain("WhatsApp token expired · reconnect");
    expect(err).toContain('data-icon="circle-alert"');
    expect(err).toMatch(/data-tone="error"/);
    // Figma 375:22635: neutral fill darker than the card (#0b1113), not a red tint.
    const alertClass = classOf(err, "canvas-agent-alert");
    expect(alertClass).toContain("bg-canvas/50");
    expect(alertClass).not.toMatch(/bg-destructive/);
    const ok = render(h(CanvasAgentCard, { ...customerCard, alert: "ignored" }));
    expect(ok).not.toContain("canvas-agent-alert");
  });

  it("menu=null hides the ellipsis button", () => {
    const html = render(h(CanvasAgentCard, { ...operatorCard, menu: null }));
    expect(html).not.toContain('data-icon="ellipsis"');
  });
});

describe("Source node (375:24280)", () => {
  it.each([
    ["website", "Website widget", "globe"],
    ["whatsapp", "WhatsApp", "message-circle"],
    ["instagram", "Instagram", "camera"],
    ["messenger", "Messenger", "zap"],
    ["telegram", "Telegram", "send"],
  ] as const)("source=%s: label and brand glyph", (source, label, icon) => {
    const html = render(h(SourceNode, { source }));
    expect(html).toContain(label);
    expect(html).toContain(`data-brand="${source}"`);
    expect(html).toContain('data-size="24"');
    expect(html).toContain(`data-icon="${icon}"`);
  });

  it.each([
    ["website", "connected", "Connected", "bg-success", "active", null],
    ["whatsapp", "disconnected", "Not connected", "bg-muted-foreground", "idle", "Connect"],
    ["whatsapp", "error", "Token expired", "bg-destructive", "error", "Reconnect"],
    ["website", "error", "Embed missing", "bg-destructive", "error", "Reconnect"],
  ] as const)("%s state=%s: status text, dot, port and action", (source, state, text, dot, tone, action) => {
    const html = render(h(SourceNode, { source, state }));
    expect(html).toContain(text);
    expect(classOf(html, "source-node-dot")).toContain(dot);
    expect(portOf(html)).toContain('data-side="right"');
    expect(portOf(html)).toContain(`data-tone="${tone}"`);
    if (action) {
      expect(html).toMatch(new RegExp(`<button[^>]*data-variant="outline"[^>]*>${action}</button>`));
      expect(html).not.toContain('data-icon="ellipsis"');
    } else {
      expect(html).toContain('data-icon="ellipsis"');
    }
    expect(classOf(html, "source-node")).toContain(state === "error" ? "border-destructive" : "border-border");
  });
});

describe("Connector node (375:25081)", () => {
  it.each([
    ["connected", "Connected", "bg-success", "active"],
    ["disconnected", "Disconnected", "bg-muted-foreground", "idle"],
    ["pending", "Pending", "bg-warning", "pending"],
    ["error", "Error · check API key", "bg-destructive", "error"],
  ] as const)("status=%s: text, dot and left port", (status, text, dot, tone) => {
    const html = render(h(ConnectorNode, { brand: "hunter", name: "Hunter", status }));
    expect(html).toContain("Hunter");
    expect(html).toContain('data-brand="hunter"');
    expect(html).toContain(text);
    expect(classOf(html, "connector-node-dot")).toContain(dot);
    expect(portOf(html)).toContain('data-side="left"');
    expect(portOf(html)).toContain(`data-tone="${tone}"`);
    expect(classOf(html, "connector-node")).toContain("w-60");
  });
});

describe("Handoff node (480:7735)", () => {
  const props = {
    recipient: "Markus Albrecht",
    expiry: "Link expires after 2 h",
    fallback: "Fallback: Inbox after 2 h",
  };

  it("default: title, expiry, recipient with initials and WhatsApp glyph, fallback, idle port", () => {
    const html = render(h(HandoffNode, props));
    expect(html).toContain("Human handoff");
    expect(html).toContain('data-icon="hand-helping"');
    expect(html).toContain('data-icon="clock"');
    expect(html).toContain("Link expires after 2 h");
    expect(html).toMatch(/data-slot="handoff-node-avatar"[^>]*>MA</);
    expect(html).toContain("Markus Albrecht · WhatsApp");
    expect(html).toContain('data-brand="whatsapp"');
    expect(html).toContain('data-icon="inbox"');
    expect(html).toContain("Fallback: Inbox after 2 h");
    expect(classOf(html, "handoff-node")).toContain("border-border");
    expect(portOf(html)).toContain('data-tone="idle"');
  });

  it("selected: teal border + glow and filled port", () => {
    const html = render(h(HandoffNode, { ...props, state: "selected" }));
    expect(classOf(html, "handoff-node")).toContain("border-primary");
    expect(classOf(html, "handoff-node")).toContain("shadow-glow-primary");
    expect(portOf(html)).toContain('data-tone="active"');
  });

  it("notice: warning replaces the recipient line (Recipient not confirmed)", () => {
    const html = render(h(HandoffNode, { ...props, notice: "Recipient not confirmed" }));
    expect(html).toMatch(/data-slot="handoff-node-notice"[^>]*>Recipient not confirmed</);
    expect(html).not.toContain("Markus Albrecht · WhatsApp");
    expect(html).not.toContain('data-brand="whatsapp"');
  });

  it("group: no avatar, the group name with the WhatsApp glyph (Team chat)", () => {
    const html = render(h(HandoffNode, { ...props, recipient: "Acme handoff team", avatar: false }));
    expect(html).not.toContain('data-slot="handoff-node-avatar"');
    expect(html).toContain("Acme handoff team");
    expect(html).not.toContain("Acme handoff team · WhatsApp");
    expect(html).toContain('data-brand="whatsapp"');
  });
});

describe("Tool toggle row (375:25310)", () => {
  it("on: checked switch, foreground label", () => {
    const html = render(h(ToolToggleRow, { label: "Web search", state: "on" }));
    expect(html).toContain("Web search");
    expect(html).toContain('data-icon="globe"');
    expect(html).toMatch(/role="switch"[^>]*aria-checked="true"/);
    expect(html).not.toContain("Coming soon");
  });

  it("off: unchecked switch", () => {
    const html = render(h(ToolToggleRow, { label: "Excel", icon: "table", state: "off" }));
    expect(html).toContain('data-icon="table"');
    expect(html).toMatch(/role="switch"[^>]*aria-checked="false"/);
    expect(html).not.toMatch(/role="switch"[^>]* disabled=""/);
  });

  it("coming-soon: muted label, Coming soon chip, disabled switch", () => {
    const html = render(
      h(ToolToggleRow, { label: "WhatsApp notification", icon: "message-circle", state: "coming-soon" }),
    );
    expect(html).toContain("Coming soon");
    expect(html).toMatch(/<label[^>]*class="[^"]*text-muted-foreground/);
    expect(html).toMatch(/role="switch"[^>]*aria-checked="false"[^>]* disabled=""/);
  });

  it("label is wired to the switch", () => {
    const html = render(h(ToolToggleRow, { label: "Excel" }));
    const id = html.match(/<label[^>]*for="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`id="${id}"`);
  });

  it("has an icon for every catalog tool", () => {
    for (const tool of OPERATOR_TOOL_CATALOG) expect(operatorToolIcon[tool.id]).toBeTruthy();
  });
});

describe("Binding row (375:25218)", () => {
  it("agent=true: source, arrow, customer Agent chip, Live chip, menu", () => {
    const html = render(h(BindingRow, { source: "website", agent: "Acme Website Assistant" }));
    expect(html).toContain("Website widget");
    expect(html).toContain('data-icon="arrow-right"');
    expect(html).toMatch(/data-slot="agent-chip"[^>]*data-kind="customer"/);
    expect(html).toContain("Acme Website Assistant");
    expect(html).toMatch(/data-tone="live"/);
    expect(html).toContain('data-icon="ellipsis"');
    expect(classOf(html, "binding-row")).toContain("h-12");
  });

  it("agent=false (inspector): no arrow or agent chip", () => {
    const html = render(h(BindingRow, { source: "whatsapp", name: "WhatsApp Business" }));
    expect(html).toContain("WhatsApp Business");
    expect(html).not.toContain('data-icon="arrow-right"');
    expect(html).not.toContain('data-slot="agent-chip"');
  });

  it.each([
    ["paused", "neutral", "Paused"],
    ["error", "error", "Error"],
  ] as const)("status=%s renders the %s chip", (status, tone, label) => {
    const html = render(h(BindingRow, { source: "instagram", status }));
    expect(html).toMatch(new RegExp(`data-tone="${tone}"[^>]*>.*${label}`));
  });
});

describe("Inspector panel (378:25922)", () => {
  it("operator: 440 wide, draft version chip, five tabs with Tools active, close, footer", () => {
    const html = render(
      h(
        InspectorPanel,
        {
          kind: "operator",
          name: "Lead Qualifier",
          version: "v2",
          versionStatus: "draft",
          description: "Scores gathered and inbound leads against Acme's criteria.",
          sectionLabel: "Tools · v2 Draft",
          onClose: () => {},
          secondaryAction: { label: "Fork version" },
          primaryAction: { label: "Promote v2 to live" },
        },
        h(ToolToggleRow, { label: "Web search" }),
      ),
    );
    expect(classOf(html, "inspector-panel")).toContain("w-[440px]");
    expect(classOf(html, "inspector-panel")).toContain("shadow-elevation-2");
    expect(html).toMatch(/data-slot="agent-chip"[^>]*data-kind="operator"[^>]*data-status="draft"/);
    for (const tab of ["Versions", "Tools", "Schedules", "Access", "Knowledge"]) expect(html).toContain(tab);
    expect(html).toMatch(/aria-checked="true"[^>]*>Tools</);
    expect(html).toContain('aria-label="Close inspector"');
    expect(html).toContain("Tools · v2 Draft");
    expect(html).toContain('data-slot="tool-toggle-row"');
    expect(html).toContain("Fork version");
    expect(html).toContain("Promote v2 to live");
  });

  it("customer: 400 wide, Live status chip, four tabs with Sources active, binding rows", () => {
    const html = render(
      h(
        InspectorPanel,
        {
          kind: "customer",
          name: "Acme Website Assistant",
          status: { tone: "live", label: "Live" },
          sectionLabel: "Bound sources",
          secondaryAction: { label: "Test chat" },
          primaryAction: { label: "Save changes" },
        },
        h(BindingRow, { source: "website" }),
      ),
    );
    expect(classOf(html, "inspector-panel")).toContain("w-[400px]");
    expect(html).toMatch(/data-slot="status-chip"[^>]*data-tone="live"/);
    for (const tab of ["Sources", "Instructions", "Knowledge", "Integrations"]) expect(html).toContain(tab);
    expect(html).not.toContain(">Widget<");
    expect(html).not.toContain("Schedules");
    expect(html).toMatch(/aria-checked="true"[^>]*>Sources</);
    expect(html).toContain("Bound sources");
    expect(html).toContain('data-slot="binding-row"');
    expect(html).not.toContain("Close inspector");
  });

  it("omits the footer without actions", () => {
    const html = render(h(InspectorPanel, { kind: "customer", name: "Acme" }));
    expect(html).not.toContain('data-slot="inspector-footer"');
  });
});

describe("CanvasAgentNode (04 agent map 414:51414)", () => {
  it("operator: 300 wide, model eyebrow, status chip, hidden ports both sides", () => {
    const html = render(
      h(CanvasAgentNode, {
        kind: "operator",
        name: "Lead Gatherer",
        eyebrow: "Claude Haiku",
        icon: "user",
        status: { tone: "live", label: "v1 Live" },
        ports: ["left", "right"],
      }),
    );
    expect(classOf(html, "canvas-agent-node")).toContain("w-75");
    expect(html).toContain("Claude Haiku");
    expect(html).toContain("v1 Live");
    expect(html).toContain('data-icon="user"');
    expect(count(html, 'data-slot="canvas-port"')).toBe(2);
    expect(portOf(html)).toContain("invisible");
  });

  it("customer: 324 wide, default icon, visible ports on request, no chip without status", () => {
    const html = render(
      h(CanvasAgentNode, { kind: "customer", name: "Acme Website Assistant", eyebrow: "Customer agent", ports: ["left"], showPorts: true }),
    );
    expect(classOf(html, "canvas-agent-node")).toContain("w-81");
    expect(html).toContain('data-icon="messages-square"');
    expect(portOf(html)).not.toContain("invisible");
    expect(html).not.toContain('data-slot="status-chip"');
  });
});
