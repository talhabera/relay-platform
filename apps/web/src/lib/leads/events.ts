import { db } from "@/db";
import { leadEvents } from "@/db/schema";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import type { LeadEventRow } from "@relay/db";

// Read side of the lead event log (lead attribution spec). Writes go through
// `transitionLeadStatus` / `insertLeadEvent` from `@relay/db`, shared with the
// worker so every status change, wherever it runs, lands in the same log.

export {
  insertLeadEvent,
  transitionLeadStatus,
  type LeadEventActor,
  type LeadEventRow,
  type TransitionLeadStatusResult,
} from "@relay/db";

/**
 * A company's lead events with `from <= at < to`, oldest first. Pair with
 * `isoWeekRange` from `@/lib/time` for a week in company time.
 */
export async function listLeadEvents(
  companyId: string,
  range: { from: Date; to: Date },
): Promise<LeadEventRow[]> {
  if (range.to.getTime() <= range.from.getTime()) return [];
  return db.query.leadEvents.findMany({
    where: and(
      eq(leadEvents.companyId, companyId),
      gte(leadEvents.at, range.from),
      lt(leadEvents.at, range.to),
    ),
    orderBy: [asc(leadEvents.at), asc(leadEvents.id)],
  });
}
