import { createElement as h, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

import { SessionSteerProvider } from "@/components/operator/session-steer";

import { contentCalendarFixture } from "./calendar-fixtures";
import { CalendarPane, type CalendarPaneProps } from "./calendar-pane";
import { CALENDAR_FIXTURE_NOW, hasCalendarPane } from "./load-calendar-pane";

const base: CalendarPaneProps = {
  socialConnected: true,
  calendar: contentCalendarFixture,
  now: CALENDAR_FIXTURE_NOW.toISOString(),
  canAct: true,
};

const steered = (el: ReactElement) =>
  renderToStaticMarkup(h(SessionSteerProvider, { value: { send: () => {}, isStreaming: false } }, el));

describe("CalendarPane", () => {
  it("shows the Connect state until a social connector is connected", () => {
    const html = renderToStaticMarkup(h(CalendarPane, { ...base, socialConnected: false }));
    expect(html).toContain('data-state="connect"');
    expect(html).toContain("Connect Meta");
    expect(html).toContain('href="/settings/connectors"');
    expect(html).not.toContain('data-slot="calendar-post"');
  });

  it("shows an empty state when connected but nothing is planned", () => {
    const html = renderToStaticMarkup(h(CalendarPane, { ...base, calendar: null }));
    expect(html).toContain('data-state="empty"');
    expect(html).toContain("No posts planned yet");
  });

  it("renders the 05 session-calendar/default frame", () => {
    const html = steered(h(CalendarPane, base));
    expect(html).toContain('data-state="calendar"');
    expect(html).toContain(">Content calendar<");
    expect(html).toContain("October 2026 · 12 posts · 3 need review");
    expect(html).toContain(">October 2026<");
    expect(html).toContain(">9 scheduled<");
    expect(html).toContain(">3 need review<");
    for (const d of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) expect(html).toContain(`>${d}<`);
    expect(html.match(/data-slot="calendar-day"/g)).toHaveLength(35);
    expect(html.match(/data-in-month="false"/g)).toHaveLength(4);
    expect(html.match(/data-slot="calendar-post"/g)).toHaveLength(12);
    expect(html.match(/data-status="needs-review"/g)).toHaveLength(3);
    expect(html).toContain("Brandt Logistik");
    expect(html).toContain("Add post");
    expect(html).toContain("Export");
  });

  it("hides steering actions and disables posts for viewers who cannot steer", () => {
    const html = steered(h(CalendarPane, { ...base, canAct: false }));
    expect(html).not.toContain("Add post");
    expect(html).toContain("Export");
    expect(html.match(/data-slot="calendar-post"[^>]*disabled=""/g)?.length ?? 0).toBe(12);
  });
});

describe("hasCalendarPane", () => {
  const social = { packageSlug: "social-media", name: "Social Media Manager" };
  it("matches the Social Media Manager outside review sessions", () => {
    expect(hasCalendarPane(social, "October content calendar")).toBe(true);
    expect(hasCalendarPane(social, null)).toBe(true);
    expect(hasCalendarPane(social, "New reviews this week")).toBe(false);
    expect(hasCalendarPane({ packageSlug: "lead-engine", name: "Mail Marketer" }, "Calendar")).toBe(false);
    expect(hasCalendarPane(null, "x")).toBe(false);
  });
});
