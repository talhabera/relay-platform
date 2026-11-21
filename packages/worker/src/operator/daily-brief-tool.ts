import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import {
  companies,
  DAILY_BRIEF_ITEM_KINDS,
  DAILY_BRIEF_MAX_ITEMS,
  dailyBriefs,
  db,
  tasks,
  type DailyBriefItem,
  type DailyBriefItemStatus,
} from "@relay/db";
import {
  localDateLabel,
  reportTimeZone,
  type ReportExecutor,
} from "@relay/db/report-snapshots";
import { taskHref } from "./workspace-state";

export const READ_WORKSPACE_STATE_TOOL = "readWorkspaceState";
export const POST_DAILY_BRIEF_TOOL = "postDailyBrief";

/** An in-app path: one leading slash, never `//host` or `/\host`. */
export const IN_APP_HREF = /^\/(?![/\\])/;

export const dailyBriefItemSchema = z.object({
  rank: z.number().int().min(1).max(DAILY_BRIEF_MAX_ITEMS),
  kind: z.enum(DAILY_BRIEF_ITEM_KINDS),
  title: z.string().trim().min(1).max(120),
  why: z.string().trim().min(1).max(300),
  href: z
    .string()
    .max(300)
    .regex(IN_APP_HREF, "href must be an in-app path starting with /")
    .nullable()
    .optional(),
  /** The task this item is about, from readWorkspaceState; never invented. */
  taskId: z.uuid().nullable().optional(),
});

export const postDailyBriefInputSchema = z.object({
  summary: z.string().trim().min(1).max(600),
  items: z.array(dailyBriefItemSchema).min(1).max(DAILY_BRIEF_MAX_ITEMS),
});

export type PostDailyBriefInput = z.infer<typeof postDailyBriefInputSchema>;

/** Ranks must be exactly 1..n, each once. */
export function refineSequentialRanks(
  input: { items: ReadonlyArray<{ rank: number }> },
  ctx: z.RefinementCtx,
): void {
  const ranks = input.items.map((item) => item.rank).sort((a, b) => a - b);
  if (ranks.some((rank, i) => rank !== i + 1)) {
    ctx.addIssue({
      code: "custom",
      path: ["items"],
      message: `Item ranks must be 1 to ${input.items.length}, each used once.`,
    });
  }
}

const postDailyBriefSchema = postDailyBriefInputSchema.superRefine(refineSequentialRanks);

export function issueMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message))
    .join("; ");
}

/**
 * Daily Manager write tool: one brief per company per local date. A second
 * post the same day replaces summary and its own items, keeps the row id and
 * marks it unread again; an item whose `taskId` was on the earlier post keeps
 * the status the reader gave it there. Ad Monitor items (`source: "ads"`)
 * from earlier today stay first (`upsertDailyBrief`). A `taskId` outside the
 * run's company is refused before anything is written.
 */
export async function executePostDailyBrief(
  run: { companyId: string; agentId: string; cronRunId: string },
  input: unknown,
  now: Date = new Date(),
  executor: ReportExecutor = db,
) {
  const parsed = postDailyBriefSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: issueMessage(parsed.error) };
  }
  const { summary } = parsed.data;
  const sorted = [...parsed.data.items].sort((a, b) => a.rank - b.rank);

  const taskIds = [
    ...new Set(sorted.flatMap((item) => (item.taskId ? [item.taskId] : []))),
  ];
  if (taskIds.length > 0) {
    const owned = await executor
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.companyId, run.companyId), inArray(tasks.id, taskIds)));
    const ownedIds = new Set(owned.map((task) => task.id));
    const unknown = taskIds.filter((id) => !ownedIds.has(id));
    if (unknown.length > 0) {
      return {
        ok: false as const,
        error: `No task in this company has the id ${unknown.join(", ")}. Use only task ids that readWorkspaceState returned, or leave taskId out.`,
      };
    }
  }

  const items: DailyBriefItem[] = sorted.map(({ taskId, href, ...item }) => ({
    ...item,
    href: href ?? (taskId ? taskHref(taskId) : null),
    taskId: taskId ?? null,
  }));

  return upsertDailyBrief(run, { writer: "manager", summary, items }, now, executor);
}

export type UpsertDailyBriefResult =
  | { ok: true; briefId: string; localDate: string }
  | { ok: false; error: string };

/**
 * The one write path for `daily_briefs`, shared by the Daily Manager and the
 * Ad Monitor (RL7). One row per company per local date; the two writers merge
 * into it instead of overwriting each other:
 * - `ads` replaces earlier `source: "ads"` items and keeps the earlier
 *   manager items (no `source`) after them;
 * - `manager` keeps earlier `source: "ads"` items first and trims its own
 *   items so the total stays at most `DAILY_BRIEF_MAX_ITEMS`.
 * Ranks are renumbered 1..n, `summary` is the latest writer's, a status the
 * reader set on an earlier same-day item with the same `taskId` or
 * `proposalKey` is kept, and `readAt` resets to null.
 */
export async function upsertDailyBrief(
  run: { companyId: string; agentId: string; cronRunId: string },
  post: { writer: "manager" | "ads"; summary: string; items: readonly DailyBriefItem[] },
  now: Date,
  executor: ReportExecutor,
): Promise<UpsertDailyBriefResult> {
  const [company] = await executor
    .select({ timezone: companies.timezone })
    .from(companies)
    .where(eq(companies.id, run.companyId));
  if (!company) {
    return { ok: false as const, error: "The run's company no longer exists." };
  }
  const localDate = localDateLabel(now, reportTimeZone(company.timezone));

  const [earlier] = await executor
    .select({ items: dailyBriefs.items })
    .from(dailyBriefs)
    .where(
      and(eq(dailyBriefs.companyId, run.companyId), eq(dailyBriefs.localDate, localDate)),
    );
  const earlierItems = earlier?.items ?? [];

  // Statuses the reader set on today's earlier post, by task and by proposal.
  const statusByTask = new Map<string, DailyBriefItemStatus>();
  const statusByProposal = new Map<string, DailyBriefItemStatus>();
  for (const item of earlierItems) {
    if (!item.status) continue;
    if (item.taskId) statusByTask.set(item.taskId, item.status);
    if (item.proposalKey) statusByProposal.set(item.proposalKey, item.status);
  }
  const fresh: DailyBriefItem[] = [...post.items]
    .sort((a, b) => a.rank - b.rank)
    .map((item) => ({
      ...item,
      ...(post.writer === "ads" ? { source: "ads" as const } : {}),
      status:
        (item.taskId && statusByTask.get(item.taskId)) ||
        (item.proposalKey && statusByProposal.get(item.proposalKey)) ||
        "open",
    }));

  const merged =
    post.writer === "ads"
      ? [...fresh, ...earlierItems.filter((item) => item.source !== "ads")]
      : [...earlierItems.filter((item) => item.source === "ads"), ...fresh];
  const items: DailyBriefItem[] = merged
    .slice(0, DAILY_BRIEF_MAX_ITEMS)
    .map((item, i) => ({ ...item, rank: i + 1 }));
  const summary = post.summary;

  const [row] = await executor
    .insert(dailyBriefs)
    .values({
      companyId: run.companyId,
      agentId: run.agentId,
      cronRunId: run.cronRunId,
      localDate,
      summary,
      items,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [dailyBriefs.companyId, dailyBriefs.localDate],
      set: {
        agentId: run.agentId,
        cronRunId: run.cronRunId,
        summary,
        items,
        readAt: null,
        updatedAt: now,
      },
    })
    .returning({ id: dailyBriefs.id, localDate: dailyBriefs.localDate });

  return { ok: true as const, briefId: row.id, localDate: row.localDate };
}
