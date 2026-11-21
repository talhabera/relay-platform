import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(dashboard)/operator/cron-actions", () => ({
  deleteCronJob: vi.fn(),
  updateCronJob: vi.fn(),
}));

import { CronJobsTable } from "./cron-jobs-table";
import type { CronJobListItem } from "./operator-cron-tab";

const job = (over: Partial<CronJobListItem>): CronJobListItem => ({
  id: "j1",
  name: "Daily lead gathering",
  agentId: "a1",
  agentName: "Lead Gatherer",
  versionId: "v1",
  prompt: "Gather 20 offices in Munich\nmore detail",
  enabled: true,
  scheduleKind: "daily",
  intervalMinutes: null,
  weekday: null,
  timeOfDay: 360,
  timezone: "UTC",
  latestStatus: null,
  canEdit: true,
  versionName: "v1",
  versionStatus: "live",
  nextFireAt: "2026-09-26T06:00:00.000Z",
  lastRun: null,
  ...over,
});

const render = (jobs: CronJobListItem[]) =>
  renderToStaticMarkup(
    h(CronJobsTable, { jobs, selectedJobId: null, onToggleEnabled: () => {}, onDelete: () => {} }),
  ).replaceAll("&amp;", "&");

describe("CronJobsTable (Figma 05 schedules/default)", () => {
  it("renders the Figma column heads and one Schedule row per job", () => {
    const html = render([job({}), job({ id: "j2", name: "Weekly report" })]);
    for (const head of ["Schedule", "Agent", "Cadence", "Next run", "Last run", "Needs approval"]) {
      expect(html).toContain(`>${head}<`);
    }
    expect(html.split('data-slot="schedule-row"').length - 1).toBe(2);
    expect(html).toContain("Daily · 06:00");
    expect(html).toContain("Sat 26 Sep, 06:00");
    expect(html).toContain("Gather 20 offices in Munich");
  });

  it("links the name to the editor and the last run to its transcript", () => {
    const html = render([
      job({
        latestStatus: "failed",
        lastRun: { id: "r9", status: "failed", fireAt: "2026-09-25T06:00:00.000Z", error: "Google Places quota reached" },
      }),
    ]);
    expect(html).toMatch(/<a[^>]*href="\/operator\?tab=cron&jobId=j1"[^>]*>Daily lead gathering</);
    expect(html).toMatch(/<a[^>]*href="\/operator\?runId=r9"[^>]*>Open last run</);
    expect(html).toContain('data-tone="error"');
    expect(html).toContain("Google Places quota reached");
  });

  it("shows a needs-you chip for a run waiting on a checkpoint and Paused for a disabled job", () => {
    const html = render([
      job({
        enabled: false,
        nextFireAt: null,
        latestStatus: "awaiting_input",
        lastRun: { id: "r1", status: "awaiting_input", fireAt: "2026-09-25T06:00:00.000Z", error: null },
      }),
    ]);
    expect(html).toContain('data-tone="needs-you"');
    expect(html).toContain("Needs you");
    expect(html).toContain(">Paused<");
  });

  it("renders the empty state without rows", () => {
    const html = render([]);
    expect(html).toContain("No schedules yet");
    expect(html).not.toContain('data-slot="schedule-row"');
  });
});
