import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(dashboard)/agents/actions", () => ({
  createChannel: vi.fn(),
  updateChannel: vi.fn(),
  deleteChannel: vi.fn(),
  updateAgent: vi.fn(),
  createIntegration: vi.fn(),
  updateIntegration: vi.fn(),
  deleteIntegration: vi.fn(),
  updateAgentLeadCapture: vi.fn(),
  updateAgentLeadIntake: vi.fn(),
  createKnowledgeEntry: vi.fn(),
  createKnowledgeFromWebsite: vi.fn(),
  updateKnowledgeEntry: vi.fn(),
  deleteKnowledgeEntry: vi.fn(),
}));
vi.mock("@/app/(dashboard)/agents/[id]/leads/actions", () => ({ updateLeadNotifyNumber: vi.fn() }));

import type { AgentsCanvasSelection } from "./agents-canvas-model";
import { SourcesInspector } from "./sources-inspector";

const selection: AgentsCanvasSelection = {
  agentId: "website",
  name: "Acme Website Assistant",
  description: "Answers quote requests.",
  modelLabel: "Claude Sonnet",
  isActive: true,
  bindings: [
    { channelId: "ch-widget", source: "website", status: "live" },
    { channelId: "ch-wa", source: "whatsapp", status: "paused" },
  ],
  addOptions: [{ source: "telegram", boundTo: [] }],
  instructions: "Reply in German or English.",
  instructionsSavedAt: new Date(2026, 8, 24, 16, 40),
  integrations: [{ id: "int-shop", agentId: "website", name: "Acme Shop", type: "shopify", connected: false }],
};

const props = { selection, companyId: "acme", canManage: true, onAddSource: () => {} };

describe("SourcesInspector", () => {
  it("renders bound sources, Add source and the footer for owners (Figma 411:27660)", () => {
    const html = renderToStaticMarkup(h(SourcesInspector, props));
    expect(html).toContain("Acme Website Assistant");
    expect(html).toContain("Answers quote requests. Claude Sonnet");
    expect(html).toContain("Bound sources");
    expect(html).toContain('data-slot="binding-row" data-status="live"');
    expect(html).toContain('data-slot="binding-row" data-status="paused"');
    expect(html).toContain("Website widget binding actions");
    expect(html).toContain("Add source");
    expect(html).toContain("Test chat");
    expect(html).toContain("Save changes");
  });

  it("hides binding actions and Add source for members", () => {
    const html = renderToStaticMarkup(h(SourcesInspector, { ...props, canManage: false }));
    expect(html).toContain('data-slot="binding-row"');
    expect(html).not.toContain("binding actions");
    expect(html).not.toContain("Add source");
  });

  it("explains an agent without sources", () => {
    const html = renderToStaticMarkup(
      h(SourcesInspector, { ...props, selection: { ...selection, bindings: [] } }),
    );
    expect(html).toContain("No sources yet.");
  });

  it("shows Integrations where Figma has it, not Widget", () => {
    const html = renderToStaticMarkup(h(SourcesInspector, props));
    expect(html).toContain(">Integrations<");
    expect(html).not.toContain(">Widget<");
  });

  it("offers Configure widget on the website binding when the owner can configure it", () => {
    // The menu content is portalled; the trigger is enough to prove the binding menu renders.
    const html = renderToStaticMarkup(h(SourcesInspector, { ...props, onConfigureWidget: () => {} }));
    expect(html).toContain("Website widget binding actions");
  });

  it("edits instructions in place (Figma 411:31861)", () => {
    const html = renderToStaticMarkup(h(SourcesInspector, { ...props, initialTab: "instructions" }));
    expect(html).toContain('data-slot="inspector-instructions"');
    expect(html).toContain("Reply in German or English.");
    expect(html).toContain("Saved 24 Sep, 16:40 · 27 characters");
    expect(html).not.toContain("agent settings");
    // Unchanged text: Save changes stays disabled.
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save changes</);
  });

  it("makes instructions read-only for members", () => {
    const html = renderToStaticMarkup(h(SourcesInspector, { ...props, canManage: false, initialTab: "instructions" }));
    expect(html).toContain("readOnly");
    expect(html).toContain("Only the company owner can edit instructions.");
  });

  it("lists integrations as toggle rows (Figma 411:37385)", () => {
    const html = renderToStaticMarkup(h(SourcesInspector, { ...props, initialTab: "integrations" }));
    expect(html).toContain('data-slot="inspector-integrations"');
    expect(html).toContain("Knowledge base search");
    expect(html).toContain("Acme Shop");
    expect(html).toContain('data-slot="tool-toggle-row" data-state="off"');
    expect(html).toContain("Add integration");
  });

  it("shows the Lead capture group under Bound sources (Figma 698:88502)", () => {
    const leadCapture = {
      enabled: true,
      workflowId: "wf-1",
      intake: [{ key: "need", label: "Need", required: true }],
      workflows: [{ id: "wf-1", name: "Lead engine", stageName: "Qualify", sharedBy: 1 }],
      notifyWhatsapp: null,
    };
    const html = renderToStaticMarkup(h(SourcesInspector, { ...props, leadCapture }));
    expect(html.indexOf("Add source")).toBeLessThan(html.indexOf("Create leads from conversations"));
    expect(html).toContain("Intake · Lead engine");
    expect(renderToStaticMarkup(h(SourcesInspector, props))).not.toContain("Lead capture");
  });
  it("shows the agent's knowledge in the Knowledge tab (Figma 535:74704)", () => {
    const html = renderToStaticMarkup(
      h(SourcesInspector, {
        ...props,
        initialTab: "knowledge",
        knowledge: [
          {
            id: "k1",
            name: "Acme price list 2026.pdf",
            type: "file",
            status: "ready",
            fileType: "application/pdf",
            fileSize: 2048,
            sourceUrl: null,
            content: "x",
            errorMessage: null,
            metadata: null,
            updatedAt: new Date(2026, 8, 24),
          },
        ],
      }),
    );
    expect(html).toContain("Knowledge · 1 source");
    expect(html).toContain("Acme price list 2026.pdf");
    expect(html).toContain("Add website");
    expect(html).not.toContain("agent settings");
  });

  it("shows the knowledge empty state for an agent without sources (Figma 535:76294)", () => {
    const html = renderToStaticMarkup(h(SourcesInspector, { ...props, initialTab: "knowledge" }));
    expect(html).toContain("No knowledge yet");
    expect(html).toContain("Acme Website Assistant answers from ready sources only.");
  });
});
