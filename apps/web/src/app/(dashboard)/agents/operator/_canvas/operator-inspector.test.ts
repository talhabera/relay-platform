import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/(dashboard)/operator/knowledge-actions", () => ({
  createOperatorKnowledgeEntry: vi.fn(),
  createOperatorKnowledgeFromWebsite: vi.fn(),
  updateOperatorKnowledgeEntry: vi.fn(),
  deleteOperatorKnowledgeEntry: vi.fn(),
}));
vi.mock("@/app/(dashboard)/agents/actions", () => ({
  createKnowledgeEntry: vi.fn(),
  createKnowledgeFromWebsite: vi.fn(),
  updateKnowledgeEntry: vi.fn(),
  deleteKnowledgeEntry: vi.fn(),
}));
vi.mock("@/app/(dashboard)/operator/actions", () => ({}));
vi.mock("@/app/(dashboard)/operator/cron-actions", () => ({}));

import type { AgentVersion } from "@/types";

import type { OperatorInspectorData } from "./load-operator-inspector";
import type { OperatorCanvasSelection } from "./operator-canvas-model";
import { OperatorInspector } from "./operator-inspector";

const selection: OperatorCanvasSelection = {
  agentId: "qualifier",
  name: "Lead Qualifier",
  description: "Scores gathered and inbound leads.",
  focusVersion: { id: "q2", name: "v2", status: "draft" },
  versions: [
    {
      id: "q2",
      name: "v2",
      status: "draft",
      forkedFrom: "Forked from v1",
      note: "Stricter size criteria",
      createdAt: new Date(2026, 8, 23),
      focused: true,
    },
    { id: "q1", name: "v1", status: "live", createdAt: new Date(2026, 8, 14), focused: false },
  ],
  modelLabel: "Claude Sonnet",
  connectors: [{ name: "Hunter", brand: "hunter" }],
  usedIn: ["Lead engine · Qualify"],
  tools: ["Web search", "Company memory"],
};

const version = (over: Partial<AgentVersion>): AgentVersion => ({
  id: "q1",
  agentId: "qualifier",
  name: "v1",
  parentVersionId: null,
  changeNote: null,
  instructions: "Mark offices under 20 employees as borderline.",
  toolToggles: { webSearch: true, excel: true, companyMemory: true, proposeAction: true },
  model: "sonnet",
  status: "live",
  createdByUserId: "owner",
  createdAt: new Date(2026, 8, 14),
  ...over,
});

const people = {
  owner: { id: "owner", name: "Talha Bera", email: "talha@acme.test" },
  deniz: { id: "deniz", name: "Deniz Aksoy", email: "deniz@acme.test" },
  mert: { id: "mert", name: "Mert Kaya", email: "mert@acme.test" },
};

const data = (viewerId = "owner", canEdit = true): OperatorInspectorData => ({
  companyId: "acme",
  canEdit,
  versions: [
    version({
      id: "q2",
      name: "v2",
      status: "draft",
      parentVersionId: "q1",
      changeNote: "Stricter size criteria",
      instructions: "Reject offices under 20 employees.",
      toolToggles: { webSearch: true, excel: false, companyMemory: true, proposeAction: true },
    }),
    version({}),
  ],
  knowledgeEntries: [],
  access: {
    viewerId,
    ownerId: "owner",
    creatorId: "owner",
    viewerCanEdit: canEdit,
    agentUsers: [
      { user: people.deniz, canEdit: true, canApprove: true },
      { user: people.mert, canEdit: false, canApprove: true },
    ],
    members: [
      { user: people.deniz, role: "member", operator: true },
      { user: people.mert, role: "member", operator: true },
    ],
    people: [people.owner],
  },
  schedules: [
    {
      id: "j1",
      name: "Qualify gathered leads",
      scheduleKind: "daily",
      intervalMinutes: null,
      weekday: null,
      timeOfDay: 420,
      timezone: "UTC",
      enabled: true,
      nextFireAt: new Date("2026-09-28T07:00:00Z"),
      versionName: "v1",
      latestStatus: "awaiting_input",
    },
  ],
});

const render = (props: Partial<Parameters<typeof OperatorInspector>[0]>) =>
  renderToStaticMarkup(h(OperatorInspector, { selection, data: null, ...props }));

/** Switch markup for a labelled switch: [checked, disabled]. */
function switchState(html: string, label: string): [boolean, boolean] {
  const tag = new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`).exec(html)?.[0];
  if (!tag) throw new Error(`no switch ${label}`);
  return [tag.includes('aria-checked="true"'), / disabled=""/.test(tag)];
}

describe("OperatorInspector", () => {
  it("opens on Versions with five tabs, Access in place of Editors", () => {
    const html = render({ data: data() });
    expect(html).toContain("Lead Qualifier inspector");
    const tabs = ["Versions", "Tools", "Schedules", "Access", "Knowledge"].map((t) => html.indexOf(`>${t}<`));
    expect(tabs.every((i) => i > 0)).toBe(true);
    expect([...tabs].sort((a, b) => a - b)).toEqual(tabs);
    expect(html).not.toContain(">Editors<");
  });

  it("Versions: tickets with change note, forked from, model, connectors, Used in, tools", () => {
    const html = render({ data: data() });
    expect(html).toContain("Stricter size criteria");
    expect(html).toContain("Forked from v1 · 23 Sep");
    expect(html).toContain("Deployed 14 Sep");
    expect(html).toContain('href="/agents/operator?agent=qualifier&amp;version=q1"');
    expect(html).toContain("Claude Sonnet");
    expect(html).toContain("Hunter");
    expect(html).toContain("Lead engine · Qualify");
    expect(html).toContain("Company memory");
  });

  it("footer: Fork version and Promote v2 to live for editors", () => {
    const html = render({ data: data() });
    expect(html).toMatch(/data-slot="inspector-footer"[\s\S]*Fork version[\s\S]*Promote v2 to live/);
  });

  it("footer is hidden for viewers who cannot edit", () => {
    expect(render({ data: data("deniz", false) })).not.toContain('data-slot="inspector-footer"');
  });

  it("Tools: one toggle row per catalog tool for the focused version, WhatsApp coming soon", () => {
    const html = render({ data: data(), initialTab: "tools" });
    expect(html).toContain("Tools · v2 Draft");
    expect(html.match(/data-slot="tool-toggle-row"/g)).toHaveLength(5);
    expect(html).toMatch(/data-state="off"[^>]*>[\s\S]*?Excel/);
    expect(html).toMatch(/data-state="coming-soon"[\s\S]*WhatsApp notification/);
  });

  it("Schedules: the agent's jobs, next run and deep links", () => {
    const html = render({ data: data(), initialTab: "schedules" });
    expect(html).toContain("Scheduled jobs · 1");
    expect(html).toContain("Daily · 07:00 · v1");
    expect(html).toContain("Needs you");
    expect(html).toContain("Mon 28 Sep, 07:00 UTC · Qualify gathered leads");
    expect(html).toContain('href="/operator?tab=cron&amp;jobId=j1"');
    expect(html).toContain("New schedule");
    expect(html).toContain('href="/operator?tab=cron"');
  });

  it("Access (owner): creator locked, member Edit and Approve toggles live", () => {
    const html = render({ data: data(), initialTab: "access" });
    expect(html).toContain("People on Lead Qualifier");
    expect(html).toContain("Owner · agent creator");
    expect(html).toContain('aria-label="Locked: agent creator"');
    expect(switchState(html, "Edit for Talha Bera")).toEqual([true, true]);
    expect(switchState(html, "Approve for Talha Bera")).toEqual([true, true]);
    expect(switchState(html, "Edit for Mert Kaya")).toEqual([false, false]);
    expect(switchState(html, "Approve for Mert Kaya")).toEqual([true, false]);
    expect(html).toContain("Only the company owner can turn it on or off.");
    expect(html).toContain("Everyone else");
  });

  it("Access (member editor): Approve is owner-only, Edit stays toggleable", () => {
    const html = render({ data: data("deniz", true), initialTab: "access" });
    expect(switchState(html, "Approve for Deniz Aksoy")).toEqual([true, true]);
    expect(switchState(html, "Approve for Mert Kaya")).toEqual([true, true]);
    expect(switchState(html, "Edit for Mert Kaya")).toEqual([false, false]);
    expect(html).toContain("Only the company owner can change Approve.");
  });

  it("Knowledge renders the operator KnowledgeTab for editors, read-only otherwise", () => {
    expect(render({ data: data(), initialTab: "knowledge" })).toMatch(/Add website|Add text|Upload file/);
    expect(render({ data: data("mert", false), initialTab: "knowledge" })).toContain(
      "Only the agent creator and people with Edit can change Lead Qualifier.",
    );
  });

  it("without operator access the data tabs explain why", () => {
    expect(render({ initialTab: "access" })).toContain("Operator access to Lead Qualifier");
  });
});
