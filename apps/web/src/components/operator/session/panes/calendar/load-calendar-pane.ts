import { and, eq, inArray, isNull } from "drizzle-orm";
import { PACKAGE_CATALOG } from "@relay/db";

import { db } from "@/db";
import { integrations } from "@/db/schema";
import { isFixturesEnabled } from "@/lib/fixtures";

import { contentCalendarFixture } from "./calendar-fixtures";
import type { CalendarPaneProps } from "./calendar-pane";

/** Fixture clock: Thu 24 Sep 2026, 10:05 (session start in the canon frame). */
export const CALENDAR_FIXTURE_NOW = new Date("2026-09-24T08:05:00.000Z");

const SOCIAL_MANAGER_NAME =
  PACKAGE_CATALOG.find((p) => p.slug === "social-media")?.agents.find((a) => a.key === "social")?.name ??
  "Social Media Manager";

/**
 * Sessions that get the Calendar work pane: the Social media package's Social
 * Media Manager, except review sessions (those get the Reviews pane, S54).
 * The agent does both jobs, so the session title tells them apart until the
 * content model (phase 2) links a session to its calendar.
 */
export function hasCalendarPane(
  agent: { packageSlug: string | null | undefined; name: string } | null | undefined,
  sessionTitle: string | null | undefined,
): boolean {
  if (agent?.packageSlug !== "social-media" || agent.name !== SOCIAL_MANAGER_NAME) return false;
  return !/\breview/i.test(sessionTitle ?? "");
}

/** True when the company has a connected Meta or LinkedIn connector (company-level). */
async function socialConnected(companyId: string): Promise<boolean> {
  const rows = await db
    .select({ status: integrations.status })
    .from(integrations)
    .where(
      and(
        eq(integrations.companyId, companyId),
        inArray(integrations.type, ["meta", "linkedin"]),
        isNull(integrations.agentId),
      ),
    );
  return rows.some((r) => r.status === "connected");
}

/**
 * Calendar work pane props for a session the page already authorized (company
 * membership + operator access). The content calendar model is phase 2
 * (map #31): with RELAY_FIXTURES=true the pane shows the canon October
 * calendar as if Meta were connected; otherwise it is the Connect state until
 * Meta or LinkedIn connects, then "No posts planned yet".
 */
export async function loadCalendarPane(args: { companyId: string; canAct: boolean }): Promise<CalendarPaneProps> {
  if (isFixturesEnabled()) {
    return {
      socialConnected: true,
      calendar: contentCalendarFixture,
      now: CALENDAR_FIXTURE_NOW.toISOString(),
      canAct: args.canAct,
    };
  }
  return {
    socialConnected: await socialConnected(args.companyId),
    calendar: null,
    now: new Date().toISOString(),
    canAct: args.canAct,
  };
}
