import { and, asc, desc, eq, gte } from "drizzle-orm";
import { db } from "@/db";
import { portalEvents } from "@/db/schema";
import type { PortalEvent, PortalEventsReader } from "@/lib/fixtures/interfaces";
import { TAIL_PAGE, type FeedCursor } from "./tail";

// Read side of the Live feed (S90). Rows come from `portal_events` only;
// `emitPortalEvent` (./portal-events) is the write side.

export const FEED_DEFAULT_LIMIT = 20;
export const FEED_MAX_LIMIT = 100;

const columns = {
  id: portalEvents.id,
  companyId: portalEvents.companyId,
  type: portalEvents.type,
  at: portalEvents.at,
  title: portalEvents.title,
  detail: portalEvents.detail,
  channel: portalEvents.channel,
  refId: portalEvents.refId,
};

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return FEED_DEFAULT_LIMIT;
  return Math.max(1, Math.min(FEED_MAX_LIMIT, Math.floor(limit)));
}

/** Newest first; `since` is inclusive. */
export async function listPortalEvents(
  companyId: string,
  opts: { since?: Date; limit?: number } = {},
): Promise<PortalEvent[]> {
  const where = opts.since
    ? and(eq(portalEvents.companyId, companyId), gte(portalEvents.at, opts.since))
    : eq(portalEvents.companyId, companyId);
  return db
    .select(columns)
    .from(portalEvents)
    .where(where)
    .orderBy(desc(portalEvents.at), desc(portalEvents.id))
    .limit(clampLimit(opts.limit));
}

/** Oldest first from `from` (inclusive), one tail page. */
export async function listPortalEventsFrom(companyId: string, from: Date): Promise<PortalEvent[]> {
  return db
    .select(columns)
    .from(portalEvents)
    .where(and(eq(portalEvents.companyId, companyId), gte(portalEvents.at, from)))
    .orderBy(asc(portalEvents.at), asc(portalEvents.id))
    .limit(TAIL_PAGE);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The cursor of a company's event id (from `Last-Event-ID`), or null. */
export async function findFeedCursor(companyId: string, eventId: string): Promise<FeedCursor | null> {
  if (!UUID.test(eventId)) return null;
  const [row] = await db
    .select({ at: portalEvents.at, id: portalEvents.id })
    .from(portalEvents)
    .where(and(eq(portalEvents.companyId, companyId), eq(portalEvents.id, eventId)))
    .limit(1);
  return row ?? null;
}

export const portalEventsReader: PortalEventsReader = { listPortalEvents };
