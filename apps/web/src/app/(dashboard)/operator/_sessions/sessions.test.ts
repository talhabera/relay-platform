import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { OperatorSubnav } from "../_components/operator-subnav";
import {
  clearedSessionsHref,
  filterSessions,
  formatLastActivity,
  formatSessionTime,
  parseSessionsFilters,
  rangeLabel,
  resolveOperatorTab,
  safeTimeZone,
  sessionHref,
  sessionRowHref,
  sessionStatusCounts,
  sessionsHref,
  sessionsInRange,
  sessionsSummary,
  type SessionListRow,
  type SessionsFilters,
} from "./sessions-list";
import { SessionsView } from "./sessions-view";

const now = new Date("2026-09-25T10:00:00Z");
const tz = "Europe/Berlin";
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);

const row = (over: Partial<SessionListRow>): SessionListRow => ({
  id: "c1",
  title: "Lead re-check",
  status: "running",
  agentId: "a1",
  agentName: "Lead Qualifier",
  versionId: "v1",
  versionName: "v1",
  versionStatus: "live",
  workflowIds: ["w1"],
  workflowLabel: "Lead engine · Qualify",
  starterName: "Talha Bera",
  createdAt: hoursAgo(1),
  lastActivityAt: hoursAgo(0),
  openCheckpoints: 0,
  runId: null,
  scheduleName: null,
  ...over,
});

const rows: SessionListRow[] = [
  row({ id: "r1" }),
  row({ id: "r2", status: "needs_you", title: "Autumn outreach", agentId: "a2", agentName: "Mail Marketer", workflowIds: ["w1"], openCheckpoints: 1 }),
  row({ id: "r3", status: "completed", title: "Daily lead gathering", workflowIds: ["w2"], workflowLabel: "Content calendar · Plan", lastActivityAt: hoursAgo(30) }),
  row({ id: "r4", status: "failed", title: "Old run", lastActivityAt: hoursAgo(24 * 45) }),
];

const defaults = parseSessionsFilters({});

describe("operator routing", () => {
  it("defaults to Overview and keeps legacy cron/pipeline tabs", () => {
    expect(resolveOperatorTab(undefined)).toBe("overview");
    expect(resolveOperatorTab("bogus")).toBe("overview");
    expect(resolveOperatorTab("sessions")).toBe("sessions");
    expect(resolveOperatorTab("cron")).toBe("cron");
    expect(resolveOperatorTab("pipeline")).toBe("pipeline");
  });

  it("sub-nav marks the active segment and links Schedules to the cron tab", () => {
    const html = renderToStaticMarkup(h(OperatorSubnav, { active: "sessions" }));
    expect(html).toContain('href="/operator"');
    expect(html).toContain('href="/operator?tab=sessions"');
    expect(html).toContain('href="/operator?tab=cron"');
    expect(html).toMatch(/aria-current="page"[^>]*>Sessions</);
    expect(html).toContain(">Overview<");
    expect(html).toContain(">Schedules<");
    expect(html).toContain('href="/operator?tab=pipeline"');
    expect(html).toContain(">Pipeline<");
  });
});

describe("session filters", () => {
  it("parses URL params and rejects unknown values", () => {
    expect(defaults).toEqual({ status: "all", workflowId: null, agentId: null, range: "30d", q: "" });
    expect(parseSessionsFilters({ status: "failed", workflow: "w1", agent: "a1", range: "7d", q: " x " })).toEqual({
      status: "failed",
      workflowId: "w1",
      agentId: "a1",
      range: "7d",
      q: "x",
    });
    expect(parseSessionsFilters({ status: "nope", range: "1y" })).toMatchObject({ status: "all", range: "30d" });
  });

  it("builds hrefs without defaults and clears everything but the range", () => {
    expect(sessionsHref(defaults)).toBe("/operator?tab=sessions");
    const f: SessionsFilters = { status: "completed", workflowId: "w1", agentId: null, range: "90d", q: "lead" };
    expect(sessionsHref(f)).toBe("/operator?tab=sessions&status=completed&workflow=w1&range=90d&q=lead");
    expect(clearedSessionsHref(f)).toBe("/operator?tab=sessions&range=90d");
    expect(sessionHref({ id: "c1" })).toBe("/operator?chatId=c1");
    expect(sessionRowHref(row({ id: "r1", runId: "r1", scheduleName: "Lead gather" }))).toBe("/operator?runId=r1");
  });

  it("filters by range, status, workflow, agent and search", () => {
    const ids = (f: Partial<SessionsFilters>) => filterSessions(rows, { ...defaults, ...f }, now).map((r) => r.id);
    expect(ids({})).toEqual(["r1", "r2", "r3"]);
    expect(ids({ range: "all" })).toEqual(["r1", "r2", "r3", "r4"]);
    expect(ids({ status: "needs_you" })).toEqual(["r2"]);
    expect(ids({ workflowId: "w2" })).toEqual(["r3"]);
    expect(ids({ agentId: "a2" })).toEqual(["r2"]);
    expect(ids({ q: "OUTREACH" })).toEqual(["r2"]);
    expect(ids({ q: "content calendar" })).toEqual(["r3"]);
  });

  it("counts statuses over the date range", () => {
    expect(sessionStatusCounts(sessionsInRange(rows, "30d", now))).toEqual({
      all: 3,
      running: 1,
      needs_you: 1,
      completed: 1,
      failed: 0,
    });
  });
});

describe("formatting", () => {
  it("formats times in the company timezone", () => {
    expect(formatSessionTime(new Date("2026-09-25T10:02:00Z"), tz)).toBe("Fri 25 Sep, 12:02");
    expect(formatLastActivity(now, now, tz)).toBe("Just now");
    expect(formatLastActivity(hoursAgo(0.2), now, tz)).toBe("12 min ago");
    expect(formatLastActivity(hoursAgo(2), now, tz)).toBe("2 h ago");
    expect(formatLastActivity(hoursAgo(30), now, tz)).toBe("Thu 24 Sep, 06:00");
    expect(rangeLabel("30d", now, tz)).toBe("26 Aug – 25 Sep");
    expect(rangeLabel("all", now, tz)).toBe("All time");
    expect(safeTimeZone("Not/AZone")).toBe("UTC");
  });

  it("summarises default and filtered lists", () => {
    const base = { total: 9, workflowName: null, agentName: null, now, timeZone: tz };
    expect(sessionsSummary({ ...base, filters: defaults, shown: 9 })).toBe(
      "Showing 9 sessions from 26 Aug to 25 Sep. Finished sessions stay listed and open read-only.",
    );
    expect(
      sessionsSummary({ ...base, workflowName: "Content calendar", filters: { ...defaults, status: "failed", workflowId: "w2" }, shown: 0 }),
    ).toBe("0 of 9 sessions match Failed · Content calendar · 26 Aug – 25 Sep.");
  });
});

describe("SessionsView", () => {
  const view = (filters: SessionsFilters) => {
    const rangeRows = sessionsInRange(rows, filters.range, now);
    return renderToStaticMarkup(
      h(SessionsView, {
        companyName: "Acme GmbH",
        timeZone: tz,
        timeZoneLabel: "CEST",
        filters,
        rangeRows,
        rows: filterSessions(rows, filters, now),
        workflowName: filters.workflowId === "w2" ? "Content calendar" : null,
        agentName: null,
        now,
      }),
    );
  };

  it("default: header, status chips with counts, a row per session linking to the workbench", () => {
    const html = view(defaults);
    expect(html).toContain("Every operator session for Acme GmbH, open or finished · Times in CEST");
    expect(html).toContain("New session");
    expect(html).toMatch(/data-status="all"[^>]*>All 3</);
    expect(html).toMatch(/aria-current="true"[^>]*data-slot="status-filter"[^>]*data-status="all"/);
    expect(html.match(/data-slot="session-row"/g)).toHaveLength(3);
    expect(html).toContain('href="/operator?chatId=r2"');
    expect(html).toContain("Lead engine · Qualify");
    expect(html).toContain(">Checkpoints<");
    expect(html).toContain("Showing 3 sessions");
  });

  it("filtered: selected chip and only matching rows", () => {
    const html = view({ ...defaults, status: "completed" });
    expect(html).toMatch(/aria-current="true"[^>]*data-slot="status-filter"[^>]*data-status="completed"/);
    expect(html.match(/data-slot="session-row"/g)).toHaveLength(1);
    expect(html).toContain("1 of 3 sessions match Completed");
  });

  it("empty: filter icon, explanation and Clear filters", () => {
    const html = view({ ...defaults, status: "failed", workflowId: "w2" });
    expect(html).not.toContain('data-slot="session-row"');
    expect(html).toContain("No sessions match these filters");
    expect(html).toContain("No failed sessions in Content calendar between 26 Aug and 25 Sep. Clear the filters to see all 3 sessions.");
    expect(html).toContain('href="/operator?tab=sessions"');
    expect(html).toContain("Clear filters");
    expect(html).toContain('data-icon="filter"');
  });

  it("no sessions at all: no Clear filters", () => {
    const html = renderToStaticMarkup(
      h(SessionsView, {
        companyName: "Acme GmbH",
        timeZone: tz,
        timeZoneLabel: "CEST",
        filters: defaults,
        rangeRows: [],
        rows: [],
        workflowName: null,
        agentName: null,
        now,
      }),
    );
    expect(html).toContain("No sessions yet");
    expect(html).not.toContain("Clear filters");
  });
});
