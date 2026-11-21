import { and, eq } from "drizzle-orm";
import {
  dailyBriefs,
  DAILY_BRIEF_ITEM_STATUSES,
  db,
  projects,
  tasks,
  type DailyBriefItem,
} from "@relay/db";
import { z } from "zod";
import { requireCompanyMembership } from "../auth/access";
import { completeTask } from "./tasks";

export const setBriefItemStatusSchema = z.object({
  companyId: z.string().min(1),
  briefId: z.string().min(1),
  rank: z.number().int(),
  status: z.enum(DAILY_BRIEF_ITEM_STATUSES),
});

export const addBriefItemAsTaskSchema = z.object({
  companyId: z.string().min(1),
  briefId: z.string().min(1),
  rank: z.number().int(),
  projectId: z.string().min(1).nullable().optional(),
});

export type SetBriefItemStatusInput = z.infer<typeof setBriefItemStatusSchema>;
export type AddBriefItemAsTaskInput = z.infer<typeof addBriefItemAsTaskSchema>;

type BriefRow = typeof dailyBriefs.$inferSelect;
type TaskRow = typeof tasks.$inferSelect;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Loads one brief row for update. A brief of another company is "not found":
 * the company filter is in the query, and the returned row is checked again.
 */
async function loadBriefForUpdate(
  tx: Transaction,
  companyId: string,
  briefId: string,
): Promise<Pick<BriefRow, "id" | "companyId" | "items">> {
  const [brief] = await tx
    .select({
      id: dailyBriefs.id,
      companyId: dailyBriefs.companyId,
      items: dailyBriefs.items,
    })
    .from(dailyBriefs)
    .where(and(eq(dailyBriefs.id, briefId), eq(dailyBriefs.companyId, companyId)))
    .for("update");

  if (!brief || (brief.companyId && brief.companyId !== companyId)) {
    throw new Error("Brief not found");
  }
  return brief;
}

function findItem(items: readonly DailyBriefItem[], rank: number): DailyBriefItem {
  const item = items.find((candidate) => candidate.rank === rank);
  if (!item) {
    throw new Error("Brief item not found");
  }
  return item;
}

async function writeItems(
  tx: Transaction,
  briefId: string,
  items: DailyBriefItem[],
) {
  await tx
    .update(dailyBriefs)
    .set({ items, updatedAt: new Date() })
    .where(eq(dailyBriefs.id, briefId));
}

async function assertProject(companyId: string, projectId: string | null | undefined) {
  if (projectId === undefined || projectId === null) return;

  const project = await db.query.projects.findFirst({
    where: eq(projects.id, projectId),
  });

  if (!project || project.companyId !== companyId) {
    throw new Error("Project not found");
  }
}

/**
 * Sets one brief item's status (a missing status on stored items is `open`).
 * `done` on an item with a `taskId` also completes that task; `open` undoes
 * either `done` or `dismissed`.
 */
export async function setBriefItemStatus(
  userId: string,
  input: Parameters<typeof setBriefItemStatusSchema.parse>[0],
) {
  const parsed = setBriefItemStatusSchema.parse(input);
  await requireCompanyMembership(userId, parsed.companyId);

  const updated = await db.transaction(async (tx) => {
    const brief = await loadBriefForUpdate(tx, parsed.companyId, parsed.briefId);
    const items = brief.items ?? [];
    const item = findItem(items, parsed.rank);
    const nextItem: DailyBriefItem = { ...item, status: parsed.status };
    const nextItems = items.map((candidate) =>
      candidate.rank === parsed.rank ? nextItem : candidate,
    );
    await writeItems(tx, parsed.briefId, nextItems);
    return nextItem;
  });

  if (parsed.status === "done" && updated.taskId) {
    await completeTask(userId, updated.taskId);
  }

  return updated;
}

/**
 * Creates a task from one brief item and writes the new `taskId` back on it.
 * `createTask` cannot be used here: it hardcodes `source: "manual"` and takes
 * no `briefId`, so the row is inserted with the transaction handle instead.
 */
export async function addBriefItemAsTask(
  userId: string,
  input: Parameters<typeof addBriefItemAsTaskSchema.parse>[0],
): Promise<TaskRow> {
  const parsed = addBriefItemAsTaskSchema.parse(input);
  await requireCompanyMembership(userId, parsed.companyId);
  await assertProject(parsed.companyId, parsed.projectId);

  return db.transaction(async (tx) => {
    const brief = await loadBriefForUpdate(tx, parsed.companyId, parsed.briefId);
    const items = brief.items ?? [];
    const item = findItem(items, parsed.rank);

    if (item.taskId) {
      throw new Error("Brief item already has a task");
    }

    const [task] = await tx
      .insert(tasks)
      .values({
        companyId: parsed.companyId,
        projectId: parsed.projectId ?? null,
        title: item.title,
        notes: item.why,
        source: "brief",
        briefId: parsed.briefId,
        createdByUserId: userId,
      })
      .returning();

    const nextItems = items.map((candidate) =>
      candidate.rank === parsed.rank ? { ...candidate, taskId: task.id } : candidate,
    );
    await writeItems(tx, parsed.briefId, nextItems);

    return task as TaskRow;
  });
}
