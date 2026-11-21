import { and, eq, lt, or } from "drizzle-orm";
import { companyRecords, db } from "@relay/db";
import { RESEARCH_STALE_MS } from "./claim-research";
import { runResearchPipeline } from "./research-pipeline";

export async function sweepResearchQueue(now: Date): Promise<number> {
  const staleThreshold = new Date(now.getTime() - RESEARCH_STALE_MS);

  const rows = await db.query.companyRecords.findMany({
    where: or(
      eq(companyRecords.status, "pending"),
      and(
        eq(companyRecords.status, "processing"),
        lt(companyRecords.researchLockedAt, staleThreshold),
      ),
    ),
    orderBy: (records, { asc: ascFn }) => [ascFn(records.updatedAt)],
    limit: 10,
    columns: {
      id: true,
      companyId: true,
    },
  });

  let count = 0;

  for (const row of rows) {
    await runResearchPipeline({
      companyId: row.companyId,
      recordId: row.id,
      mode: "all",
      now,
    });
    count += 1;
  }

  return count;
}
