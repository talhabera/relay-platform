import { z } from "zod";
import {
  DAILY_BRIEF_ITEM_KINDS,
  db,
  MAX_AD_BRIEF_ITEMS,
  type DailyBriefItem,
} from "@relay/db";
import type { ReportExecutor } from "@relay/db/report-snapshots";
import { loadAdState } from "./ad-state";
import {
  IN_APP_HREF,
  issueMessage,
  refineSequentialRanks,
  upsertDailyBrief,
  type UpsertDailyBriefResult,
} from "./daily-brief-tool";

export const POST_AD_BRIEF_TOOL = "postAdBrief";

export const adBriefItemSchema = z.object({
  rank: z.number().int().min(1).max(MAX_AD_BRIEF_ITEMS),
  kind: z.enum(DAILY_BRIEF_ITEM_KINDS),
  title: z.string().trim().min(1).max(120),
  why: z.string().trim().min(1).max(300),
  href: z
    .string()
    .max(300)
    .regex(IN_APP_HREF, "href must be an in-app path starting with /")
    .nullable()
    .optional(),
  /** The `proposals[].key` from readAdState this item carries; never invented. */
  proposalKey: z.string().trim().min(1).max(100).nullable().optional(),
});

export const postAdBriefInputSchema = z.object({
  summary: z.string().trim().min(1).max(600),
  items: z.array(adBriefItemSchema).min(1).max(MAX_AD_BRIEF_ITEMS),
});

export type PostAdBriefInput = z.infer<typeof postAdBriefInputSchema>;

const postAdBriefSchema = postAdBriefInputSchema.superRefine(refineSequentialRanks);

/** Only the proposal keys matter here; loadAdState is the default source. */
export type AdProposalSource = (companyId: string, now: Date) => Promise<{ proposals: ReadonlyArray<{ key: string }> }>;

/**
 * Ad Monitor write tool (RL7). Recomputes the ad state at `now` and refuses,
 * writing nothing, when an open proposal is not carried by an item or an item
 * names a proposal that does not exist. Accepted items are stamped
 * `source: "ads"` and merged into today's brief by `upsertDailyBrief`.
 */
export async function executePostAdBrief(
  run: { companyId: string; agentId: string; cronRunId: string },
  input: unknown,
  now: Date = new Date(),
  executor: ReportExecutor = db,
  loadProposals: AdProposalSource = (companyId, at) => loadAdState(companyId, at),
): Promise<UpsertDailyBriefResult> {
  const parsed = postAdBriefSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: issueMessage(parsed.error) };
  }
  const { summary } = parsed.data;

  const state = await loadProposals(run.companyId, now);
  const open = new Set(state.proposals.map((p) => p.key));
  const carried = new Set(parsed.data.items.flatMap((item) => (item.proposalKey ? [item.proposalKey] : [])));
  const unknown = [...carried].filter((key) => !open.has(key));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `No open proposal has the key ${unknown.join(", ")}. Use only proposal keys that readAdState returned.`,
    };
  }
  const missing = [...open].filter((key) => !carried.has(key));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Every open proposal needs a decide item carrying its proposalKey. Missing: ${missing.join(", ")}.`,
    };
  }

  const items: DailyBriefItem[] = parsed.data.items.map(({ href, proposalKey, ...item }) => ({
    ...item,
    href: href ?? null,
    proposalKey: proposalKey ?? null,
  }));
  return upsertDailyBrief(run, { writer: "ads", summary, items }, now, executor);
}
