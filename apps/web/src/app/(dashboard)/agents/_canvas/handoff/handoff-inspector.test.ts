import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/handoff/actions", () => ({ updateHandoffSettings: vi.fn() }));
vi.mock("./actions", () => ({
  getTeamChatAvailability: vi.fn(async () => "unknown"),
  setUpTeamChatGroup: vi.fn(),
  resendRecipientConfirmation: vi.fn(),
}));

import { HandoffCanvasNode } from "./handoff-canvas-node";
import { HandoffInspector } from "./handoff-inspector";
import { handoffNodeView, type HandoffPanelData } from "./handoff-model";

const data: HandoffPanelData = {
  settings: {
    mode: "quick_answer",
    triggers: { priceNotListed: true, asksForPerson: true, complaintOrRefund: true, lowConfidence: false },
    recipientName: "Markus Albrecht · Sales",
    recipientWhatsapp: "+4915112342847",
    recipientConfirmed: true,
    expiryMinutes: 120,
    defaultReply: "agent",
    recipientCanTakeOver: true,
    waitingText: "A colleague will confirm the weekend rate in a few minutes.",
    ifNobodyAnswers: "reply_here",
  },
  group: null,
  latest: null,
};

const props = {
  agentId: "agent-1",
  agentName: "Acme Website Assistant",
  data,
  canManage: true,
  onClose: () => {},
  onTestChat: () => {},
};

const render = (d: HandoffPanelData, extra: Partial<typeof props> = {}) =>
  renderToStaticMarkup(h(HandoffInspector, { ...props, data: d, ...extra }));

describe("HandoffInspector (Figma 489:10446)", () => {
  it("Quick answer: mode, triggers, primary recipient, Inbox fallback, link options", () => {
    const html = render(data);
    expect(html).toContain("Human handoff");
    expect(html).toContain("Acme Website Assistant · customer agent");
    expect(html).toContain("Handoff mode: Quick answer");
    expect(html).toContain("Price is not in the price list");
    expect(html).toContain("Agent is not sure (below 60% confidence)");
    expect(html).toContain("Who answers");
    expect(html).toMatch(/data-slot="handoff-recipient" data-confirmed="true"/);
    expect(html).toContain("WhatsApp +49 151 •••• 2847");
    expect(html).toContain("Primary");
    expect(html).toContain("if there is no answer in 2 h");
    expect(html).toContain("Recipient can take over the chat");
    expect(html).toContain("Default reply");
    expect(html).toContain("If the link expires");
    expect(html).toContain("Save changes");
    expect(html).not.toContain('data-slot="handoff-team-chat"');
  });

  it("Recipient not confirmed: chip, Resend, Inbox until they confirm", () => {
    const html = render({ ...data, settings: { ...data.settings, recipientConfirmed: false } });
    expect(html).toMatch(/data-slot="handoff-recipient" data-confirmed="false"/);
    expect(html).toContain("Not confirmed");
    expect(html).toContain("Confirmation sent");
    expect(html).toContain("Resend");
    expect(html).toContain("until Markus confirms");
  });

  it("Takeover: idle hand-back row instead of reply options", () => {
    const html = render({ ...data, settings: { ...data.settings, mode: "takeover" } });
    expect(html).toContain("Handoff mode: Takeover");
    expect(html).toContain("Hands back to the agent");
    expect(html).toContain("after 30 min with no message");
    expect(html).not.toContain("Default reply");
  });

  it("Team chat: group card with invite link, Copy link and Inbox fallback", () => {
    const html = render({
      ...data,
      settings: { ...data.settings, mode: "team_chat" },
      group: { status: "active", subject: "Acme handoff team", inviteLink: "https://chat.whatsapp.com/K9x2Lr7QeW" },
    });
    expect(html).toContain("Team chat group");
    expect(html).toMatch(/data-slot="handoff-team-chat" data-status="active"/);
    expect(html).toContain("Acme handoff team");
    expect(html).toContain("https://chat.whatsapp.com/K9x2Lr7QeW");
    expect(html).toContain("Copy link");
    expect(html).toContain("Question expires after");
    expect(html).toContain("If nobody answers");
    expect(html).toContain('data-slot="handoff-inbox-fallback"');
    expect(html).not.toContain("Who answers");
  });

  it("Team chat without a group offers to create it", () => {
    const html = render({ ...data, settings: { ...data.settings, mode: "team_chat" } });
    expect(html).toMatch(/data-slot="handoff-team-chat" data-status="none"/);
    expect(html).toContain("Create group");
  });

  it("handed-back state: the latest request's hand-back notice", () => {
    const html = render({
      ...data,
      latest: { status: "handed_back", recipientName: "Markus Albrecht", handedBackAt: new Date(), handBackReason: "idle" },
    });
    expect(html).toContain('data-slot="handoff-handed-back"');
    expect(html).toContain("Handed back");
    expect(html).toContain("after 30 min with no message");
  });

  it("members see it read-only", () => {
    const html = render(data, { canManage: false });
    expect(html).toContain("Only the company owner can change handoff settings.");
    expect(html).not.toContain("Edit recipient");
  });
});

describe("HandoffCanvasNode", () => {
  it("links to the handoff inspector and shows the unconfirmed label", () => {
    const view = handoffNodeView({ settings: { ...data.settings, recipientConfirmed: false }, group: null });
    const html = renderToStaticMarkup(
      h(HandoffCanvasNode, { agentId: "agent-1", agentName: "Acme Website Assistant", view, selected: true }),
    );
    expect(html).toContain('href="/agents?agent=agent-1&amp;panel=handoff"');
    expect(html).toContain("Recipient not confirmed");
    expect(html).toContain('data-state="selected"');
    expect(html).toMatch(/data-slot="handoff-node-avatar"[^>]*>MA</);
  });
});
