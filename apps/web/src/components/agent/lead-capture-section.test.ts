import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(dashboard)/agents/actions", () => ({
  updateAgentLeadCapture: vi.fn(),
  updateAgentLeadIntake: vi.fn(),
}));
vi.mock("@/app/(dashboard)/agents/[id]/leads/actions", () => ({ updateLeadNotifyNumber: vi.fn() }));

import { IntakeEditor } from "./intake-editor";
import type { LeadCapturePanelData } from "./lead-capture-model";
import { LeadCaptureSection } from "./lead-capture-section";

const INTAKE = [
  { key: "name", label: "Name", required: true },
  { key: "company", label: "Company", required: true },
  { key: "need", label: "Need", required: true },
  { key: "budget", label: "Budget", required: false },
  { key: "timeline", label: "Timeline", required: false },
  { key: "location", label: "Location", required: false },
];

const on: LeadCapturePanelData = {
  enabled: true,
  workflowId: "wf-1",
  intake: INTAKE,
  workflows: [{ id: "wf-1", name: "Lead engine", stageName: "Qualify", sharedBy: 2 }],
  notifyWhatsapp: "+905551234567",
};

const render = (data: LeadCapturePanelData, canManage = true) =>
  renderToStaticMarkup(h(LeadCaptureSection, { agentId: "a1", data, canManage, onEditIntake: () => {} }));

describe("LeadCaptureSection", () => {
  it("shows workflow, stage, intake card and notify number when on (Figma 698:88502)", () => {
    const html = render(on);
    expect(html).toContain('data-slot="lead-capture" data-state="on"');
    expect(html).toContain("Lead capture");
    expect(html).toContain("Create leads from conversations");
    expect(html).toContain("Support chats never become leads");
    expect(html).toContain("Feeds workflow");
    expect(html).toContain("Lead engine");
    expect(html).toContain("Enters at stage");
    expect(html).toContain("Qualify");
    expect(html).toContain("Intake · Lead engine");
    expect(html).toContain("6 fields, 3 required: name, company, need");
    expect(html).toContain("Edit intake");
    expect(html).toContain("+905551234567");
  });

  it("shows only the toggle and the off hint when off (Figma 708:95861)", () => {
    const html = render({ ...on, enabled: false });
    expect(html).toContain('data-state="off"');
    expect(html).toContain("never creates leads");
    expect(html).not.toContain("Feeds workflow");
    expect(html).not.toContain("Edit intake");
  });

  it("disables Edit intake while no workflow is picked (legacy intake)", () => {
    const html = render({ ...on, workflowId: null });
    expect(html).toContain("Intake · Default");
    expect(html).toContain("Pick a workflow to edit its intake");
    expect(html).not.toContain("Enters at stage");
  });

  it("is read-only for non-owners", () => {
    const html = render(on, false);
    expect(html).not.toContain("Edit intake");
    expect(html).not.toContain("Notify on WhatsApp");
    expect(html).toMatch(/role="switch"[^>]*disabled/);
  });
});

describe("IntakeEditor (Figma 698:89422)", () => {
  it("lists phone locked from the channel, then each field with required and remove", () => {
    const html = renderToStaticMarkup(
      h(IntakeEditor, { agentId: "a1", workflowName: "Lead engine", sharedBy: 2, intake: INTAKE, onClose: () => {} }),
    );
    expect(html).toContain("Lead engine workflow · shared by 2 customer agents");
    expect(html).toContain("Field (asked in this order)");
    expect(html).toContain("From channel");
    expect(html.match(/data-slot="intake-field"/g)).toHaveLength(7);
    expect(html).toContain("Remove Location");
    expect(html.match(/data-state="checked"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).toContain("Add field");
    expect(html).toContain("Cancel");
    expect(html).toContain("Save intake");
  });
});
