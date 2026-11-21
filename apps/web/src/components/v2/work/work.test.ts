import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  GoalStrip,
  NeedsYouPanel,
  NeedsYouRow,
  needsYouKind,
  ScheduleRow,
  VersionTicket,
  WorkflowStageNode,
  type NeedsYouRowData,
} from "./index";

const render = (el: ReactElement) => renderToStaticMarkup(el);
const classOf = (html: string, slot: string) => {
  const m = html.match(new RegExp(`data-slot="${slot}"[^>]*class="([^"]*)"|class="([^"]*)"[^>]*data-slot="${slot}"`));
  return m ? (m[1] ?? m[2]).replaceAll("&amp;", "&") : "";
};
const count = (html: string, needle: string) => html.split(needle).length - 1;

// Figma 02 `375:22366` v2/work.
const rows: NeedsYouRowData[] = [
  {
    id: "r1",
    kind: "failed-run",
    title: "Google Places quota reached, 06:00",
    workflow: "Lead engine",
    impact: "Gather paused, no new leads since 06:00",
    agent: "Lead Gatherer",
    age: "6h ago",
    href: "/operator?chat=1",
  },
  {
    id: "r2",
    kind: "question",
    title: "Include offices under 20 employees?",
    workflow: "Lead engine",
    impact: "1 borderline lead held in Qualify",
    agent: "Lead Qualifier",
    age: "38m ago",
    href: "/operator?chat=2",
  },
  {
    id: "r3",
    kind: "checkpoint",
    title: "Schedule sequence to 44 leads",
    workflow: "Lead engine",
    impact: "44 qualified leads wait for outreach",
    agent: "Mail Marketer",
    age: "12m ago",
    href: "/operator?chat=3",
  },
];

describe("Needs you row (375:22849)", () => {
  it.each([
    ["checkpoint", "Checkpoint", "flag", "bg-primary-soft", "text-primary"],
    ["question", "Question", "message-circle", "bg-status-needs-you", "text-status-needs-you-foreground"],
    ["failed-run", "Failed run", "triangle-alert", "bg-status-rejected", "text-status-rejected-foreground"],
    ["brief", "Brief", "list-checks", "bg-primary-soft", "text-primary"],
  ] as const)("kind=%s renders its label, glyph and tile tone", (kind, label, icon, tileBg, labelFg) => {
    const html = render(h(NeedsYouRow, { ...rows[2], kind }));
    expect(html).toContain(`data-kind="${kind}"`);
    expect(html).toContain(label);
    expect(html).toContain(`data-icon="${icon}"`);
    expect(classOf(html, "needs-you-row-tile")).toContain(tileBg);
    expect(classOf(html, "needs-you-row-kind")).toContain(labelFg);
    expect(classOf(html, "needs-you-row-kind")).toContain("type-label");
  });

  it("shows title, workflow chip, impact with target glyph, agent, age and an Open session link", () => {
    const html = render(h(NeedsYouRow, rows[2]));
    expect(html).toContain("Schedule sequence to 44 leads");
    expect(html).toContain('data-slot="chip"');
    expect(html).toContain("Lead engine");
    expect(html).toContain('data-icon="target"');
    expect(html).toContain("44 qualified leads wait for outreach");
    expect(html).toContain("Mail Marketer");
    expect(html).toContain("12m ago");
    expect(html).toMatch(/<a[^>]*href="\/operator\?chat=3"[^>]*>[\s\S]*Open session/);
    expect(classOf(html, "needs-you-row")).toContain("border-b");
  });

  it("omits the workflow chip and impact line when absent", () => {
    const html = render(h(NeedsYouRow, { ...rows[2], workflow: undefined, impact: undefined }));
    expect(html).not.toContain('data-slot="chip"');
    expect(html).not.toContain('data-icon="target"');
  });

  it("maps NeedsYouItem types to row kinds", () => {
    expect(needsYouKind("checkpoint")).toBe("checkpoint");
    expect(needsYouKind("agent_question")).toBe("question");
    expect(needsYouKind("failed_run")).toBe("failed-run");
    expect(needsYouKind("brief")).toBe("brief");
  });

  it("links a brief with Open brief instead of Open session", () => {
    const html = render(h(NeedsYouRow, { ...rows[2], kind: "brief", href: "/home#brief" }));
    expect(html).toMatch(/<a[^>]*href="\/home#brief"[^>]*>[\s\S]*Open brief/);
    expect(html).not.toContain("Open session");
  });
});

describe("Needs you panel (375:23840)", () => {
  it("default: header with warning count badge matching rows, list and footer", () => {
    const html = render(h(NeedsYouPanel, { items: rows, viewAllHref: "/operator?tab=needs-you" }));
    expect(html).toContain("Needs you");
    expect(classOf(html, "count-badge")).toContain("bg-warning");
    expect(html).toMatch(/data-slot="count-badge"[^>]*>3</);
    expect(count(html, 'data-slot="needs-you-row"')).toBe(3);
    expect(html).toContain("View all");
    expect(html).toContain('href="/operator?tab=needs-you"');
    expect(html).toContain("Ordered by impact on qualified leads");
    expect(html).toContain("Open Operator");
    expect(classOf(html, "needs-you-panel")).toContain("bg-popover");
    expect(classOf(html, "needs-you-panel")).toContain("shadow-elevation-2");
  });

  it("keeps the given order (server ordering is authoritative)", () => {
    const html = render(h(NeedsYouPanel, { items: rows }));
    const i1 = html.indexOf("Google Places");
    const i2 = html.indexOf("Include offices");
    const i3 = html.indexOf("Schedule sequence");
    expect(i1).toBeLessThan(i2);
    expect(i2).toBeLessThan(i3);
  });

  it("badge shows the total when it exceeds the visible rows", () => {
    const html = render(h(NeedsYouPanel, { items: rows, total: 7 }));
    expect(html).toMatch(/data-slot="count-badge"[^>]*>7</);
  });

  it("empty: caught-up state, no badge, footer stays", () => {
    const html = render(h(NeedsYouPanel, { items: [] }));
    expect(html).toContain('data-state="empty"');
    expect(html).toContain("You&#x27;re all caught up");
    expect(html).toContain('data-icon="circle-check"');
    expect(html).not.toContain('data-slot="count-badge"');
    expect(html).not.toContain('data-slot="needs-you-row"');
    expect(html).toContain("Open Operator");
  });
});

describe("Goal strip (375:24042)", () => {
  it("renders delivered vs target with a progress bar, quality and cost cards", () => {
    const html = render(
      h(GoalStrip, { weekLabel: "21–27 Sep", delivered: 6, target: 10, quality: 82, costPerLead: "€41" }),
    );
    expect(count(html, 'data-slot="goal-strip-card"')).toBe(3);
    expect(html).toContain("Qualified leads delivered · 21–27 Sep");
    expect(html).toMatch(/type-metric[^>]*>6</);
    expect(html).toContain("/ 10");
    expect(html).toContain('aria-valuenow="6"');
    expect(html).toContain('aria-valuemax="10"');
    expect(html).toContain("60%");
    expect(html).toContain("Lead quality score");
    expect(html).toMatch(/type-metric[^>]*>82</);
    expect(html).toContain("/ 100");
    expect(html).toContain("Cost per qualified lead");
    expect(html).toContain("€41");
    for (const icon of ["users", "gauge", "target"]) expect(html).toContain(`data-icon="${icon}"`);
    expect(classOf(html, "goal-strip-card")).toContain("shadow-elevation-1");
  });

  it("shows an em dash for missing quality and cost", () => {
    const html = render(h(GoalStrip, { weekLabel: "21–27 Sep", delivered: 0, target: 10, quality: null, costPerLead: null }));
    expect(count(html, ">—<")).toBe(2);
    expect(html).toContain("0%");
  });
});

describe("Workflow stage node (375:25134)", () => {
  const base = {
    stage: "Qualify",
    agent: { name: "Lead Qualifier", version: "v1", status: "live" as const },
    count: "44 qualified",
  };

  it.each([
    ["default", "border-border", "shadow-elevation-1"],
    ["active", "border-primary", "shadow-glow-primary"],
    ["needs_you", "border-status-needs-you-foreground", "shadow-elevation-1"],
    ["idle", "border-dashed", "border-border-strong"],
  ] as const)("state=%s styles the card", (state, a, b) => {
    const html = render(h(WorkflowStageNode, { ...base, state, pending: state === "needs_you" ? 1 : 0 }));
    expect(html).toContain(`data-state="${state}"`);
    expect(classOf(html, "workflow-stage-node")).toContain(a);
    expect(classOf(html, "workflow-stage-node")).toContain(b);
  });

  it("renders stage, agent chip, count with dot and both ports", () => {
    const html = render(h(WorkflowStageNode, { ...base }));
    expect(html).toContain("Qualify");
    expect(html).toContain('data-slot="agent-chip"');
    expect(html).toContain("Lead Qualifier");
    expect(html).toContain("44 qualified");
    expect(html).toContain('data-slot="workflow-stage-dot"');
    expect(html).toContain('data-slot="workflow-stage-port-in"');
    expect(html).toContain('data-slot="workflow-stage-port-out"');
  });

  it("needs_you shows a warning count badge; other states do not", () => {
    const nu = render(h(WorkflowStageNode, { ...base, state: "needs_you", pending: 2 }));
    expect(classOf(nu, "count-badge")).toContain("bg-warning");
    expect(nu).toMatch(/data-slot="count-badge"[^>]*>2</);
    expect(render(h(WorkflowStageNode, { ...base, state: "active", pending: 2 }))).not.toContain("count-badge");
  });

  it("idle mutes the stage name; a missing agent reads No agent", () => {
    const html = render(h(WorkflowStageNode, { ...base, state: "idle", agent: null }));
    expect(classOf(html, "workflow-stage-name")).toContain("text-muted-foreground");
    expect(html).toContain("No agent");
    expect(html).not.toContain('data-slot="agent-chip"');
  });
});

describe("Schedule row (444:37734)", () => {
  const base = {
    name: "Daily lead gathering",
    workflow: "Lead engine · Gather",
    agent: { name: "Lead Gatherer", version: "v1", status: "live" as const },
    cadence: "Daily · 06:00",
    nextRun: "Sat 26 Sep, 06:00",
    lastResult: "error" as const,
    resultNote: "Google Places quota reached",
    approval: "Nothing leaves Relay",
  };

  it("default density renders the six columns and an overflow icon button", () => {
    const html = render(h(ScheduleRow, base));
    expect(html).toContain('data-density="default"');
    for (const t of [base.name, base.workflow, "Lead Gatherer", base.cadence, base.nextRun, base.resultNote, base.approval]) {
      expect(html).toContain(t);
    }
    expect(html).toContain('data-slot="status-chip"');
    expect(html).toContain('data-tone="error"');
    expect(html).toContain('data-icon="ellipsis"');
    expect(classOf(html, "schedule-row")).toContain("border-b");
    expect(html).not.toContain("Open last run");
  });

  it("links the last run when lastRunHref is set", () => {
    const html = render(h(ScheduleRow, { ...base, lastRunHref: "/operator?chat=9" }));
    expect(html).toMatch(/<a[^>]*href="\/operator\?chat=9"[^>]*>Open last run</);
  });

  it("no last run shows a neutral chip", () => {
    const html = render(h(ScheduleRow, { ...base, lastResult: null, resultNote: undefined }));
    expect(html).toContain('data-tone="neutral"');
    expect(html).toContain("No runs yet");
  });

  it("compact density: icon tile, name + meta, status chip, chevron, link", () => {
    const html = render(
      h(ScheduleRow, {
        ...base,
        density: "compact",
        lastResult: "success",
        meta: "Daily · 06:00 · Lead engine",
        href: "/operator?tab=cron&jobId=j1",
      }),
    );
    expect(html).toContain('data-density="compact"');
    expect(html).toMatch(/^<a[^>]*href="\/operator\?tab=cron&amp;jobId=j1"/);
    expect(html).toContain('data-icon="calendar-clock"');
    expect(html).toContain("Daily · 06:00 · Lead engine");
    expect(html).toContain('data-tone="success"');
    expect(html).toContain('data-icon="chevron-right"');
    expect(html).not.toContain('data-icon="ellipsis"');
    expect(classOf(html, "schedule-row")).toContain("rounded-lg");
  });
});

describe("Version ticket (17:211)", () => {
  it.each([
    ["live", true],
    ["live", false],
    ["draft", true],
    ["draft", false],
  ] as const)("status=%s selected=%s", (status, selected) => {
    const html = render(h(VersionTicket, { version: status === "live" ? "v1" : "v2", status, title: "t", selected }));
    expect(html).toContain(`data-status="${status}"`);
    expect(html).toContain(`aria-pressed="${selected}"`);
    expect(html).toContain(`data-tone="${status}"`);
    const cls = classOf(html, "version-ticket");
    if (selected) {
      expect(cls).toContain("bg-primary-soft");
      expect(cls).toContain("border-primary");
    } else {
      expect(cls).toContain("bg-card");
      expect(cls).toContain("border-border");
    }
  });

  it("renders version in mono, title and the parent note only when given", () => {
    const html = render(
      h(VersionTicket, { version: "v2", status: "draft", title: "Stricter size criteria", note: "Forked from v1 · 23 Sep" }),
    );
    expect(html).toMatch(/type-mono[^>]*>v2</);
    expect(html).toContain("Stricter size criteria");
    expect(html).toContain("Forked from v1 · 23 Sep");
    expect(render(h(VersionTicket, { version: "v1", status: "live", title: "Deployed 14 Sep" }))).not.toContain(
      'data-slot="version-ticket-note"',
    );
  });
});
